import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { effectScope, reactive, ref, shallowRef, version, watchEffect } from 'vue'
import { collectStateSnapshots, getStateRegistry } from '../../src/runtime/app/state-registry.ts'

const { restoreState, snapshotState } = await import(
  process.env.STATES_BENCH_SNAPSHOT_MODULE
    ? pathToFileURL(process.env.STATES_BENCH_SNAPSHOT_MODULE).href
    : '../../src/runtime/app/state-snapshot.ts'
)
const require = createRequire(import.meta.url)
const nuxtRequire = createRequire(require.resolve('nuxt/package.json'))
const { stringify } = await import(pathToFileURL(nuxtRequire.resolve('devalue')).href)

// Only the Nuxt app lookup is substituted. Initialization uses the actual runtime and Vue.
const appMock =
  'data:text/javascript,' +
  encodeURIComponent(`
  let app
  export const useNuxtApp = () => app
  export const useRequestEvent = () => undefined
  export const setCurrentNuxtApp = (next) => { app = next }
`)
const runtime = new URL('../../src/runtime/', import.meta.url).href
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '#app') return nextResolve(appMock, context)
    if (
      context.parentURL?.startsWith(runtime) &&
      specifier.startsWith('.') &&
      !specifier.endsWith('.ts')
    ) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})
const { defineState } = await import('../../src/runtime/app/composables/defineState.ts')
const { setCurrentNuxtApp } = await import(appMock)
hooks.deregister()

function unrelatedCollection(size, createValue) {
  const payload = new Map(Array.from({ length: size }, (_, index) => [index, createValue(index)]))
  return {
    iterations: size >= 20_000 ? 20 : 100,
    snapshot: {
      state: { type: 'reactive', value: { count: 42 } },
      data: { type: 'ref', value: payload },
    },
    setup: () => ({ state: reactive({ count: 0 }), data: shallowRef() }),
    verify: ({ state, data }) => {
      assert.equal(state.count, 42)
      assert.equal(data.value, payload)
    },
  }
}

const mapEntries = Array.from({ length: 20_000 }, (_, index) => [index, index])
function reactiveMap(entries) {
  return {
    iterations: 12,
    snapshot: { map: { type: 'reactive', value: new Map(entries) } },
    setup: () => ({ map: reactive(new Map(mapEntries)) }),
    verify: ({ map }) => assert.deepEqual([...map], entries),
  }
}

const values = Array.from({ length: 20_000 }, (_, index) => index)
function reactiveArray(items) {
  return {
    iterations: 12,
    snapshot: { array: { type: 'reactive', value: items } },
    setup: () => ({ array: reactive([...values]) }),
    verify: ({ array }) => assert.deepEqual([...array], items),
  }
}

function reactiveSet(items) {
  return {
    iterations: 12,
    snapshot: { set: { type: 'reactive', value: new Set(items) } },
    setup: () => ({ set: reactive(new Set(values)) }),
    verify: ({ set }) => assert.deepEqual([...set], items),
  }
}

const duplicateSource = { rows: Array.from({ length: 5_000 }, (_, index) => ({ index })) }
duplicateSource.cycle = { owner: duplicateSource }
const duplicateNames = Array.from({ length: 16 }, (_, index) => `root${index}`)

const shared = { count: 42 }
const cycle = { owner: shared }
cycle.self = cycle
const connected = new Map([
  ['cycle', cycle],
  ['owner', shared],
])
const sparse = []
sparse.length = 1_000_000
sparse[11] = undefined
sparse[999_999] = sparse
const deep = { root: shared }
for (let i = 0; i < 300; i++) deep.root = { next: deep.root }
const cases = {
  small: unrelatedCollection(8, (index) => index),
  'unrelated Map with 2,000 scalar values': unrelatedCollection(2_000, (index) => index),
  'unrelated Map with 20,000 scalar values': unrelatedCollection(20_000, (index) => index),
  'unrelated Map with 20,000 objects': unrelatedCollection(20_000, (index) => ({ index })),
  'reactive Map with unchanged keys and values': reactiveMap(mapEntries),
  'reactive Map with only its final value changed': reactiveMap([
    ...mapEntries.slice(0, -1),
    [19_999, -1],
  ]),
  'reactive Map with reversed order': reactiveMap([...mapEntries].reverse()),
  'reactive Map with every value changed': reactiveMap(mapEntries.map(([key]) => [key, -key - 1])),
  'dense reactive array with unchanged values': reactiveArray(values),
  'dense reactive array with 3 changed values': reactiveArray([...values.slice(0, -3), -1, -2, -3]),
  'dense reactive array with every value changed': reactiveArray(values.map((value) => -value - 1)),
  'sparse array with 1,000,000 slots and a cycle': {
    iterations: 100,
    snapshot: { array: { type: 'reactive', value: sparse } },
    setup: () => ({ array: reactive(['stale']) }),
    verify: ({ array }) => {
      assert.equal(array.length, sparse.length)
      assert.deepEqual(Object.keys(array), ['11', '999999'])
      assert.equal(array[999_999], array)
    },
  },
  'array with 5,000 reused object members': {
    iterations: 12,
    snapshot: { array: { type: 'reactive', value: duplicateSource.rows } },
    setup: () => {
      const array = reactive(Array.from({ length: 5_000 }, () => ({ index: -1 })))
      return { array, first: array[0] }
    },
    verify: ({ array, first }) => {
      assert.equal(array[0], first)
      assert.equal(array[0].index, 0)
      assert.equal(array[4_999].index, 4_999)
    },
  },
  'reactive Set with unchanged order and values': reactiveSet(values),
  'reactive Set with one appended value': reactiveSet([...values, -1]),
  'reactive Set with one removed tail value': reactiveSet(values.slice(0, -1)),
  'reactive Set cleared by the snapshot': reactiveSet([]),
  'reactive Set with reversed order': reactiveSet([...values].reverse()),
  'reactive Set with every member changed': reactiveSet(values.map((value) => -value - 1)),
  '300 nested objects pointing to a reused root': {
    iterations: 100,
    snapshot: {
      state: { type: 'reactive', value: shared },
      data: { type: 'ref', value: deep },
    },
    setup: () => ({ state: reactive({ count: 0 }), data: shallowRef() }),
    verify: ({ state, data }) => {
      let value = data.value.root
      for (let i = 0; i < 300; i++) value = value.next
      assert.equal(value, state)
    },
  },
  '16 reactive roots sharing a source with 5,000 rows': {
    iterations: 12,
    snapshot: Object.fromEntries(
      duplicateNames.map((name) => [name, { type: 'reactive', value: duplicateSource }]),
    ),
    setup: () => Object.fromEntries(duplicateNames.map((name) => [name, reactive({})])),
    verify: (targets) => {
      assert.equal(new Set(Object.values(targets)).size, duplicateNames.length)
      for (const root of Object.values(targets)) assert.equal(root.cycle.owner, root)
    },
  },
  'cyclic collections linked to a reactive root': {
    iterations: 1_000,
    snapshot: {
      state: { type: 'reactive', value: shared },
      data: { type: 'ref', value: connected },
    },
    setup: () => ({ state: reactive({ count: 0 }), data: shallowRef() }),
    verify: ({ state, data }) => {
      const restoredCycle = data.value.get('cycle')
      assert.equal(data.value.get('owner'), state)
      assert.equal(restoredCycle.owner, state)
      assert.equal(restoredCycle.self, restoredCycle)
    },
  },
}

