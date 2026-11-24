import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { reactive, shallowRef } from 'vue'
import { restoreState } from '../../src/runtime/app/state-snapshot.ts'

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

console.log(`Node ${process.version} on ${process.platform}/${process.arch}`)
for (const [name, { iterations, setup, snapshot, verify }] of Object.entries(cases)) {
  const example = setup()
  restoreState(example, snapshot)
  verify(example)

  const samples = []
  for (let sample = 0; sample < 9; sample++) {
    const targets = Array.from({ length: iterations }, setup)
    const start = performance.now()
    for (const target of targets) restoreState(target, snapshot)
    if (sample >= 2) samples.push((performance.now() - start) / iterations)
  }
  samples.sort((left, right) => left - right)
  console.log(`${name}\t${samples[3].toFixed(3)} ms`)
}
