import type { NitroAppPlugin } from 'nitropack/types'
import { disposeRequestStates } from '../shared/request-cleanup'

const cleanup: NitroAppPlugin = (nitroApp) => {
  const observedResponses = new WeakSet<object>()
  nitroApp.hooks.hook('afterResponse', (event) => disposeRequestStates(event.context))

  // Nitro's error handler can end the response before H3 calls afterResponse.
  nitroApp.hooks.hook('error', (_error, { event } = {}) => {
    const response = event?.node?.res
    if (!event || !response || response.writableFinished || observedResponses.has(response)) return

    observedResponses.add(response)
    response.once('finish', () => {
      try {
        disposeRequestStates(event.context)
      } catch (error) {
        nitroApp.captureError(
          error instanceof Error
            ? error
            : new Error('Failed to dispose Nuxt state scopes', { cause: error }),
          { event, tags: ['state-disposal'] },
        )
      }
    })
  })
}

export default cleanup
