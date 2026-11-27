# Changelog

## 1.1.2

- Validate hydration, DevTools, and SSR request cleanup on Nuxt 4.7 and Nitro 2.14.
- Serve the DevTools inspector with a standard Web `Response` and document how to install
  DevTools v4 on Nuxt 4.7.
- Speed up hydration of reactive arrays by reusing payload members when they do not point back
  to the array root. Add a repeatable benchmark against Pinia with 20,000 nested records.

## 1.1.1

- Dispose SSR state scopes when Node responses finish or close, including errors and aborted
  requests. Allow a fresh initialization after a failed hydration restore.
- Preserve shared references, cycles, independent reactive roots, and sparse array slots during
  hydration. Restore readonly and frozen nested branches through their mutable parents.
- Avoid redundant reactive collection writes, omit empty snapshots, and look up pending snapshots
  by state key as they are needed.
- Filter and paginate DevTools states before generating previews. Bound getter reads, pause
  polling while the panel is hidden, and label states without a transferable snapshot accurately.
- Add a deterministic 200-request SSR isolation test and reproducible runtime, memory, and
  production bundle benchmarks.

## 1.1.0

- Move the read-only Nuxt States inspector to the native DevTools v4 dock and show the number of
  discovered state exports on its badge. The inspector requires Nuxt 4.6+ with Vite 8 and DevTools
  v4.
- Refresh inspector metadata when state exports and layer overrides change during development.
- Serve the inspector through the portable `nuxt/server` API.

## 1.0.0

- Publish as `@up-nuxt/states` under the up-nuxt organization.
- Move the source repository to `https://github.com/up-nuxt/states`.

- Stabilize `defineState(factory)` as the complete public API for the 1.x release line.
- Declare the tested Nuxt 4 behavior from 0.1–0.3 production-ready: per-app lazy state,
  SSR hydration, Nuxt composables, Layers, and development-only read-only DevTools.
- Keep payload keys, snapshots, registries, and compiler-injected hydration identity internal
  so their implementation can evolve without breaking the public API.
- Preserve the documented constraints around closure-private state, writable computed refs,
  custom refs, HMR preservation, and non-serializable payload values.
- Add a reproducible production client bundle-size benchmark against `@pinia/nuxt`.

## 0.3.0

- Discover `app/states/` across resolved Nuxt Layers with the official
  `getLayerDirectories()` API, including local auto-layers, explicit `extends`, package layers,
  nested states, SSR hydration, request isolation, and native priority collisions.
- Add a development-only, read-only Nuxt DevTools iframe for active instances, hydration status,
  internal keys, conservative Vue member kinds, and bounded cycle-safe value previews.
- Show statically known state export names, project-relative sources, and layer origins separately
  from lazy active instances; opening DevTools never executes factories.
- Keep DevTools registration, view serving, polling, bridge, and inspector code out of production;
  use stable Nuxt DevTools 3.4 without nightly or alpha overrides.
- Characterize writable computed hydration in Chromium: it enters the snapshot as a mutable ref,
  source refs restore first in the tested return order, and its setter runs exactly once with
  already-restored values. It remains unsupported because Vue has no public computed detector and
  setters may have side effects.

The public API remains exactly `defineState(factory)`. HMR still resets state, DevTools cannot
mutate state, and no public IDs, options, persistence, reset, patch, or subscription APIs were
added.

## 0.2.0

- Run each state factory in a detached, app-lived Vue effect scope so watchers, route state, and
  Nuxt data composables are not tied to the first consuming component.
- Officially support SSR hydration of `shallowRef()` and `shallowReactive()` while preserving
  their shallow behavior.
- Make reactive graph restoration cycle-safe and preserve shared references, arrays, deleted
  properties, `Date`, `Map`, and `Set` values through Nuxt's payload serializer.
- Clear consumed snapshots immediately, clear unmatched initial snapshots after `app:mounted`,
  stop effect scopes at Vue app unmount, and dispose replaced HMR entries.
- Add compatibility coverage for `useAsyncData`, `callOnce`, `useCookie`, `useRuntimeConfig`,
  `useRoute`, `useRouter`, plugins, middleware, layouts, navigation, repeated mount/unmount, and
  client-lazy state.
- Add deterministic 50-request CI isolation coverage and an optional 200-request release stress
  test.
- Make `test:types` self-contained on clean CI checkouts by preparing Nuxt-generated types first.

Writable computed refs remain unsupported hydration state: Vue's public introspection identifies
them as writable refs, so restoration invokes their setter. Return their mutable source refs and
treat the computed as derived runtime state instead. Closure-private state and unusual non-object
factory return shapes remain outside the hydration contract.

## 0.1.0

- Add transparent SSR hydration for mutable top-level `ref()` and `reactive()` members.
- Use Nuxt's native keyed-composable transform while keeping the public API exactly
  `defineState(factory)`.
- Restore snapshots before Vue hydration so computed values and functions remain connected to
  the client-created refs and reactive proxies.
- Preserve per-Nuxt-app/request isolation, lazy factories, exact return identity, and HMR reset
  behavior.
- Add real Chromium coverage for production and development hydration, mismatch detection,
  reactive updates, concurrent SSR requests, and `useFetch()` coexistence.

The internal payload and snapshot formats are not public API and may change before 1.0.
Mutable state must be returned from the factory to participate in SSR hydration. Nuxt data
composable values can appear in the internal snapshot metadata, but Nuxt's graph serializer
shares the underlying response object rather than serializing its body twice.
