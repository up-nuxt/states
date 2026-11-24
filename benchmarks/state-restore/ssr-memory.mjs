import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { setImmediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const entry = new URL('../../test/fixtures/basic/.output/server/index.mjs', import.meta.url)

if (process.send) {
  let peakHeap = 0
  setInterval(() => {
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)
  }, 10).unref()
  process.on('message', async () => {
    const peak = Math.max(peakHeap, process.memoryUsage().heapUsed)
    for (let pass = 0; pass < 3; pass++) {
      await setImmediate()
      globalThis.gc()
    }
    const { heapUsed, rss } = process.memoryUsage()
    peakHeap = heapUsed
    process.send({ retainedHeap: heapUsed, rss, peakHeap: peak })
  })
  await import(entry.href)
} else {
  const child = fork(fileURLToPath(import.meta.url), [], {
    execArgv: ['--expose-gc'],
    env: { ...process.env, NITRO_PORT: '0', NITRO_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
  })
  const output = createInterface({ input: child.stdout })
  const checkpoints = []
  try {
    const [line] = await once(output, 'line', { signal: AbortSignal.timeout(10_000) })
    const address = line.match(/Listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
    assert.ok(address, `Unexpected Nitro startup output: ${line}`)

    const request = async (path) => {
      const response = await fetch(address + path, { signal: AbortSignal.timeout(10_000) })
      assert.equal(response.status, 200)
      return response.text()
    }
    const sample = async (phase) => {
      child.send('sample')
      const [memory] = await once(child, 'message', { signal: AbortSignal.timeout(10_000) })
      checkpoints.push({ phase, ...memory })
    }
    for (let i = 0; i < 100; i++) await request(`/isolation?marker=warm-${i}`)
    const html = await request('/hydration')
    const payload = html.match(
      /<script type="application\/json" data-nuxt-data="nuxt-app"[^>]*>(.*?)<\/script>/s,
    )?.[1]
    assert.ok(payload?.includes('__nuxt_state__'))
    await request('/?scope-cleanup=memory-probe')
    assert.match(await request('/?scope-check=memory-probe'), /scope-disposals:1,scope-changes:0/)
    await sample('after warm-up')
    for (let i = 0; i < 400; i++) await request(`/isolation?marker=serial-${i}`)
    await sample('400 serial requests')
    for (let batch = 0; batch < 8; batch++) {
      await Promise.all(
        Array.from({ length: 50 }, (_, index) => {
          const marker = `batch-${batch}-${index}`
          return request(`/isolation?marker=${marker}&delay=10`).then((body) =>
            assert.ok(body.includes(`data-after="${marker}"`)),
          )
        }),
      )
      if (batch === 3) await sample('200 requests in batches of 50')
    }
    await sample('400 requests in batches of 50')
    console.log(
      `Nuxt production /hydration: ${Buffer.byteLength(html)} HTML bytes; ${Buffer.byteLength(payload)} payload bytes`,
    )
    console.log('Nitro server memory in bytes; retained heap sampled after three forced GCs.')
    console.table(checkpoints)
  } finally {
    output.close()
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
      await once(child, 'exit', { signal: AbortSignal.timeout(10_000) })
    }
  }
}
