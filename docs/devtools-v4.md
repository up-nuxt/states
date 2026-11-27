# Nuxt DevTools v4 in `@up-nuxt/states`

The dependency update moved `@nuxt/devtools-kit` and the root workspace dev dependency `@nuxt/devtools` from `^3.4.2` to `^4.2.0`. Before migration the inspector registered with `addCustomTab()` and read the active browser app through `window.__NUXT_DEVTOOLS__.host.nuxt`. The local playground loaded DevTools 4.2.0 from the workspace and emitted the `NDT_DEP_0005` compatibility warning. The v4.2.0 tag includes a fix for explicit DevTools dependencies and adds size warnings and a breakdown to the built-in Payload tab. [Dependency update](../package.json) · [Tab registration](../src/devtools/register.ts) · [Inspector](../src/module.ts) · [DevTools 4.2.0 release](https://github.com/nuxt/devtools/releases/tag/v4.2.0)

## Compatibility

The inspector requires DevTools v4 and Nuxt 4.6+ with Vite 8. Its dock appears in the Nuxt group of Vite DevTools. Nuxt 4.6 apps can select v4 with a package-manager override. Nuxt 4.7 ships DevTools onboarding, so apps can install `@nuxt/devtools` v4 directly as a development dependency. The core module advertises Nuxt `^4.0.0` support. [Nuxt 4.7 release](https://github.com/nuxt/nuxt/releases/tag/v4.7.0) · [Upgrade guide](https://nuxt.com/modules/devtools/upgrading-to-v4#nuxt-45)

## Native dock

1. The module registers the iframe through `onDevtoolsReady()` and `ctx.docks.register()`. It registers the existing route as `type: 'iframe'` under `groupId: NUXT_DEVTOOLS_GROUP_ID`. [Native registration](https://nuxt.com/modules/devtools/module-migration#ndt_dep_0005)
2. The native dock reads `window.parent.__NUXT_DEVTOOLS_HOST__` from the same-origin app. That host can call the existing `nuxt-state:inspect` hook against the current app's registry. This keeps the read-only snapshots and lazy factories in the browser and avoids adding server RPC for per-tab live state. [Native iframe bridge](https://nuxt.com/modules/devtools/module-migration#step-4-the-iframe-client) · [Per-app inspection hook](../src/runtime/app/plugins/devtools.client.ts)
3. The dock badge counts the exports selected by discovery, including project and layer states. The dock handle updates the badge when the count changes. [Dock update API](https://nuxt.com/modules/devtools/module-migration#ndt_dep_0006) · [Discovery metadata](../src/module.ts)

## Options after migration

- Surface actionable discovery diagnostics in DevTools Messages or register a Data Inspector source for build-time metadata such as known origins and layer overrides, if the module starts collecting the overridden candidates. Keep live values in the state inspector where they are scoped to the current app. [Messages](https://nuxt.com/modules/devtools/module-migration#step-6-notifications) · [Data Inspector extension](https://nuxt.com/modules/devtools/module-migration#ndt_dep_0009)

## Nuxt Kit 4.6

Nuxt 4.6 introduced the portable handler registration and made Kit's public API explicit. The module uses public Kit helpers for layer directories, imports, plugins, templates, and the dev route. It keeps a direct dependency on `@nuxt/kit` so the module can resolve these helpers with earlier Nuxt 4 hosts. [Module entry](../src/module.ts) · [Nuxt 4.6 release](https://github.com/nuxt/nuxt/releases/tag/v4.6.0)

- The inspector returns a Web `Response` through the portable `nuxt` variant of `addDevServerHandler`. That route runs in the Nuxt module process, so its handler uses Web APIs directly. [Dev server handler compatibility](https://nuxt.com/docs/4.x/guide/modules/server-compatibility#dev-server-handlers)
- The `addTemplate` option `dependsOn` scopes regeneration of `nuxt-state/metadata.mjs` on file edits to the discovered state directories. Its contents derive from `imports:extend` and can change when a state export is renamed within an existing file. [Template dependencies](https://nuxt.com/docs/4.x/api/kit/templates#skipping-regeneration-in-development)

## Nuxt 4.7 validation

The development and playground dependencies resolve Nuxt 4.7.0 with Nitro 2.14.0. Use Node
24.15+ within the Node 24 line, or Node 26, when running this checkout with Nuxt 4.7.
The Node response cleanup plugin uses the Nitro 2 request and response hooks. The preview
Nitro 3 runtime in Nuxt 4.7 is outside this validation.
