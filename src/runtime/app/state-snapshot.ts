import { isReactive, isReadonly, isRef, isShallow, toRaw, type Ref } from 'vue'

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

export function snapshotState(state: unknown): StateSnapshot | undefined {
  if (!isObjectLike(state)) return
  let snapshot: StateSnapshot | undefined

  for (const [name, value] of Object.entries(state)) {
    if (isRef(value) && !isReadonly(value)) {
      ;(snapshot ??= {})[name] = {
        type: 'ref',
        value: unwrapReactive(value.value),
      }
    } else if (isReactive(value) && !isReadonly(value)) {
      ;(snapshot ??= {})[name] = {
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

function reactiveStoredValue(value: unknown, shallow: boolean): unknown {
  // Deep Vue setters unwrap reactive proxies while preserving readonly and shallow wrappers.
  return !shallow && isTrackableObject(value) && !isShallow(value) && !isReadonly(value)
    ? toRaw(value)
    : value
}

function isArrayIndex(key: string, length: number): boolean {
  const index = Number(key)
  return index < length && key === String(index >>> 0)
}

function patchArray(
  target: unknown[],
  source: unknown[],
  resolve: (value: unknown) => unknown,
): void {
  const raw = toRaw(target)
  const shallow = isShallow(target)
  const length = source.length
  const keys = Object.getOwnPropertyNames(source)
  const dense = keys[length] === 'length'

  // Array indices precede the length property in own-key order.
  if (!dense) {
    for (const key of Object.getOwnPropertyNames(raw)) {
      if (isArrayIndex(key, length) && !Object.hasOwn(source, key)) delete target[Number(key)]
    }
  }
  const keyCount = dense ? length : keys.length
  for (let position = 0; position < keyCount; position++) {
    const key = keys[position]!
    if (!dense && !isArrayIndex(key, length)) continue
    const index = Number(key)
    const value = resolve(source[index])
    const current = raw === target ? undefined : Object.getOwnPropertyDescriptor(raw, key)
    if (!current?.writable || !Object.is(current.value, reactiveStoredValue(value, shallow))) {
      target[index] = value
    }
  }
  if (raw.length !== length) target.length = length
}

function patchMap(
  target: Map<unknown, unknown>,
  source: Map<unknown, unknown>,
  resolve: (value: unknown) => unknown,
): void {
  const raw = toRaw(target)
  if (raw !== target && Object.getPrototypeOf(raw) === Map.prototype && raw.size === source.size) {
    const existingKeys = raw.keys()
    let sameOrder = true
    for (const key of source.keys()) {
      if (!Object.is(existingKeys.next().value, toRaw(resolve(key)))) {
        sameOrder = false
        break
      }
    }

    if (sameOrder) {
      const shallow = isShallow(target)
      for (const [key, value] of source) {
        const resolvedKey = toRaw(resolve(key))
        const resolvedValue = resolve(value)
        const storedValue = reactiveStoredValue(resolvedValue, shallow)
        if (
          !Object.is(raw.get(resolvedKey), storedValue) ||
          (storedValue === undefined && !raw.has(resolvedKey))
        ) {
          target.set(resolvedKey, resolvedValue)
        }
      }
      return
    }
  }

  const entries = raw === source ? [...source] : source
  target.clear()
  for (const [key, value] of entries) target.set(resolve(key), resolve(value))
}

function patchSet(
  target: Set<unknown>,
  source: Set<unknown>,
  resolve: (value: unknown) => unknown,
): void {
  const raw = toRaw(target)
  if (
    raw !== target &&
    Object.getPrototypeOf(raw) === Set.prototype &&
    Object.getPrototypeOf(source) === Set.prototype &&
    source[Symbol.iterator] === Set.prototype.values &&
    // Clearing and rebuilding needs fewer writes when most members will be removed.
    raw.size - source.size <= source.size
  ) {
    const shallow = isShallow(target)
    const existing = Set.prototype.values.call(raw)
    const incoming = source[Symbol.iterator]()
    let matches = true

    for (let index = 0, size = Math.min(raw.size, source.size); index < size; index++) {
      const value = resolve(incoming.next().value)
      const stored = isTrackableObject(value) ? toRaw(value) : value
      // Vue may deduplicate wrapped members against their raw values.
      if (
        (!Object.is(stored, value) && (shallow || isShallow(value) || isReadonly(value))) ||
        !Object.is(existing.next().value, stored)
      ) {
        matches = false
        break
      }
    }

    if (matches) {
      if (raw.size > source.size) {
        for (const value of Array.from(existing)) target.delete(value)
      } else if (raw.size < source.size) {
        for (let next = incoming.next(); !next.done; next = incoming.next()) {
          target.add(resolve(next.value))
        }
      }
      return
    }
  }

  const values = raw === source ? [...source] : source
  target.clear()
  for (const value of values) target.add(resolve(value))
}

function writeGraph(target: object, source: object, resolve: (value: unknown) => unknown): void {
  if (Array.isArray(target) && Array.isArray(source)) {
    patchArray(target, source, resolve)
  } else if (target instanceof Map && source instanceof Map) {
    patchMap(target, source, resolve)
  } else if (target instanceof Set && source instanceof Set) {
    patchSet(target, source, resolve)
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
function findAffectedNodes(roots: Iterable<unknown>, boundSources: Iterable<object>): Set<object> {
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
    else if (Array.isArray(source)) {
      for (const key of Object.getOwnPropertyNames(source)) {
        if (isArrayIndex(key, source.length)) visit(source[Number(key)])
      }
    } else if (isPlainRecord(source) && !isRef(source)) {
      for (const key in source) {
        if (Object.hasOwn(source, key)) visit((source as Record<string, unknown>)[key])
      }
    }
  }

  const affected = new Set(boundSources)
  for (const source of affected) {
    const firstParent = parents.get(source)
    if (firstParent) affected.add(firstParent)
    const additional = extraParents.get(source)
    if (additional) for (const other of additional) affected.add(other)
  }

  return affected
}

function createGraphResolver(bindings: Map<object, object>, affected: ReadonlySet<object>) {
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
    const array = Array.isArray(source)
    const keys = array ? Object.getOwnPropertyNames(source) : Object.keys(source)
    for (const key of keys) {
      if (array && !isArrayIndex(key, source.length)) continue
      const value = (source as Record<string, unknown>)[key]
      if (!isTrackableObject(value)) continue
      const raw = toRaw(value)
      if (bindings.has(raw)) continue
      const current = (target as Record<string, unknown>)[key]
      if (
        isTrackableObject(current) &&
        !isReadonly(current) &&
        !claimed.has(toRaw(current)) &&
        canPatch(current, raw) &&
        !Object.isFrozen(toRaw(current))
      ) {
        claim(current, raw)
      }
    }
  }

  const reactiveBindings = [...bindings]
  const sources = [...bindings.keys(), ...refs.map(({ value }) => value)]
  const resolve = createGraphResolver(bindings, findAffectedNodes(sources, bindings.keys()))

  for (const [source, target] of reactiveBindings) writeGraph(target, source, resolve)
  if (rootBindings) {
    const duplicateAnalysis = new Map<object, ReadonlySet<object>>()
    for (const [source, target] of duplicateRoots) {
      // The bound sources are identical across duplicates of this source.
      let affected = duplicateAnalysis.get(source)
      if (!affected) {
        affected = findAffectedNodes([source], rootBindings.keys())
        duplicateAnalysis.set(source, affected)
      }
      // Each target still needs its own back-references and cloned branches.
      const localBindings = new Map(rootBindings)
      localBindings.set(source, target)
      writeGraph(target, source, createGraphResolver(localBindings, affected))
    }
  }
  for (const { target, value } of refs) target.value = resolve(value)
}
