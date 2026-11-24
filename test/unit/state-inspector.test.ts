import { computed, reactive, readonly, ref, shallowReactive, shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  classifyStateMember,
  inspectActiveStates,
  previewValue,
} from '../../src/runtime/app/state-inspector'
import {
  receiveStateSnapshots,
  registerHydratableState,
} from '../../src/runtime/app/state-registry'

function registerDebugState(
  nuxtApp: object,
  key: string,
  state: unknown,
  hydration: 'Hydrated' | 'No snapshot' | 'Server' = 'No snapshot',
): void {
  const debug = { state, hydration }
  registerHydratableState(nuxtApp, key, {
    snapshot: vi.fn(),
    restore: vi.fn(() => {
      debug.hydration = 'Hydrated'
    }),
    debug,
  })
}

describe('development state inspector', () => {
  it('lists only active states without invoking lazy factories', () => {
    const nuxtApp = {}
    const lazyFactory = vi.fn()

    registerDebugState(nuxtApp, '$active', { count: ref(1) })

    expect(inspectActiveStates(nuxtApp).active).toHaveLength(1)
    expect(lazyFactory).not.toHaveBeenCalled()
  })

  it('evaluates getters only for matching states on the requested page', () => {
    const nuxtApp = {}
    const readers = Array.from({ length: 45 }, (_, index) => vi.fn(() => index))
    for (const [index, get] of readers.entries()) {
      const state = Object.defineProperty({}, 'count', { enumerable: true, get })
      registerDebugState(nuxtApp, `$${index < 42 ? 'match' : 'other'}-${index}`, state)
    }

    const { active, total, pageSize } = inspectActiveStates(nuxtApp, ' MATCH ', 1)

    expect(total).toBe(42)
    expect(active.map(({ members }) => members[0]?.value)).toEqual(
      Array.from({ length: pageSize }, (_, index) => index + pageSize),
    )
    for (const [index, read] of readers.entries()) {
      expect(read).toHaveBeenCalledTimes(Number(index >= pageSize && index < pageSize * 2))
    }
    expect(inspectActiveStates(nuxtApp, 'match', 2).active.map(({ key }) => key)).toEqual([
      '$match-40',
      '$match-41',
    ])
    expect(inspectActiveStates(nuxtApp, 'missing').active).toEqual([])
  })

  it('uses conservative public Vue member classifications', () => {
    const source = ref(1)

    expect(classifyStateMember(ref(1))).toBe('ref')
    expect(classifyStateMember(shallowRef({}))).toBe('shallowRef')
    expect(classifyStateMember(reactive({}))).toBe('reactive')
    expect(classifyStateMember(shallowReactive({}))).toBe('shallowReactive')
    expect(classifyStateMember(readonly({}))).toBe('readonly')
    expect(classifyStateMember(computed(() => source.value))).toBe('readonly ref')
    expect(classifyStateMember(() => undefined)).toBe('function')
    expect(classifyStateMember({})).toBe('other')
  })

  it('returns bounded safe previews for functions, cycles, and large values', () => {
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    const preview = previewValue({
      action: function increment() {},
      cycle,
      large: 'x'.repeat(2_000),
      many: Array.from({ length: 100 }, (_, index) => index),
      date: new Date('2026-01-02T03:04:05.000Z'),
      map: new Map([['a', 1]]),
      set: new Set(['a']),
    })
    const serialized = JSON.stringify(preview)

    expect(serialized).toContain('ƒ increment()')
    expect(serialized).toContain('"reference":"#')
    expect(serialized).toContain('"truncated":true')
    expect(serialized.length).toBeLessThan(8_000)
  })

  it('contains unusual member failures instead of crashing the application', () => {
    const nuxtApp = {}
    const unusual = Object.defineProperty({}, 'broken', {
      enumerable: true,
      get() {
        throw new Error('getter failed')
      },
    })
    registerDebugState(nuxtApp, '$unusual', unusual)

    expect(inspectActiveStates(nuxtApp).active[0]?.members).toEqual([
      {
        name: 'broken',
        kind: 'unavailable',
        value: { unavailable: 'getter failed' },
      },
    ])
    expect(
      previewValue(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error('proxy failed')
            },
          },
        ),
      ),
    ).toEqual({ unavailable: 'proxy failed' })
  })

  it('reads only the previewed items from large Maps and Sets', () => {
    const values = Array.from({ length: 1_000 }, (_, index) => index)
    const map = new Map(values.map((value) => [value, value]))
    const set = new Set(values)
    const mapIterator = map.entries()
    const setIterator = set.values()
    const mapNext = vi.spyOn(mapIterator, 'next')
    const setNext = vi.spyOn(setIterator, 'next')
    vi.spyOn(map, 'entries').mockReturnValue(mapIterator)
    vi.spyOn(set, Symbol.iterator).mockReturnValue(setIterator)

    expect(previewValue(map)).toMatchObject({
      preview: {
        type: 'Map',
        entries: values.slice(0, 40).map((value) => [value, value]),
        total: 1_000,
      },
      truncated: true,
    })
    expect(previewValue(set)).toMatchObject({
      preview: { type: 'Set', values: values.slice(0, 40), total: 1_000 },
      truncated: true,
    })
    expect(mapNext).toHaveBeenCalledTimes(40)
    expect(setNext).toHaveBeenCalledTimes(40)
  })

  it('reads only visible object getters and skips a throwing getter beyond the limit', () => {
    const read = vi.fn(() => 1)
    const input = Object.defineProperties(
      {},
      Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [`key${index}`, { enumerable: true, get: read }]),
      ),
    )
    const outside = vi.fn(() => {
      throw new Error('outside preview')
    })
    Object.defineProperty(input, 'outside', { enumerable: true, get: outside })

    const properties = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`key${index}`, 1]),
    )
    expect(previewValue(input)).toMatchObject({
      preview: { properties, total: 101, truncated: true },
      truncated: true,
    })
    expect(read).toHaveBeenCalledTimes(40)
    expect(outside).not.toHaveBeenCalled()
  })

  it('stops reading nested getters when the preview budget runs out', () => {
    const read = vi.fn(() => 1)
    const object = () =>
      Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => {
          const leaf = Object.defineProperty({}, 'value', { enumerable: true, get: read })
          return [index, leaf]
        }),
      )
    const preview = previewValue(Array.from({ length: 40 }, object))

    expect(preview).toMatchObject({ truncated: true })
    expect(read.mock.calls.length).toBeGreaterThan(0)
    expect(read.mock.calls.length).toBeLessThanOrEqual(100)
  })

  it('bounds top-level member reads and reports omitted members', () => {
    const nuxtApp = {}
    const read = vi.fn(() => 1)
    const state = Object.defineProperties(
      {},
      Object.fromEntries(
        Array.from({ length: 120 }, (_, index) => [index, { enumerable: true, get: read }]),
      ),
    )
    registerDebugState(nuxtApp, '$large', state)

    expect(inspectActiveStates(nuxtApp).active[0]).toMatchObject({ totalMembers: 120 })
    expect(read).toHaveBeenCalledTimes(40)
  })

  it('contains errors whose message cannot be read', () => {
    const error = Object.defineProperty(new Error(), 'message', {
      get() {
        throw new Error('message is unavailable')
      },
    })
    const state = Object.defineProperty({}, 'broken', {
      enumerable: true,
      get() {
        throw error
      },
    })
    const nuxtApp = {}
    registerDebugState(nuxtApp, '$error', state)

    expect(previewValue(state)).toEqual({ unavailable: 'Value could not be inspected' })
    expect(inspectActiveStates(nuxtApp).active[0]?.members[0]?.kind).toBe('unavailable')
  })

  it('reflects current values on demand without watchers', () => {
    const nuxtApp = {}
    const count = ref(1)
    registerDebugState(nuxtApp, '$counter', { count })

    expect(inspectActiveStates(nuxtApp).active[0]?.members[0]?.value).toBe(1)
    count.value = 2
    expect(inspectActiveStates(nuxtApp).active[0]?.members[0]?.value).toBe(2)
  })

  it('replaces HMR entries instead of retaining stale state cards', () => {
    const nuxtApp = {}
    registerDebugState(nuxtApp, '$counter', { count: ref(1) })
    registerDebugState(nuxtApp, '$counter', { count: ref(2) })

    const inspected = inspectActiveStates(nuxtApp).active
    expect(inspected).toHaveLength(1)
    expect(inspected[0]?.members[0]?.value).toBe(2)
  })

  it('reports hydrated states and states without a snapshot accurately', () => {
    const nuxtApp = {}
    receiveStateSnapshots(nuxtApp, { $hydrated: { count: 1 } })
    registerDebugState(nuxtApp, '$hydrated', { count: ref(1) })
    registerDebugState(nuxtApp, '$client', { count: ref(0) })

    expect(
      inspectActiveStates(nuxtApp).active.map(({ key, hydration }) => [key, hydration]),
    ).toEqual([
      ['$hydrated', 'Hydrated'],
      ['$client', 'No snapshot'],
    ])
  })
})
