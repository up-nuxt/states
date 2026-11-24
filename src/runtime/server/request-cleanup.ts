import type { NitroAppPlugin } from 'nitropack/types'
import { disposeRequestStates } from '../shared/request-cleanup'

const cleanup: NitroAppPlugin = (nitroApp) => {
  nitroApp.hooks.hook('afterResponse', (event) => disposeRequestStates(event.context))

  // An error handler or aborted connection can bypass afterResponse.
  nitroApp.hooks.hook('request', (event) => {
    const response = event.node?.res
    if (!response?.once) return

    function dispose(): void {
      response.removeListener('finish', dispose)
      response.removeListener('close', dispose)
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
    }

    if (response.writableFinished || response.destroyed) dispose()
    else {
      response.once('finish', dispose)
      response.once('close', dispose)
    }
  })
}

export default cleanup
