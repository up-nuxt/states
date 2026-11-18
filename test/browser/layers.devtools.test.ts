import { readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

describe('Nuxt Layers DevTools metadata', async () => {
  const layerCounterPath = fileURLToPath(
    new URL('../fixtures/layers/layers/2.high/app/states/counter.ts', import.meta.url),
  )

  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/layers', import.meta.url)),
    dev: true,
    browser: true,
    browserOptions: { type: 'chromium' },
  })

  it('reports resolved layer origins without duplicate collision winners', async () => {
    const page = await createPage()
    await page.goto(url('/'), { waitUntil: 'hydration' })

    const result = (await page.evaluate(async () => {
      const vueApp = (
        document.querySelector('#__nuxt') as Element & {
          __vue_app__?: {
            config: {
              globalProperties: {
                $nuxt?: { callHook: (name: string, request: object) => Promise<void> }
              }
            }
          }
        }
      )?.__vue_app__
      const request: { result?: unknown } = {}
      await vueApp?.config.globalProperties.$nuxt?.callHook('nuxt-state:inspect', request)
      return request.result
    })) as {
      active: Array<{ key: string }>
      known: Array<{ name: string; source: string; origin: string }>
    }

    expect(result.active).toHaveLength(8)
    expect(result.known.filter(({ name }) => name === 'useLayerAuth')).toEqual([
      {
        name: 'useLayerAuth',
        source: 'app/states/auth.ts',
        origin: 'Project',
      },
    ])
    expect(result.known).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'useLayerPermissions',
          source: 'layers/2.high/app/states/priority.ts',
          origin: 'layers/2.high',
        }),
        expect.objectContaining({
          name: 'useLayerSettings',
          source: 'layers/1.base/app/states/settings.ts',
          origin: 'layers/1.base',
        }),
        expect.objectContaining({
          name: 'useExtendedLayerState',
          source: 'extended/app/states/extended.ts',
          origin: 'extended',
        }),
        expect.objectContaining({
          name: 'usePackageLayerState',
          source: 'packages/external-layer/app/states/package.ts',
          origin: 'packages/external-layer',
        }),
      ]),
    )

    await page.close()
  })

  it('resets a local-layer state on HMR without retaining a stale inspector entry', async () => {
    const page = await createPage()
    const originalSource = await readFile(layerCounterPath, 'utf8')

    try {
      await page.goto(url('/hydration'), { waitUntil: 'hydration' })
      await expect(page.locator('#layer-count').textContent()).resolves.toBe('1')

      await writeFile(
        layerCounterPath,
        originalSource.replace('const count = ref(0)', 'const count = ref(5)'),
      )
      await expect.poll(() => page.locator('#layer-count').textContent()).toBe('5')

      const inspected = (await page.evaluate(async () => {
        const vueApp = (
          document.querySelector('#__nuxt') as Element & {
            __vue_app__?: {
              config: {
                globalProperties: {
                  $nuxt?: { callHook: (name: string, request: object) => Promise<void> }
                }
              }
            }
          }
        )?.__vue_app__
        const request: { result?: unknown } = {}
        await vueApp?.config.globalProperties.$nuxt?.callHook('nuxt-state:inspect', request)
        return request.result
      })) as { active: Array<{ members: Array<{ name: string; value: unknown }> }> }

      expect(inspected.active).toHaveLength(1)
      expect(inspected.active[0]?.members.find(({ name }) => name === 'count')?.value).toBe(5)
    } finally {
      await writeFile(layerCounterPath, originalSource)
      await page.close()
    }
  })

  it('refreshes known states when a project override is added, renamed, and removed', async () => {
    const page = await createPage()
    const overridePath = fileURLToPath(
      new URL('../fixtures/layers/app/states/test-metadata-override.ts', import.meta.url),
    )
    const stateExport = (name: string) => `export const ${name} = defineState(() => ({}))\n`
    const readOrigins = async () => {
      await page.goto(url('/hydration'), { waitUntil: 'hydration' })
      return page.evaluate(async () => {
        const nuxt = window.useNuxtApp!() as unknown as {
          callHook: (name: string, request: object) => Promise<void>
        }
        const request: { result?: { known: Array<{ name: string; origin: string }> } } = {}
        await nuxt.callHook('nuxt-state:inspect', request)
        return Object.fromEntries(request.result!.known.map(({ name, origin }) => [name, origin]))
      })
    }
    const origins = async () => {
      const states = await readOrigins()
      return [states.useLayerSettings, states.useRenamedSettings]
    }

    try {
      expect(await origins()).toEqual(['layers/1.base', undefined])

      await writeFile(overridePath, stateExport('useLayerSettings'), { flag: 'wx' })
      try {
        await expect.poll(origins, { timeout: 8000, interval: 200 }).toEqual(['Project', undefined])

        await writeFile(overridePath, stateExport('useRenamedSettings'))
        await expect
          .poll(origins, { timeout: 8000, interval: 200 })
          .toEqual(['layers/1.base', 'Project'])
      } finally {
        await rm(overridePath)
      }

      await expect
        .poll(origins, { timeout: 8000, interval: 200 })
        .toEqual(['layers/1.base', undefined])
    } finally {
      await page.close()
    }
  })
})