function measure(name, iterations, setup, run) {
  const samples = []
  for (let sample = 0; sample < 9; sample++) {
    const targets = Array.from({ length: iterations }, setup)
    const start = performance.now()
    for (const target of targets) run(target)
    if (sample >= 2) samples.push((performance.now() - start) / iterations)
  }
  samples.sort((left, right) => left - right)
  console.log(
    `${name}\t${iterations} calls/batch\tmedian ${samples[3].toFixed(6)} ms\tmax batch mean ${samples[6].toFixed(6)} ms`,
  )
}

console.log(
  `Node ${process.version}, Vue ${version}, Nuxt ${require('nuxt/package.json').version}; ${process.platform}/${process.arch} ${cpus()[0]?.model}`,
)
console.log('2 warm-up + 7 timed batches per case; regular GC')
console.log('\nRestore')
for (const [name, { iterations, setup, snapshot, verify }] of Object.entries(cases)) {
  const example = setup()
  restoreState(example, snapshot)
  verify(example)
  measure(name, iterations, setup, (target) => restoreState(target, snapshot))
}

console.log('\nInitialization')
const useState = defineState(() => ({ count: ref(0) }), '$bench')
const many = Array.from({ length: 100 }, (_, i) => defineState(() => ({ count: ref(i) }), `$${i}`))
setCurrentNuxtApp({})
assert.equal(useState(), useState())
measure(
  'cached defineState access',
  100_000,
  () => undefined,
  () => useState(),
)
measure(
  'cold keyed defineState',
  2_000,
  () => ({}),
  (app) => {
    setCurrentNuxtApp(app)
    useState()
  },
)
measure(
  '100 cold states in one app',
  100,
  () => ({}),
  (app) => {
    setCurrentNuxtApp(app)
    for (const useInstance of many) useInstance()
  },
)
measure(
  'detached scope create/stop',
  20_000,
  () => undefined,
  () => effectScope(true).stop(),
)
measure('first registry access', 10_000, () => ({}), getStateRegistry)

console.log('\nSnapshot (capture latency and devalue bytes before Nuxt envelope)')
const snapshots = {
  empty: { action() {} },
  small: { count: ref(42) },
  '1,000 refs': Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [i, ref(i)])),
  '20,000 array values': { array: reactive(values) },
  '20,000 Map entries': { map: reactive(new Map(mapEntries)) },
  '20,000 Set values': { set: reactive(new Set(values)) },
  '300 nested objects': { data: shallowRef(deep) },
  'shared and cyclic graph': { one: shallowRef(shared), two: shallowRef(connected) },
}
for (const [name, state] of Object.entries(snapshots)) {
  measure(
    `${name} (${Buffer.byteLength(stringify(snapshotState(state)))} B)`,
    name === '1,000 refs' ? 300 : 2_000,
    () => state,
    snapshotState,
  )
}
const app = {}
setCurrentNuxtApp(app)
for (const useInstance of many) useInstance()
measure(
  `100 keyed snapshots (${Buffer.byteLength(stringify(collectStateSnapshots(app)))} B)`,
  300,
  () => app,
  collectStateSnapshots,
)

console.log('\nSynchronous Vue effects (reruns after initial observation)')
for (const [name, target, source] of [
  ['array unchanged', reactive([1, 2, 3]), [1, 2, 3]],
  ['array partial', reactive([1, 2, 3]), [1, 3, 2]],
  ['map unchanged', reactive(new Map([[1, 1]])), new Map([[1, 1]])],
  ['map one change', reactive(new Map([[1, 1]])), new Map([[1, 2]])],
  ['set unchanged', reactive(new Set([1, 2])), new Set([1, 2])],
  ['set append', reactive(new Set([1, 2])), new Set([1, 2, 3])],
]) {
  let runs = 0
  const stop = watchEffect(
    () => {
      runs++
      for (const value of target.values()) void value
    },
    { flush: 'sync' },
  )
  restoreState({ target }, { target: { type: 'reactive', value: source } })
  stop()
  console.log(`${name}\t${runs - 1}`)
}
