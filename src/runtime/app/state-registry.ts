export type StateHydrationPayload = Record<string, unknown>

export interface HydratableStateEntry {
  snapshot: () => unknown
  restore: (snapshot: unknown) => void
  dispose?: () => void
  debug?: {
    state: unknown
    name?: string
    source?: string
    origin?: string
    hydration: 'Hydrated' | 'Client-only' | 'Server'
  }
}

interface StateRegistry {
  active: Map<string, HydratableStateEntry>
  hydration: Map<string, unknown>
}

const registries = new WeakMap<object, StateRegistry>()

export function getStateRegistry(nuxtApp: object): StateRegistry {
  let registry = registries.get(nuxtApp)

  if (!registry) {
    registry = {
      active: new Map(),
      hydration: new Map(),
    }
    registries.set(nuxtApp, registry)
  }

  return registry
}

export function registerHydratableState(
  nuxtApp: object,
  key: string,
  entry: HydratableStateEntry,
): void {
  const registry = getStateRegistry(nuxtApp)
  restorePendingSnapshot(registry, key, entry)
  registry.active.get(key)?.dispose?.()
  registry.active.set(key, entry)
}

export function collectStateSnapshots(nuxtApp: object): StateHydrationPayload {
  const snapshots: StateHydrationPayload = {}

  for (const [key, entry] of getStateRegistry(nuxtApp).active) {
    snapshots[key] = entry.snapshot()
  }

  return snapshots
}

export function receiveStateSnapshots(
  nuxtApp: object,
  snapshots: StateHydrationPayload | undefined,
): void {
  const registry = getStateRegistry(nuxtApp)
  registry.hydration = new Map(Object.entries(snapshots ?? {}))

  for (const [key, entry] of registry.active) {
    try {
      restorePendingSnapshot(registry, key, entry)
    } catch (error) {
      registry.active.delete(key)
      try {
        entry.dispose?.()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Failed to restore and dispose Nuxt state')
      }
      throw error
    }
  }
}

function restorePendingSnapshot(
  registry: StateRegistry,
  key: string,
  entry: HydratableStateEntry,
): void {
  if (!registry.hydration.has(key)) return

  entry.restore(registry.hydration.get(key))
  registry.hydration.delete(key)
}

export function clearPendingStateSnapshots(nuxtApp: object): void {
  getStateRegistry(nuxtApp).hydration.clear()
}
