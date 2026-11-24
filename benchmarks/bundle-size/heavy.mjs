import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../..', import.meta.url))
const build = (bin, args, cwd = root) =>
  execFileSync(process.execPath, [resolve(root, 'node_modules', bin), ...args], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  })
const moduleBuilder = '@nuxt/module-builder/dist/cli.mjs'
const nuxt = 'nuxt/bin/nuxt.mjs'
if (!existsSync(join(root, '.nuxt/tsconfig.json'))) build(moduleBuilder, ['prepare'])
build(moduleBuilder, ['build'])

const rowCount = 20_000
const browserRuns = Number(process.env.STATES_BENCH_BROWSER_RUNS ?? 16)
assert.ok(Number.isSafeInteger(browserRuns) && browserRuns > 0)
const checksum = (rowCount * (rowCount - 1)) / 2
const directory = await mkdtemp(join(tmpdir(), 'states-pinia-heavy-'))
const servers = []
let browser

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

async function fixture(name, dependency, registration) {
  const dir = join(directory, name)
  await mkdir(join(dir, 'app/plugins'), { recursive: true })
  await writeFile(
    join(dir, 'nuxt.config.ts'),
    `
    export default defineNuxtConfig({
      modules: [${JSON.stringify(dependency)}],
      devtools: { enabled: false },
      sourcemap: false,
      vite: {
        plugins: [{
          name: 'measure-catalog-payload-decode',
          enforce: 'pre',
          transform(code, id, options) {
            if (options?.ssr) return
            if (id.endsWith('/dist/runtime/app/state-snapshot.js')) {
              const signature = 'export function restoreState(state, snapshot) {'
              if (!code.includes(signature)) throw new Error('Update the restoreState probe')
              return code.replace(signature, [
                'export function restoreState(state, snapshot) {',
                '  performance.mark("catalog:restore-start");',
                '  try { return restore(state, snapshot); }',
                '  finally { performance.mark("catalog:restore-end"); }',
                '}',
                'function restore(state, snapshot) {',
              ].join(' '))
            }
            if (!id.endsWith('/nuxt/dist/app/composables/payload.js')) return
            const decode = 'const inlineData = await parsePayload(el.textContent || "");'
            if (!code.includes(decode)) throw new Error('Update the Nuxt decode probe for this version')
            return code.replace(decode,
              'performance.mark("catalog:decode-start");' + decode + 'performance.mark("catalog:decode-end");')
          },
        }],
      },
    })
  `,
  )
  await writeFile(
    join(dir, 'app/plugins/timing.client.ts'),
    `
    export default defineNuxtPlugin((app) => {
      app.hook('app:beforeMount', () => performance.mark('catalog:beforeMount'))
      app.hook('app:mounted', () => performance.mark('catalog:mounted'))
    })
  `,
  )
  const storeKey = registration === 'defineStore' ? '"catalog", ' : ''
  await writeFile(
    join(dir, 'app/catalog.ts'),
    `
    interface Row {
      id: number
      name: string
      details: { region: string; labels: string[] }
    }

    export const useCatalog = ${registration}(${storeKey}() => {
      const rows = reactive<Row[]>([])
      if (import.meta.server) {
        for (let id = 0; id < ${rowCount}; id++) {
          rows.push({ id, name: 'Item ' + id, details: { region: 'Zone ' + (id % 12), labels: ['catalog', 'segment-' + (id % 64)] } })
        }
      }
      return { rows }
    })
  `,
  )
  await writeFile(
    join(dir, 'app/app.vue'),
    `
    <script setup lang="ts">
    import { useCatalog } from './catalog'
    if (import.meta.client) performance.mark('catalog:state-start')
    const { rows } = useCatalog()
    if (import.meta.client) performance.mark('catalog:state-end')
    const checksum = computed(() => rows.reduce((total, row) => total + row.id, 0))
    </script>
    <template>
      <main>
        <output id="count">{{ rows.length }}</output>
        <output id="checksum">{{ checksum }}</output>
        <ul><li v-for="row in rows.slice(0, 25)" :key="row.id">{{ row.name }}</li></ul>
        <button @click="rows[0] && (rows[0].name = 'Updated item')">Update first item</button>
      </main>
    </template>
  `,
  )
  build(nuxt, ['build', dir])

  const child = spawn(process.execPath, [join(dir, '.output/server/index.mjs')], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, NODE_ENV: 'production', NITRO_PORT: '0', NITRO_HOST: '127.0.0.1' },
  })
  const lines = createInterface({ input: child.stdout })
  const server = {
    name,
    child,
    lines,
    ssr: [],
    decode: [],
    state: [],
    restore: [],
    mount: [],
    startup: [],
  }
  servers.push(server)
  const [line] = await once(lines, 'line', { signal: AbortSignal.timeout(15_000) })
  server.url = line.match(/Listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
  assert.ok(server.url, line)
}

