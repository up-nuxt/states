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
    hydration: 'Hydrated' | 'No snapshot' | 'Server'
  }
}

interface StateRegistry {
  active: Map<string, HydratableStateEntry>
  hydration?: {
    snapshots: StateHydrationPayload
    consumed?: Set<string>
  }
}

const registries = new WeakMap<object, StateRegistry>()

export function getStateRegistry(nuxtApp: object): StateRegistry {
  let registry = registries.get(nuxtApp)

  if (!registry) {
    registry = {
      active: new Map(),
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

export function collectStateSnapshots(nuxtApp: object): StateHydrationPayload | undefined {
  const registry = registries.get(nuxtApp)
  if (!registry) return
  let snapshots: StateHydrationPayload | undefined

  for (const [key, entry] of registry.active) {
    const snapshot = entry.snapshot()
    if (snapshot !== undefined) (snapshots ??= {})[key] = snapshot
  }

  return snapshots
}

export function receiveStateSnapshots(
  nuxtApp: object,
  snapshots: StateHydrationPayload | undefined,
): void {
  if (!snapshots) {
    clearPendingStateSnapshots(nuxtApp)
    return
  }
  const registry = getStateRegistry(nuxtApp)
  registry.hydration = { snapshots }

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
  const hydration = registry.hydration
  if (!hydration || hydration.consumed?.has(key) || !Object.hasOwn(hydration.snapshots, key)) return

  entry.restore(hydration.snapshots[key])
  const consumed = (hydration.consumed ??= new Set())
  consumed.add(key)
}

export function clearPendingStateSnapshots(nuxtApp: object): void {
  const registry = registries.get(nuxtApp)
  if (registry) registry.hydration = undefined
}
