import { isReactive, isReadonly, isRef, toRaw, type Ref } from 'vue'

interface RefSnapshot {
  type: 'ref'
  value: unknown
}

interface ReactiveSnapshot {
  type: 'reactive'
  value: unknown
}

type StateSnapshotEntry = RefSnapshot | ReactiveSnapshot

export type StateSnapshot = Record<string, StateSnapshotEntry>

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function unwrapReactive(value: unknown): unknown {
  return isReactive(value) ? toRaw(value) : value
}

export function snapshotState(state: unknown): StateSnapshot {
  const snapshot: StateSnapshot = {}

  if (!isObjectLike(state)) return snapshot

  for (const [name, value] of Object.entries(state)) {
    if (isRef(value) && !isReadonly(value)) {
      snapshot[name] = {
        type: 'ref',
        value: unwrapReactive(value.value),
      }
    } else if (isReactive(value) && !isReadonly(value)) {
      snapshot[name] = {
        type: 'reactive',
        value: toRaw(value),
      }
    }
  }

  return snapshot
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function canPatch(target: unknown, source: unknown): boolean {
  return (
    (Array.isArray(target) && Array.isArray(source)) ||
    (isPlainRecord(target) && !isRef(target) && isPlainRecord(source) && !isRef(source))
  )
}

function isTrackableObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function writeGraph(target: object, source: object, resolve: (value: unknown) => unknown): void {
  if (Array.isArray(target) && Array.isArray(source)) {
    for (let index = 0; index < source.length; index++) {
      target[index] = resolve(source[index])
    }
    target.length = source.length
  } else if (target instanceof Map && source instanceof Map) {
    const entries = toRaw(target) === source ? [...source] : source
    target.clear()
    for (const [key, value] of entries) target.set(resolve(key), resolve(value))
  } else if (target instanceof Set && source instanceof Set) {
    const values = toRaw(target) === source ? [...source] : source
    target.clear()
    for (const value of values) target.add(resolve(value))
  } else if (isPlainRecord(target) && isPlainRecord(source)) {
    for (const key of Object.keys(target)) {
      if (!Object.hasOwn(source, key)) delete target[key]
    }
    for (const [key, value] of Object.entries(source)) target[key] = resolve(value)
  }
}

// Preserve payload objects shared with Nuxt data unless an edge needs to point
// to a reused client object. Keep one predecessor per node and store extra
// edges only at joins, so unrelated trees do not allocate a Set for each node.
function createGraphResolver(bindings: Map<object, object>, roots: unknown[]) {
  const parents = new Map<object, object | null>()
  const extraParents = new Map<object, object[]>()
  const scan: object[] = []

  for (const value of roots) {
    if (!isTrackableObject(value)) continue
    const root = toRaw(value)
    if (parents.has(root)) continue
    parents.set(root, null)
    scan.push(root)
  }

  let parent: object
  function visit(value: unknown): void {
    if (!isTrackableObject(value)) return
    const child = toRaw(value)
    const firstParent = parents.get(child)
    if (firstParent === undefined) {
      parents.set(child, parent)
      scan.push(child)
    } else if (firstParent !== parent && child !== parent) {
      const additional = extraParents.get(child)
      if (additional) additional.push(parent)
      else extraParents.set(child, [parent])
    }
  }

  function visitMapEntry(value: unknown, key: unknown): void {
    visit(key)
    visit(value)
  }

  for (const source of scan) {
    parent = source
    if (source instanceof Map) source.forEach(visitMapEntry)
    else if (source instanceof Set) source.forEach(visit)
    else if (Array.isArray(source) || (isPlainRecord(source) && !isRef(source))) {
      for (const key in source) {
        if (Object.hasOwn(source, key)) visit((source as Record<string, unknown>)[key])
      }
    }
  }

  const affected = new Set(bindings.keys())
  for (const source of affected) {
    const firstParent = parents.get(source)
    if (firstParent) affected.add(firstParent)
    const additional = extraParents.get(source)
    if (additional) for (const other of additional) affected.add(other)
  }

  function resolve(value: unknown): unknown {
    if (!isTrackableObject(value)) return value
    const source = toRaw(value)
    const bound = bindings.get(source)
    if (bound) return bound
    if (!affected.has(source)) return value

    let copy: object
    if (Array.isArray(source)) copy = []
    else if (source instanceof Map) copy = new Map()
    else if (source instanceof Set) copy = new Set()
    else copy = Object.create(Object.getPrototypeOf(source)) as object

    bindings.set(source, copy)
    writeGraph(copy, source, resolve)
    return copy
  }

  return resolve
}

function isStateSnapshotEntry(value: unknown): value is StateSnapshotEntry {
  return (
    isPlainRecord(value) &&
    (value.type === 'ref' || value.type === 'reactive') &&
    Object.hasOwn(value, 'value')
  )
}

export function restoreState(state: unknown, snapshot: unknown): void {
  if (!isObjectLike(state) || !isPlainRecord(snapshot)) return

  const bindings = new Map<object, object>()
  const claimed = new WeakSet<object>()
  const duplicateRoots: Array<[source: object, target: object]> = []
  const refs: Array<{ target: Ref; value: unknown }> = []

  function claim(target: object, source: object): void {
    bindings.set(source, target)
    claimed.add(toRaw(target))
  }

  // Reserve returned reactive roots before any nested member or ref can claim them.
  for (const [name, entry] of Object.entries(snapshot)) {
    if (!isStateSnapshotEntry(entry)) continue
    const target = state[name]

    if (entry.type === 'ref' && isRef(target) && !isReadonly(target)) {
      refs.push({ target, value: entry.value })
    } else if (
      entry.type === 'reactive' &&
      isTrackableObject(target) &&
      isReactive(target) &&
      !isReadonly(target)
    ) {
      const source = unwrapReactive(entry.value)
      if (!isTrackableObject(source) || claimed.has(toRaw(target))) continue
      if (
        !canPatch(target, source) &&
        !(target instanceof Map && source instanceof Map) &&
        !(target instanceof Set && source instanceof Set)
      ) {
        continue
      }
      // Distinct factory roots keep their identities even if the payload aliases them.
      if (bindings.has(source)) {
        duplicateRoots.push([source, target])
        claimed.add(toRaw(target))
      } else {
        claim(target, source)
      }
    }
  }

  if (bindings.size === 0) {
    for (const { target, value } of refs) target.value = value
    return
  }

  const rootBindings = duplicateRoots.length ? new Map(bindings) : undefined
  for (const [source, target] of bindings) {
    for (const [key, value] of Object.entries(source)) {
      const current = (target as Record<string, unknown>)[key]
      if (!isTrackableObject(value) || !isTrackableObject(current)) continue
      const raw = toRaw(value)
      if (!bindings.has(raw) && !claimed.has(toRaw(current)) && canPatch(current, raw)) {
        claim(current, raw)
      }
    }
  }

  const reactiveBindings = [...bindings]
  const resolve = createGraphResolver(bindings, [
    ...bindings.keys(),
    ...refs.map(({ value }) => value),
  ])

  for (const [source, target] of reactiveBindings) writeGraph(target, source, resolve)
  for (const [source, target] of duplicateRoots) {
    // Give this root its own back-references, while retaining other explicit roots.
    const localBindings = new Map(rootBindings)
    localBindings.set(source, target)
    writeGraph(target, source, createGraphResolver(localBindings, [source]))
  }
  for (const { target, value } of refs) target.value = resolve(value)
}
