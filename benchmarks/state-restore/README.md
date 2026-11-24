# Runtime audit baseline

Recorded 2026-11-24 on Apple M4, macOS arm64, Node 24.22.2, Vue 3.5.45, Nuxt 4.6.4
and Nitro 2.13.6. Use the project's pinned dependencies when comparing results.

## Correctness

- `pnpm test` passed 127 tests, including browser hydration, the native DevTools dock,
  SSR errors and aborts, concurrent requests, Layers, and production route exclusion.
  Chromium headless-shell revision 1248 was used from the local cache after the CDN
  returned 403 for revision 1255.
- `pnpm test:stress` passed with 200 simultaneous SSR renders. The fixture releases
  the render barrier after all 200 arrive. TCP connections start in groups of 25
  to avoid overflowing the host's accept queue (128 on the audit machine).
- `pnpm run check`, `pnpm test:types`, `pnpm prepack`, `pnpm dev:build` and
  `pnpm bench:bundle-size` passed.
- The Vue tests assert root identity, sparse slots versus explicit `undefined`,
  aliasing, cycles, duplicate roots, readonly branches, collection storage and order,
  effect counts, and restore retries. A depth-1,500 plain-object graph round-tripped
  through Nuxt's installed devalue and the state engine on this host; the same
  constructed shape at depth 2,000 exceeded devalue's stack.
- Request tests cover cleanup through `finish`, `close`, and `afterResponse`, including
  late and throwing cleanup callbacks. Non-Node abort behavior remains adapter-specific.

## Initialization, snapshot, and restore

Run `pnpm bench:restore` on Node 24 or 26. The script performs two warm-up batches
and seven timed batches under normal GC, prints the iteration count for each case,
and reports the median and maximum of the batch means. Batch means reflect repeated
operations and cannot estimate per-call p95. Restore prepares fresh Vue instances
before timing and verifies the values or reference identities before recording samples.
Initialization runs the actual `defineState` wrapper with a Nuxt app lookup shim.
Snapshot timing covers capture. The accompanying byte count is the devalue-encoded
snapshot without the Nuxt envelope.

Final initialization medians in microseconds:

| Operation                        |    µs |
| -------------------------------- | ----: |
| Cached state access              | 0.015 |
| Cold keyed state                 | 0.147 |
| 100 keyed states in one app      | 27.60 |
| Detached effect scope start/stop | 0.048 |
| First registry access            | 0.128 |

| Snapshot                  | Capture median (µs) | Encoded bytes |
| ------------------------- | ------------------: | ------------: |
| Empty                     |               0.074 |  2 (sentinel) |
| Small                     |               0.054 |            43 |
| 1,000 refs                |              41.712 |        37,685 |
| Array with 20,000 values  |               0.213 |       217,843 |
| Map with 20,000 entries   |               0.180 |       326,753 |
| Set with 20,000 values    |               0.155 |       217,847 |
| 300 nested objects        |               0.074 |         3,867 |
| Shared and cyclic graph   |               0.115 |           135 |
| 100 keyed state snapshots |               7.363 |         4,883 |

Empty states are omitted from the registry's serialized state records. Nuxt can
still encode the namespace as `undefined` when it writes its envelope.

Restore medians in milliseconds for equivalent cases. Before uses the snapshot and
restore module at `f1577c4`; the harness and dependencies are the same. Array, Map,
and Set cases use 20,000 entries unless noted.

