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
