import {
  computed,
  isReactive,
  isReadonly,
  isRef,
  isShallow,
  reactive,
  readonly,
  ref,
  shallowReactive,
  shallowReadonly,
  shallowRef,
  toRaw,
  watchEffect,
} from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { restoreState, snapshotState } from '../../src/runtime/app/state-snapshot'

describe('state snapshots', () => {
  it('captures mutable refs and reactive objects without runtime-only members', () => {
    const count = ref(10)
    const user = reactive({
      profile: { name: 'Nuxt', settings: { darkMode: true } },
      roles: ['admin', 'developer'],
    })
    const double = computed(() => count.value * 2)
    const increment = () => count.value++

    expect(snapshotState({ count, user, double, increment, plain: { value: 1 } })).toEqual({
      count: { type: 'ref', value: 10 },
      user: {
        type: 'reactive',
        value: {
          profile: { name: 'Nuxt', settings: { darkMode: true } },
          roles: ['admin', 'developer'],
        },
      },
    })
  })

  it('skips readonly refs and readonly reactive objects', () => {
    const source = ref(1)

    expect(
      snapshotState({
        computed: computed(() => source.value * 2),
        readonly: readonly({ value: 1 }),
      }),
    ).toBeUndefined()
  })

  it('hydrates a mutable source once and lets its returned readonly view update', () => {
    const count = ref(0)
    const publicCount = readonly(count)
    const state = { count, publicCount }

    expect(snapshotState(state)).toEqual({
      count: { type: 'ref', value: 0 },
    })

    restoreState(state, {
      count: { type: 'ref', value: 41 },
      publicCount: { type: 'ref', value: 99 },
    })

    expect(count.value).toBe(41)
    expect(publicCount.value).toBe(41)
  })

  it('characterizes writable computed refs as mutable through public Vue introspection', () => {
    const firstName = ref('Client')
    const lastName = ref('Initial')
    const setter = vi.fn((value: string) => {
      const [first = '', last = ''] = value.split(' ')
      firstName.value = first
      lastName.value = last
    })
    const fullName = computed({
      get: () => `${firstName.value} ${lastName.value}`,
      set: setter,
    })

    expect(isRef(fullName)).toBe(true)
    expect(isReadonly(fullName)).toBe(false)
    expect(isReactive(fullName)).toBe(false)
    expect(isShallow(fullName)).toBe(false)

    expect(snapshotState({ fullName })).toEqual({
      fullName: { type: 'ref', value: 'Client Initial' },
    })

    restoreState(
      { fullName },
      {
        fullName: { type: 'ref', value: 'Server User' },
      },
    )

    expect(setter).toHaveBeenCalledWith('Server User')
    expect(firstName.value).toBe('Server')
    expect(lastName.value).toBe('User')
  })

  it('restores refs while preserving their runtime identity', () => {
    const data = ref({ items: [{ id: 0, name: 'Initial' }] })
    const state = { data }

    restoreState(state, {
      data: {
        type: 'ref',
        value: {
          items: [
            { id: 1, name: 'A' },
            { id: 2, name: 'B' },
          ],
        },
      },
    })

    expect(state.data).toBe(data)
    expect(data.value.items).toEqual([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ])
  })

  it('restores shallowRef values without introducing deep reactivity', () => {
    const catalog = shallowRef({ version: 1, items: [{ id: 1, name: 'Initial' }] })
    const originalRef = catalog

    restoreState(
      { catalog },
      {
        catalog: {
          type: 'ref',
          value: { version: 2, items: [{ id: 2, name: 'Server' }] },
        },
      },
    )

    expect(catalog).toBe(originalRef)
    expect(catalog.value).toEqual({ version: 2, items: [{ id: 2, name: 'Server' }] })
    expect(isReactive(catalog.value)).toBe(false)
    expect(isReactive(catalog.value.items)).toBe(false)
  })

  it('patches shallowReactive roots without making nested objects reactive', () => {
    const state = shallowReactive({
      user: null as null | string,
      metadata: { version: 1, obsolete: true },
    })
    const originalProxy = state
    const originalMetadata = state.metadata

    restoreState(
      { state },
      {
        state: {
          type: 'reactive',
          value: { user: 'Server User', metadata: { version: 2 } },
        },
      },
    )

    expect(state).toBe(originalProxy)
    expect(state.metadata).toBe(originalMetadata)
    expect(state).toEqual({ user: 'Server User', metadata: { version: 2 } })
    expect(isReactive(state)).toBe(true)
    expect(isReactive(state.metadata)).toBe(false)
  })

  it('deeply patches reactive state while preserving existing object identities', () => {
    const user = reactive({
      profile: { name: 'Initial', settings: { darkMode: false } },
      roles: ['guest'],
      obsolete: true,
    })
    const profile = user.profile
    const settings = user.profile.settings
    const roles = user.roles

    restoreState(
      { user },
      {
        user: {
          type: 'reactive',
          value: {
            profile: { name: 'Server User', settings: { darkMode: true } },
            roles: ['admin', 'developer'],
          },
        },
      },
    )

    expect(user.profile).toBe(profile)
    expect(user.profile.settings).toBe(settings)
    expect(user.roles).toBe(roles)
    expect(user).toEqual({
      profile: { name: 'Server User', settings: { darkMode: true } },
      roles: ['admin', 'developer'],
    })
  })

  it.each([readonly, shallowReadonly, Object.freeze])(
    'replaces an immutable client branch with its server value and reconnects aliases (%s)',
    (wrap) => {
      const initial = wrap({ count: 0 })
      const state = reactive({ nested: initial })
      const alias = shallowRef()
      const server = { count: 41 }

      restoreState(
        { state, alias },
        {
          state: { type: 'reactive', value: { nested: server } },
          alias: { type: 'ref', value: server },
        },
      )

      expect(state.nested.count).toBe(41)
      expect(toRaw(state.nested)).toBe(toRaw(alias.value))
      expect(initial.count).toBe(0)
    },
  )

  it('handles array growth, shrinkage, replacement, null, undefined, and deletion', () => {
    const state = reactive({
      growing: [1],
      shrinking: [1, 2, 3],
      replaced: { old: true } as null | { old: boolean },
      optional: 'client' as string | undefined,
      obsolete: true,
    })

    restoreState(
      { state },
      {
        state: {
          type: 'reactive',
          value: {
            growing: [1, 2, 3],
            shrinking: [9],
            replaced: null,
            optional: undefined,
          },
        },
      },
    )

    expect(state).toEqual({
      growing: [1, 2, 3],
      shrinking: [9],
      replaced: null,
      optional: undefined,
    })
    expect('obsolete' in state).toBe(false)
  })

  it('removes stale own properties even when the source prototype has the same name', () => {
    const state = reactive({ toString: 'client' })

    restoreState({ state }, { state: { type: 'reactive', value: {} } })

    expect(Object.hasOwn(state, 'toString')).toBe(false)
  })

  it('preserves sparse array holes, explicit undefined, and nested references', () => {
    const array = reactive<unknown[]>(['stale', 'replace', { owner: null }, 'remove'])
    const member = array[2] as { owner: unknown }
    const source: unknown[] = []
    source.length = 1_000_000
    source[1] = undefined
    source[2] = { owner: source }
    source[999_999] = 'last'

    restoreState({ array }, { array: { type: 'reactive', value: source } })

    expect(array).toHaveLength(1_000_000)
    expect(Object.keys(array)).toEqual(['1', '2', '999999'])
    expect(array[1]).toBeUndefined()
    expect(array[2]).toBe(member)
    expect(member.owner).toBe(array)
    expect(array[999_999]).toBe('last')
    expect(Object.keys(source)).toEqual(['1', '2', '999999'])
  })

  it('normalizes a reused deep reactive array member as Vue would on assignment', () => {
    const member = reactive({ count: 0 })
    const array = reactive([member])
    expect(toRaw(array)[0]).toBe(member)

    restoreState({ array }, { array: { type: 'reactive', value: [{ count: 2 }] } })

    expect(array[0]).toBe(member)
    expect(toRaw(array)[0]).toBe(toRaw(member))
    expect(member.count).toBe(2)
  })

  it.each([reactive, shallowReactive])(
    'keeps arrays stable and notifies only for changed slots',
    (wrap) => {
      const array = wrap([1, 2, 3])
      const observed = vi.fn()
      const stop = watchEffect(() => observed([...array]), { flush: 'sync' })
      const apply = (value: number[]) =>
        restoreState({ array }, { array: { type: 'reactive', value } })

      try {
        apply([1, 2, 3])
        expect(observed.mock.calls).toEqual([[[1, 2, 3]]])
        observed.mockClear()
        apply([1, 2, 4])
        expect(observed.mock.calls).toEqual([[[1, 2, 4]]])
        apply([7, 6, 5])
        expect(array).toEqual([7, 6, 5])
      } finally {
        stop()
      }
    },
  )

  it.each([reactive, shallowReactive])(
    'matches Vue Set insertion semantics for wrapped members',
    (wrap) => {
      const raw = { count: 1 }
      const readonlyMember = readonly(raw)
      const reactiveMember = reactive(raw)
      const value = new Set([readonlyMember, raw, reactiveMember])
      const set = wrap(new Set([raw, { count: 0 }]))
      const expected = wrap(new Set())
      for (const member of value) expected.add(member)

      restoreState({ set }, { set: { type: 'reactive', value } })

      expect([...toRaw(set)]).toHaveLength(toRaw(expected).size)
      for (const [index, member] of [...toRaw(expected)].entries()) {
        expect([...toRaw(set)][index]).toBe(member)
      }
    },
  )

  it.each([reactive, shallowReactive])('keeps Set order and only changes its tail', (wrap) => {
    const set = wrap(new Set<unknown>([0, NaN, 'a']))
    const observe = vi.fn()
    const stop = watchEffect(() => observe([...set]), { flush: 'sync' })
    const apply = (...values: unknown[]) =>
      restoreState({ set }, { set: { type: 'reactive', value: new Set(values) } })

    try {
      apply(-0, NaN, 'a')
      expect(observe.mock.calls).toEqual([[[0, NaN, 'a']]])

      observe.mockClear()
      apply(0, NaN, 'a', 'b')
      expect(observe.mock.calls).toEqual([[[0, NaN, 'a', 'b']]])

      observe.mockClear()
      apply(0, NaN)
      expect(observe.mock.calls).toEqual([[[0, NaN, 'b']], [[0, NaN]]])

      apply(NaN, 0)
      expect([...set]).toEqual([NaN, 0])

      observe.mockClear()
      apply()
      expect(observe.mock.calls).toEqual([[[]]])
    } finally {
      stop()
    }
  })

  it('preserves Date, Map, and Set values through restoration', () => {
    const state = reactive({
      createdAt: new Date('2000-01-01T00:00:00.000Z'),
      tags: new Set(['client']),
      values: new Map([['client', 0]]),
    })
    const serverValues = {
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      tags: new Set(['a', 'b']),
      values: new Map([
        ['a', 1],
        ['b', 2],
      ]),
    }

    restoreState(
      { state },
      {
        state: { type: 'reactive', value: serverValues },
      },
    )

    expect(state.createdAt).toBeInstanceOf(Date)
    expect(state.createdAt.toISOString()).toBe('2026-01-02T03:04:05.000Z')
    expect([...state.tags]).toEqual(['a', 'b'])
    expect([...state.values]).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('preserves shared references from the server graph', () => {
    const state = reactive({
      a: { value: 0 },
      b: { value: 0 },
    })
    const shared = { value: 41 }

    restoreState(
      { state },
      {
        state: { type: 'reactive', value: { a: shared, b: shared } },
      },
    )

    expect(state.a.value).toBe(41)
    expect(state.a).toBe(state.b)
  })

  it.each([reactive, shallowReactive])('hydrates returned collection roots with %s', (wrap) => {
    const map = wrap(new Map<unknown, unknown>([['stale', 1]]))
    const set = wrap(new Set<unknown>(['stale']))
    const mapRef = ref(map)
    const serverMap = new Map<unknown, unknown>()
    const serverSet = new Set<unknown>()
    serverMap.set('entries', serverSet)
    serverMap.set(serverMap, 'self')
    serverSet.add(serverMap)

    restoreState(
      { map, set, mapRef },
      {
        mapRef: { type: 'ref', value: serverMap },
        map: { type: 'reactive', value: serverMap },
        set: { type: 'reactive', value: serverSet },
      },
    )

    expect(mapRef.value).toBe(map)
    expect(map.get('entries')).toBe(set)
    expect(map.get(map)).toBe('self')
    expect(map.has('stale')).toBe(false)
    expect([...set][0]).toBe(map)
    expect(set.size).toBe(1)
  })

  it('keeps entries if a collection snapshot already shares the target', () => {
    const map = reactive(new Map([['value', 42]]))
    const set = reactive(new Set([42]))

    restoreState({ map, set }, snapshotState({ map, set }))

    expect([...map]).toEqual([['value', 42]])
    expect([...set]).toEqual([42])
  })

  it('only notifies synchronous observers for changed values when Map keys stay in order', () => {
    const map = reactive(
      new Map([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]),
    )
    const observe = vi.fn()
    const stop = watchEffect(() => observe([...map]), { flush: 'sync' })
    const snapshot = (entries: [string, number][]) => ({
      map: { type: 'reactive', value: new Map(entries) },
    })

    try {
      restoreState(
        { map },
        snapshot([
          ['a', 1],
          ['b', 2],
          ['c', 3],
        ]),
      )
      expect(observe).toHaveBeenCalledOnce()
      restoreState(
        { map },
        snapshot([
          ['a', 1],
          ['b', 42],
          ['c', 3],
        ]),
      )
      expect(observe).toHaveBeenCalledTimes(2)
      expect(observe).toHaveBeenLastCalledWith([
        ['a', 1],
        ['b', 42],
        ['c', 3],
      ])
      restoreState(
        { map },
        snapshot([
          ['c', 3],
          ['b', 42],
          ['a', 1],
        ]),
      )
      expect([...map]).toEqual([
        ['c', 3],
        ['b', 42],
        ['a', 1],
      ])
      restoreState(
        { map },
        snapshot([
          ['d', 4],
          ['b', 42],
          ['a', 1],
        ]),
      )
      expect([...map]).toEqual([
        ['d', 4],
        ['b', 42],
        ['a', 1],
      ])
    } finally {
      stop()
    }
  })

  it.each([reactive, shallowReactive])('preserves Map storage semantics for %s', (wrap) => {
    const root = reactive({ value: 0 })
    const serverRoot = { value: 42 }
    const readonlyValue = readonly({ value: 1 })
    const shallowValue = shallowReactive({ nested: { value: 2 } })
    const values = new Map<unknown, unknown>([
      [toRaw(root), wrap === shallowReactive ? toRaw(root) : root],
      [NaN, readonlyValue],
      ['shallow', shallowValue],
    ])
    const map = wrap(values)
    const observe = vi.fn()
    const stop = watchEffect(() => observe(map.size), { flush: 'sync' })

    try {
      restoreState(
        { root, map },
        {
          root: { type: 'reactive', value: serverRoot },
          map: {
            type: 'reactive',
            value: new Map<unknown, unknown>([
              [serverRoot, serverRoot],
              [NaN, readonlyValue],
              ['shallow', shallowValue],
            ]),
          },
        },
      )

      expect([...values.keys()][0]).toBe(toRaw(root))
      expect(values.get(toRaw(root))).toBe(wrap === shallowReactive ? root : toRaw(root))
      expect(values.get(NaN)).toBe(readonlyValue)
      expect(values.get('shallow')).toBe(shallowValue)
      expect(observe).toHaveBeenCalledTimes(2)
    } finally {
      stop()
    }
  })

  it('restores cyclic objects without recursion overflow', () => {
    interface CyclicValue {
      value: string
      self?: CyclicValue
    }

    const clientCycle: CyclicValue = { value: 'client' }
    clientCycle.self = clientCycle
    const state = reactive({ cycle: clientCycle })
    const serverCycle: CyclicValue = { value: 'server' }
    serverCycle.self = serverCycle

    restoreState(
      { state },
      {
        state: { type: 'reactive', value: { cycle: serverCycle } },
      },
    )

    expect(state.cycle.value).toBe('server')
    expect(state.cycle.self).toBe(state.cycle)
  })

  it.each([false, true])(
    'links refs back to the reused reactive root (ref first: %s)',
    (refFirst) => {
      const user = reactive({ name: 'Client' })
      const selected = ref(user)
      const serverUser = { name: 'Server' }
      const userSnapshot = { type: 'reactive', value: serverUser }
      const selectedSnapshot = { type: 'ref', value: serverUser }

      restoreState(
        { user, selected },
        refFirst
          ? { selected: selectedSnapshot, user: userSnapshot }
          : { user: userSnapshot, selected: selectedSnapshot },
      )

      expect(selected.value).toBe(user)
      user.name = 'Updated'
      expect(selected.value.name).toBe('Updated')
    },
  )

  it('splits an aliased client branch when the payload has distinct objects', () => {
    const shared = { value: 0 }
    const state = reactive({ first: shared, second: shared })
    const first = state.first

    restoreState(
      { state },
      { state: { type: 'reactive', value: { first: { value: 1 }, second: { value: 2 } } } },
    )

    expect(state.first).toBe(first)
    expect(state.first).not.toBe(state.second)
    expect([state.first.value, state.second.value]).toEqual([1, 2])
  })

  it('keeps duplicate reactive roots distinct and restores each root’s own cycles', () => {
    interface Root {
      self?: Root
      nested?: { owner: Root }
    }
    const first = reactive<Root>({})
    const second = reactive<Root>({})
    const external = ref<Root>()
    const source: Root = {}
    source.self = source
    source.nested = { owner: source }

    restoreState(
      { first, second, external },
      {
        first: { type: 'reactive', value: source },
        second: { type: 'reactive', value: source },
        external: { type: 'ref', value: source },
      },
    )

    expect(first).not.toBe(second)
    expect(first.self).toBe(first)
    expect(first.nested?.owner).toBe(first)
    expect(second.self).toBe(second)
    expect(second.nested?.owner).toBe(second)
    expect(external.value).toBe(first)
  })

  it('restores self-references in duplicate Map and Set roots', () => {
    const firstMap = reactive(new Map<unknown, unknown>())
    const secondMap = reactive(new Map<unknown, unknown>())
    const firstSet = reactive(new Set<unknown>())
    const secondSet = reactive(new Set<unknown>())
    const map = new Map<unknown, unknown>()
    const set = new Set<unknown>()
    map.set(map, map)
    set.add(set)

    restoreState(
      { firstMap, secondMap, firstSet, secondSet },
      {
        firstMap: { type: 'reactive', value: map },
        secondMap: { type: 'reactive', value: map },
        firstSet: { type: 'reactive', value: set },
        secondSet: { type: 'reactive', value: set },
      },
    )

    expect(firstMap.get(firstMap)).toBe(firstMap)
    expect(secondMap.get(secondMap)).toBe(secondMap)
    expect([...firstSet][0]).toBe(firstSet)
    expect([...secondSet][0]).toBe(secondSet)
  })

  it('reuses duplicate Map analysis without sharing the restored branches', () => {
    const source = new Map<string, unknown>()
    source.set('branch', { parent: source })
    const scan = vi.spyOn(source, 'forEach')
    const first = reactive(new Map())
    const second = reactive(new Map())
    const third = reactive(new Map())
    const entry = { type: 'reactive', value: source }

    restoreState({ first, second, third }, { first: entry, second: entry, third: entry })

    expect(first.get('branch').parent).toBe(first)
    expect(second.get('branch').parent).toBe(second)
    expect(third.get('branch').parent).toBe(third)
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('relinks new branches and cycles without modifying the payload graph', () => {
    const user = reactive({ name: 'Client' })
    const detail = ref<{ people: Map<{ name: string }, unknown> }>()
    const serverUser = { name: 'Server' }
    const people = new Map<{ name: string }, unknown>()
    const serverDetail = { people }
    people.set(serverUser, serverDetail)

    restoreState(
      { user, detail },
      {
        user: { type: 'reactive', value: serverUser },
        detail: { type: 'ref', value: serverDetail },
      },
    )

    expect(detail.value!.people.keys().next().value).toBe(user)
    expect(detail.value!.people.get(user)).toBe(detail.value)
    expect(people.get(serverUser)).toBe(serverDetail)
  })

  it('reuses untouched payload objects even when it patches another reactive member', () => {
    const state = reactive({ value: 0 })
    const data = shallowRef()
    const payloadData = { entries: [{ id: 1 }] }

    restoreState(
      { state, data },
      {
        state: { type: 'reactive', value: { value: 1 } },
        data: { type: 'ref', value: payloadData },
      },
    )

    expect(data.value).toBe(payloadData)
  })

  it('keeps computed values and functions connected to hydrated state', () => {
    const count = ref(0)
    const double = computed(() => count.value * 2)
    const increment = () => count.value++
    const state = { count, double, increment }

    restoreState(state, {
      count: { type: 'ref', value: 41 },
    })

    expect(state.double.value).toBe(82)
    state.increment()
    expect(state.count.value).toBe(42)
    expect(state.double.value).toBe(84)
  })

  it('recomputes a chain of readonly computed refs from hydrated state', () => {
    const a = ref(1)
    const b = computed(() => a.value + 1)
    const c = computed(() => b.value + 1)

    restoreState(
      { a, b, c },
      {
        a: { type: 'ref', value: 40 },
      },
    )

    expect(b.value).toBe(41)
    expect(c.value).toBe(42)
    expect(snapshotState({ a, b, c })).toEqual({
      a: { type: 'ref', value: 40 },
    })
  })

  it('preserves Vue nested-ref behavior inside reactive and ref state', () => {
    const current = ref(1)
    const reactiveState = reactive({ current })
    const refState = ref({ nested: { value: 1 } })

    restoreState(
      { reactiveState, refState },
      {
        reactiveState: { type: 'reactive', value: { current: 5 } },
        refState: { type: 'ref', value: { nested: { value: 6 } } },
      },
    )

    expect(reactiveState.current).toBe(5)
    expect(current.value).toBe(5)
    expect(refState.value.nested.value).toBe(6)
  })

  it('characterizes non-composable return shapes as non-hydratable', () => {
    expect(snapshotState(ref(1))).toBeUndefined()
    expect(snapshotState(reactive({ count: 1 }))).toBeUndefined()
    expect(snapshotState(() => undefined)).toBeUndefined()
  })

  it('ignores malformed or incompatible snapshot entries', () => {
    const count = ref(1)
    const user = reactive({ name: 'Initial' })

    restoreState(
      { count, user },
      {
        count: { type: 'reactive', value: { invalid: true } },
        user: { type: 'unknown', value: { name: 'Invalid' } },
        missing: { type: 'ref', value: 2 },
      },
    )

    expect(count.value).toBe(1)
    expect(user.name).toBe('Initial')
  })
})
