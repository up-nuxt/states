import { isReactive, isReadonly, isRef, isShallow, toRaw } from 'vue'
import { getStateRegistry } from './state-registry'

export interface StateInspectorMember {
  name: string
  kind: string
  value: unknown
}

export interface StateInspectorEntry {
  key: string
  name: string
  source?: string
  origin?: string
  hydration: 'Hydrated' | 'No snapshot' | 'Server'
  members: StateInspectorMember[]
  totalMembers: number
}

export interface StateInspectorPage {
  active: StateInspectorEntry[]
  total: number
  pageSize: number
}

interface PreviewContext {
  seen: WeakMap<object, number>
  nodes: number
  truncated: boolean
}

const MAX_DEPTH = 4
const MAX_ITEMS = 40
const MAX_NODES = 200
const MAX_STRING = 500
const PAGE_SIZE = 20

export function inspectActiveStates(nuxtApp: object, query = '', page = 0): StateInspectorPage {
  const active: StateInspectorEntry[] = []
  const search = query.trim().toLowerCase()
  const offset = Number.isSafeInteger(page) && page > 0 ? page * PAGE_SIZE : 0
  let total = 0

  for (const [key, { debug }] of getStateRegistry(nuxtApp).active) {
    if (!debug) continue
    const name = debug.name || `State ${key}`
    if (search && !`${name} ${key}`.toLowerCase().includes(search)) continue
    const index = total++
    if (index < offset || active.length === PAGE_SIZE) continue

    active.push({
      key,
      name,
      source: debug.source,
      origin: debug.origin,
      hydration: debug.hydration,
      ...inspectMembers(debug.state),
    })
  }

  return { active, total, pageSize: PAGE_SIZE }
}

export function classifyStateMember(value: unknown): string {
  if (typeof value === 'function') return 'function'
  if (isRef(value)) {
    if (isReadonly(value)) return 'readonly ref'
    return isShallow(value) ? 'shallowRef' : 'ref'
  }
  if (isReactive(value)) {
    if (isReadonly(value)) return 'readonly'
    return isShallow(value) ? 'shallowReactive' : 'reactive'
  }
  if (isReadonly(value)) return 'readonly'
  return 'other'
}

export function previewValue(value: unknown): unknown {
  try {
    const context: PreviewContext = { seen: new WeakMap(), nodes: 0, truncated: false }
    const preview = visit(value, 0, context)

    return context.truncated ? { preview, truncated: true } : preview
  } catch (error) {
    return { unavailable: safeErrorMessage(error) }
  }
}

function inspectMembers(state: unknown): Pick<StateInspectorEntry, 'members' | 'totalMembers'> {
  if (!isObjectLike(state)) {
    return {
      members: [{ name: 'value', kind: classifyStateMember(state), value: previewValue(state) }],
      totalMembers: 1,
    }
  }

  try {
    const keys = Object.keys(state)
    const members = keys.slice(0, MAX_ITEMS).map((name) => {
      try {
        const value = state[name]
        return {
          name,
          kind: classifyStateMember(value),
          value: previewValue(isRef(value) ? value.value : value),
        }
      } catch (error) {
        return { name, kind: 'unavailable', value: { unavailable: safeErrorMessage(error) } }
      }
    })
    return { members, totalMembers: keys.length }
  } catch (error) {
    return {
      members: [
        { name: 'value', kind: 'unavailable', value: { unavailable: safeErrorMessage(error) } },
      ],
      totalMembers: 1,
    }
  }
}

function previewItems<T, R>(
  items: Iterable<T>,
  context: PreviewContext,
  render: (item: T) => R,
): R[] {
  const preview: R[] = []
  if (context.nodes >= MAX_NODES) return preview
  for (const item of items) {
    preview.push(render(item))
    if (preview.length === MAX_ITEMS || context.nodes >= MAX_NODES) break
  }
  return preview
}

function visit(value: unknown, depth: number, context: PreviewContext): unknown {
  if (context.nodes >= MAX_NODES) {
    context.truncated = true
    return { truncated: true }
  }
  const id = ++context.nodes
  if (typeof value === 'string') {
    if (value.length <= MAX_STRING) return value
    context.truncated = true
    return `${value.slice(0, MAX_STRING)}…`
  }
  if (value === null || ['number', 'boolean', 'undefined'].includes(typeof value)) return value
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'function') return `ƒ ${value.name || 'anonymous'}()`
  if (typeof value !== 'object') return String(value)

  const raw = isReactive(value) || isReadonly(value) ? toRaw(value) : value
  const known = context.seen.get(raw)
  if (known) return { reference: `#${known}` }

  context.seen.set(raw, id)
  if (depth >= MAX_DEPTH) {
    context.truncated = true
    return { id: `#${id}`, truncated: true }
  }

  if (raw instanceof Date) {
    return {
      id: `#${id}`,
      type: 'Date',
      value: Number.isNaN(raw.valueOf()) ? 'Invalid Date' : raw.toISOString(),
    }
  }
  if (raw instanceof Map) {
    const entries = previewItems(raw.entries(), context, ([key, item]) => [
      visit(key, depth + 1, context),
      visit(item, depth + 1, context),
    ])
    const truncated = raw.size > entries.length
    if (truncated) context.truncated = true
    return {
      id: `#${id}`,
      type: 'Map',
      entries,
      ...(truncated ? { truncated: true, total: raw.size } : {}),
    }
  }
  if (raw instanceof Set) {
    const values = previewItems(raw, context, (item) => visit(item, depth + 1, context))
    const truncated = raw.size > values.length
    if (truncated) context.truncated = true
    return {
      id: `#${id}`,
      type: 'Set',
      values,
      ...(truncated ? { truncated: true, total: raw.size } : {}),
    }
  }
  if (Array.isArray(raw)) {
    const values: unknown[] = []
    for (
      let index = 0;
      index < Math.min(raw.length, MAX_ITEMS) && context.nodes < MAX_NODES;
      index++
    ) {
      if (index in raw) values[index] = visit(raw[index], depth + 1, context)
      else values.length++
    }
    const truncated = raw.length > values.length
    if (truncated) context.truncated = true
    return {
      id: `#${id}`,
      type: 'Array',
      values,
      ...(truncated ? { truncated: true, total: raw.length } : {}),
    }
  }
  if (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null) {
    const constructor = (raw as { constructor?: { name?: string } }).constructor
    return { id: `#${id}`, unsupported: constructor?.name || 'Object' }
  }

  const keys = Object.keys(raw)
  const entries = previewItems(
    keys,
    context,
    (key) => [key, visit((raw as Record<string, unknown>)[key], depth + 1, context)] as const,
  )
  const truncated = keys.length > entries.length
  if (truncated) context.truncated = true
  return {
    id: `#${id}`,
    properties: Object.fromEntries(entries),
    ...(truncated ? { truncated: true, total: keys.length } : {}),
  }
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function safeErrorMessage(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : undefined
    if (typeof message === 'string') return message.slice(0, 200)
  } catch {
    // A thrown value can expose an accessor or a revoked proxy.
  }
  return 'Value could not be inspected'
}
