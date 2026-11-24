import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

describe('SSR isolation stress', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/basic', import.meta.url)),
  })

  it('isolates 200 concurrent requests', async () => {
    const batch = randomUUID()
    const markers = Array.from({ length: 200 }, (_, index) => `release-stress-${index + 1}`)
    const responses = await Promise.all(
      markers.map(async (marker, index) => {
        // Stagger TCP connects while the fixture waits for all 200 SSR renders.
        await setTimeout(Math.floor(index / 25) * 25)
        return $fetch<string>(`/isolation?marker=${marker}&delay=${index % 10}&batch=${batch}`, {
          retry: 0,
        })
      }),
    )

    for (const [index, html] of responses.entries()) {
      const marker = markers[index]!
      const observedMarkers = new Set(html.match(/release-stress-\d+/g) ?? [])

      expect(html).toContain(`data-after="${marker}"`)
      expect(observedMarkers).toEqual(new Set([marker]))
    }
  })
})
