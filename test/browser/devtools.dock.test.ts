import { fileURLToPath } from 'node:url'
import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

type DevframeWindow = Window & {
  __DEVFRAME_HUB_CLIENT_CONTEXT__?: {
    docks: {
      entries: Array<{ id: string; badge?: string }>
      switchEntry: (id: string) => Promise<boolean>
    }
    panel: { session: { open: boolean } }
  }
}

describe('Nuxt DevTools v4 dock', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/basic', import.meta.url)),
    dev: true,
    browser: true,
    browserOptions: { type: 'chromium' },
    // Nuxt DevTools skips initialization in the test runner's inherited environment.
    env: { TEST: '', VITEST: '' },
    nuxtConfig: { test: false, devtools: { enabled: true, disableAuthorization: true } },
  })

  it('shows live state in the native iframe and leaves lazy factories idle', async () => {
    const page = await createPage()

    try {
      await page.goto(url('/devtools'), { waitUntil: 'hydration' })
      await page.waitForFunction(() =>
        (window as DevframeWindow).__DEVFRAME_HUB_CLIENT_CONTEXT__?.docks.entries.some(
          ({ id }) => id === 'nuxt-state',
        ),
      )
      const badge = await page.evaluate(async () => {
        const { docks, panel } = (window as DevframeWindow).__DEVFRAME_HUB_CLIENT_CONTEXT__!
        panel.session.open = true
        await docks.switchEntry('nuxt-state')
        return docks.entries.find(({ id }) => id === 'nuxt-state')?.badge
      })

      const inspector = page.frameLocator('iframe[src*="/__nuxt_state_devtools__/"]')
      const knownStates = inspector
        .locator('article')
        .filter({ has: inspector.getByRole('heading', { name: 'Known states' }) })
      const count = inspector
        .getByRole('row')
        .filter({ has: inspector.getByRole('cell', { name: 'count', exact: true }) })
        .locator('pre')

      await expect(count.textContent()).resolves.toBe('4')
      await expect(knownStates.getByText('useDevtoolsLazyState').isVisible()).resolves.toBe(true)
      expect(badge).toBe(String(await knownStates.locator('tbody tr').count()))
      await expect(page.locator('#devtools-lazy-calls').textContent()).resolves.toBe('0')

      await page.locator('#devtools-increment').click()
      await expect.poll(() => count.textContent()).toBe('5')

      const filter = inspector.getByRole('searchbox')
      await filter.fill('no-such-state')
      await expect
        .poll(() => inspector.getByText('No matching active states.').isVisible())
        .toBe(true)
      await filter.fill('')
      await expect.poll(() => count.isVisible()).toBe(true)
      await expect(page.locator('#devtools-lazy-calls').textContent()).resolves.toBe('0')

      await filter.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await page.locator('#devtools-increment').click()
      await filter.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1_100)))
      await expect(count.textContent()).resolves.toBe('5')

      await filter.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await expect.poll(() => count.textContent()).toBe('6')
    } finally {
      await page.close()
    }
  })
})
