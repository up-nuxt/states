# Bundle-size benchmark

This benchmark compares the production client JavaScript added by `@up-nuxt/states`
and `@pinia/nuxt` for the same small counter.

It builds three Nuxt applications:

- `baseline`: the same UI backed by Nuxt's built-in `useState`
- `@up-nuxt/states`: the UI backed by this repository's production package build
- `pinia`: the UI backed by `@pinia/nuxt` and Pinia

The report includes emitted client and Node-server JavaScript in raw, gzip, and Brotli
bytes. The client table also shows the incremental cost over the baseline. Server
measurements cover emitted JavaScript and exclude external dependencies in
`.output/server/node_modules`. Compression is calculated per generated asset.
The state fixture asserts that the production client and server exclude the DevTools
bridge and route, and that Nitro request cleanup appears only on the server.

Run it from the repository root:

```sh
pnpm bench:bundle-size
```

Results are written to `benchmarks/bundle-size/results/latest.json` and are not
committed because filenames and compression output can vary with the toolchain.

## SSR and hydration with a large catalog

```sh
pnpm exec playwright-core install chromium
node benchmarks/bundle-size/heavy.mjs
```

Set `STATES_BENCH_CHROMIUM` to use a local Chromium executable. The runner builds two
production Nuxt apps. Both create the same reactive array of 20,000 nested records
on the server, compute a checksum over the full array and render the first 25 rows.
The browser checks the count, checksum and a live row update after hydration.

The runner reports raw and gzip Nuxt JSON payload bytes and median times for 40
loopback SSR requests and 16 fresh browser contexts per app, after warm-up.
Set `STATES_BENCH_BROWSER_RUNS` to change the browser sample count.
The browser probes time Nuxt's inline payload parse and revival, the first catalog
access, and `restoreState` for `@up-nuxt/states`. First access includes factory
initialization and hydration in both implementations. These probes are added only
to the benchmark builds and match the Nuxt version installed by this repository.
The mount measurement spans Nuxt's `app:beforeMount` and `app:mounted` hooks.
The response-end-to-mounted measurement also includes browser startup work before
mounting, such as fetching app assets and decoding the SSR payload.

With `STATES_BENCH_BROWSER_RUNS=20`, two runs per implementation on macOS arm64
(Node 24.22.2, Nuxt 4.6.4, Vue 3.5.45, Chromium 156 headless) gave these ranges
of medians in milliseconds. The baseline was `@up-nuxt/states` v1.1.1. Pinia
4.1.0 was measured alongside the optimized build.

| Stage                        | States v1.1.1 | States optimized |       Pinia |
| ---------------------------- | ------------: | ---------------: | ----------: |
| SSR response                 |   66.40–67.41 |      65.24–66.23 | 64.96–71.46 |
| Inline payload decode        |   11.10–11.20 |            11.10 |       11.60 |
| First catalog access         |   24.10–24.25 |      18.85–18.90 | 23.30–23.35 |
| States restoreState          |   24.00–24.10 |            18.80 |           — |
| Nuxt mount                   |   30.55–30.65 |      26.35–26.40 | 28.70–29.65 |
| HTML response end to mounted |         56.40 |      52.10–52.20 | 51.50–52.45 |

The mount phase includes the first catalog access, and that access includes the
States restore. These are nested measurements. The optimization reduced first
catalog access time by about 22% versus v1.1.1 and 19% versus Pinia. Complete
startup was within 0.7 ms of Pinia in both paired runs.