| Case                                   | Before |  After |
| -------------------------------------- | -----: | -----: |
| Small state                            | 0.0033 | 0.0034 |
| Array unchanged                        |  3.599 |  3.633 |
| Array with three changed slots         |  3.595 |  3.617 |
| Array with every slot changed          |  9.900 | 10.075 |
| Sparse array with 1M slots and a cycle |  2.238 |  2.250 |
| Array reusing 5,000 object members¹    | 10.634 | 10.257 |
| Map unchanged                          |  0.725 |  0.677 |
| Map with one changed value             |  0.694 |  0.672 |
| Map with every value changed           |  3.089 |  3.261 |
| Set unchanged                          |  0.165 |  0.161 |
| Set with one appended value            |  0.176 |  0.159 |
| Set with every member changed          |  2.836 |  3.066 |
| Unrelated Map containing objects       |  1.390 |  1.556 |
| 300 links to a reused root             | 0.0758 | 0.0816 |
| 16 duplicate roots with 5,000 rows     |  1.028 |  1.070 |
| Cyclic collections                     | 0.0025 | 0.0026 |

For a before/after run, save the earlier `state-snapshot.ts` in a temporary
directory with access to the same `node_modules`, then set
`STATES_BENCH_SNAPSHOT_MODULE` to its absolute path. The variable swaps only the
snapshot and restore module. Initialization always uses the current wrapper.

¹ This case was added for the repeat with the run order reversed. In that repeat,
the all-changed array took 11.341 → 10.172 ms, the all-changed Set took
2.869 → 2.842 ms, and the unrelated Map took 1.439 → 1.503 ms. The measurements
show run-to-run variation. The small repeatable increase in the unrelated Map
case warrants another comparison if that workload becomes significant.

The synchronous observer reran zero times for unchanged arrays, Maps, and Sets.
In the small instrumented cases, two changed array slots produced two reruns,
one changed Map value produced one, and a Set append produced one.

## SSR memory and payload

```sh
pnpm exec nuxt build test/fixtures/basic
node benchmarks/state-restore/ssr-memory.mjs
```

The script starts Nitro locally with `--expose-gc`, warms it with 100 requests,
checks a real scope disposal, then issues 400 serial and 400 batched requests.
Batch concurrency is 50. The server samples heap peaks every 10 ms and runs
three forced GCs before each retained-heap measurement.

| Phase                               | Retained heap (bytes) | RSS (bytes) | Sampled peak heap (bytes) |
| ----------------------------------- | --------------------: | ----------: | ------------------------: |
| Warm-up                             |            16,190,976 |  78,015,144 |                33,987,976 |
| 400 serial requests                 |            16,634,792 | 147,891,712 |                70,752,136 |
| First 200 requests in batches of 50 |            17,150,720 | 182,232,576 |                75,780,712 |
| All 400 requests in batches of 50   |            17,086,968 | 182,412,824 |                74,906,184 |

Retained heap rose by about 0.85 MiB from warm-up, then stayed flat across the
last two checkpoints. RSS stayed high after GC. This run measures the whole
Nitro process; sampled peak heap cannot represent total allocation volume or
attribute bytes to the module. The real `/hydration` fixture returned 2,483 HTML
bytes, including 384 bytes of Nuxt JSON payload.

## Production bundle

Run [the bundle benchmark](../bundle-size/README.md) to build all three
fixtures and measure per-asset compression. These are the totals for the built
counter applications, in bytes. Client JS is emitted by the production minifier.
Server JS is measured as emitted by Nitro, excluding external dependencies.

| Fixture / output     |     Raw |   Gzip | Brotli |
| -------------------- | ------: | -----: | -----: |
| Nuxt baseline client | 149,168 | 55,865 | 50,204 |
| State client         | 154,697 | 57,353 | 51,405 |
| Pinia client         | 155,108 | 57,805 | 51,925 |
| Nuxt baseline server | 303,263 | 81,940 | 71,305 |
| State server         | 318,381 | 85,767 | 74,580 |
| Pinia server         | 305,811 | 82,993 | 72,000 |

The state fixture passed the production assertions for DevTools exclusion on
both sides and Node response cleanup on the server only. In nine fresh Node
processes, timing `await import('@nuxt/devtools-kit')` after loading `@nuxt/kit`
gave a 0.72 ms median (0.68–0.88 ms); the build-time registration import remains
eager.