async function fetchPage(server) {
  const start = performance.now()
  const response = await fetch(server.url, { signal: AbortSignal.timeout(20_000) })
  const html = await response.text()
  const duration = performance.now() - start
  assert.equal(response.status, 200)
  assert.ok(html.includes(`id="count">${rowCount}</output>`))
  assert.ok(html.includes(`id="checksum">${checksum}</output>`))
  if (!server.payload) {
    const payload = html.match(
      /<script type="application\/json"[^>]*id="__NUXT_DATA__"[^>]*>(.*?)<\/script>/s,
    )?.[1]
    assert.ok(payload)
    server.payload = Buffer.byteLength(payload)
    server.gzip = gzipSync(payload, { level: 9 }).length
  }
  return duration
}

async function openPage(server) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (/hydration.*mismatch/i.test(message.text())) errors.push(message.text())
  })
  try {
    const response = await page.goto(server.url, { waitUntil: 'load' })
    assert.equal(response?.status(), 200)
    await page.waitForFunction(() => performance.getEntriesByName('catalog:mounted').length > 0)
    const timing = await page.evaluate(() => {
      const mark = (name) => performance.getEntriesByName(`catalog:${name}`)[0]?.startTime
      const mounted = mark('mounted')
      const { responseEnd } = performance.getEntriesByType('navigation')[0]
      return {
        decode: mark('decode-end') - mark('decode-start'),
        state: mark('state-end') - mark('state-start'),
        restore: mark('restore-end') - mark('restore-start'),
        mount: mounted - mark('beforeMount'),
        startup: mounted - responseEnd,
      }
    })
    for (const metric of ['decode', 'state', 'mount', 'startup']) {
      assert.ok(Number.isFinite(timing[metric]), `Missing ${metric} timing`)
    }
    if (server.name === '@up-nuxt/states') assert.ok(Number.isFinite(timing.restore))
    assert.equal(await page.locator('#count').textContent(), String(rowCount))
    assert.equal(await page.locator('#checksum').textContent(), String(checksum))
    await page.getByRole('button', { name: 'Update first item' }).click()
    await page.getByText('Updated item', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    return timing
  } finally {
    await page.context().close()
  }
}

try {
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'))
  await symlink(join(root, 'dist'), join(directory, 'dist'))
  await copyFile(join(root, 'package.json'), join(directory, 'package.json'))
  await fixture('@up-nuxt/states', '@up-nuxt/states', 'defineState')
  await fixture('Pinia', '@pinia/nuxt', 'defineStore')

  for (const server of servers) for (let i = 0; i < 8; i++) await fetchPage(server)
  for (let round = 0; round < 4; round++) {
    for (const server of round % 2 ? [...servers].reverse() : servers) {
      for (let i = 0; i < 10; i++) server.ssr.push(await fetchPage(server))
    }
  }
  browser = await chromium.launch({ executablePath: process.env.STATES_BENCH_CHROMIUM })
  for (const server of servers) await openPage(server)
  for (let round = 0; round < browserRuns; round++) {
    for (const server of round % 2 ? [...servers].reverse() : servers) {
      const timing = await openPage(server)
      server.decode.push(timing.decode)
      server.state.push(timing.state)
      if (Number.isFinite(timing.restore)) server.restore.push(timing.restore)
      server.mount.push(timing.mount)
      server.startup.push(timing.startup)
    }
  }
  console.log(
    `Node ${process.version}, Chromium ${browser.version()}, ${rowCount} rows, 40 SSR requests and ${browserRuns} browser loads per app`,
  )
  console.table(
    servers.map((server) => ({
      package: server.name,
      'payload bytes': server.payload,
      'payload gzip bytes': server.gzip,
      'SSR median ms': median(server.ssr).toFixed(2),
      'decode median ms': median(server.decode).toFixed(2),
      'state setup median ms': median(server.state).toFixed(2),
      'restoreState median ms': server.restore.length ? median(server.restore).toFixed(2) : '—',
      'mount median ms': median(server.mount).toFixed(2),
      'response end to mounted median ms': median(server.startup).toFixed(2),
    })),
  )
} finally {
  try {
    await browser?.close()
  } finally {
    await Promise.all(
      servers.map(async ({ child, lines }) => {
        lines.close()
        if (child.exitCode === null && child.signalCode === null) {
          child.kill()
          await once(child, 'exit', { signal: AbortSignal.timeout(10_000) })
        }
      }),
    )
    await rm(directory, { force: true, recursive: true })
  }
}
