// Nuxt's SSR bundle and Nitro's runtime can load separate copies of this module.
const cleanupKey = Symbol.for('@up-nuxt/states:request-cleanup')

type RequestContext = {
  [cleanupKey]?: Set<() => void> | null
}

export function registerRequestCleanup(context: object, dispose: () => void): void {
  const request = context as RequestContext
  if (request[cleanupKey] === null) {
    dispose()
    return
  }
  request[cleanupKey] ??= new Set()
  request[cleanupKey].add(dispose)
}

export function disposeRequestStates(context: object): void {
  const request = context as RequestContext
  const cleanups = request[cleanupKey]
  request[cleanupKey] = null
  if (!cleanups) return

  const errors: unknown[] = []
  for (const dispose of cleanups) {
    try {
      dispose()
    } catch (error) {
      errors.push(error)
    }
  }

  if (errors.length) throw new AggregateError(errors, 'Failed to dispose Nuxt state scopes')
}
