import { useNuxtApp, useRequestEvent } from '#app'
import { effectScope } from 'vue'
import { registerRequestCleanup } from '../../shared/request-cleanup'
import { registerHydratableState, type HydratableStateEntry } from '../state-registry'
import { restoreState, snapshotState } from '../state-snapshot'

type NotPromise<T> = T extends PromiseLike<unknown> ? never : unknown

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

/**
 * Turns a synchronous composable factory into state shared by one Nuxt app.
 */
export function defineState<T>(factory: () => T & NotPromise<T>): () => T
export function defineState<T>(factory: () => T & NotPromise<T>, internalKey?: string): () => T {
  const instances = new WeakMap<object, T>()

  return function useDefinedState(): T {
    const nuxtApp = useNuxtApp()

    if (instances.has(nuxtApp)) {
      return instances.get(nuxtApp)!
    }

    const scope = effectScope(true)
    let instance: T
    const dispose = () => {
      if (Object.is(instances.get(nuxtApp), instance)) instances.delete(nuxtApp)
      scope.stop()
    }

    try {
      instance = scope.run(factory)!

      if (isPromiseLike(instance)) {
        throw new TypeError(
          '[@up-nuxt/states] State factories must be synchronous. ' +
            'Expose an async function from the state or use Nuxt data-fetching composables instead.',
        )
      }

      instances.set(nuxtApp, instance)
      if (import.meta.server) {
        const event = useRequestEvent(nuxtApp)
        if (event) registerRequestCleanup(event.context, dispose)
      } else {
        const app = nuxtApp as { vueApp?: { onUnmount?: (cleanup: () => void) => void } }
        app.vueApp?.onUnmount?.(dispose)
      }

      if (internalKey) {
        const entry: HydratableStateEntry = {
          snapshot: () => snapshotState(instance),
          restore: (snapshot) => restoreState(instance, snapshot),
          dispose,
        }

        if (import.meta.dev) {
          entry.debug = {
            state: instance,
            hydration: import.meta.server ? 'Server' : 'Client-only',
          }
          const restore = entry.restore
          entry.restore = (snapshot) => {
            restore(snapshot)
            entry.debug!.hydration = 'Hydrated'
          }
        }

        registerHydratableState(nuxtApp, internalKey, entry)
      }

      return instance
    } catch (error) {
      try {
        dispose()
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Failed to initialize and dispose Nuxt state',
        )
      }
      throw error
    }
  }
}
