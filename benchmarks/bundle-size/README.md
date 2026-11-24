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
