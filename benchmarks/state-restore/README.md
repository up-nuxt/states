# State restore benchmark

Run `pnpm bench:restore` on Node.js 24 or 26. The benchmark measures the median time per
`restoreState` call over seven samples after two warm-up batches. It prepares fresh Vue
state instances before timing each batch. The snapshots are reused across iterations.

The cases cover a small state, unrelated Maps with scalar and object values, and a cyclic
graph with a Map linked to a returned reactive root. Each case checks values and reference
identity before timing. The timings measure restoration in isolation and exclude Nuxt
rendering, payload serialization, and browser hydration.
