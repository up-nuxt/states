# Nuxt DevTools v4 in `@up-nuxt/states`

The dependency update moved `@nuxt/devtools-kit` and the root workspace dev dependency `@nuxt/devtools` from `^3.4.2` to `^4.2.0`. Before migration the inspector registered with `addCustomTab()` and read the active browser app through `window.__NUXT_DEVTOOLS__.host.nuxt`. The local playground loaded DevTools 4.2.0 from the workspace and emitted the `NDT_DEP_0005` compatibility warning. The v4.2.0 tag includes a fix for explicit DevTools dependencies and adds size warnings and a breakdown to the built-in Payload tab. [Dependency update](../package.json) · [Tab registration](../src/devtools/register.ts) · [Inspector](../src/module.ts) · [DevTools 4.2.0 release](https://github.com/nuxt/devtools/releases/tag/v4.2.0)

## Compatibility

The inspector requires DevTools v4 and Nuxt 4.6+ with Vite 8. DevTools v4 itself can run starting with Nuxt 4.5 and Vite 8.1.5, while the portable inspector route uses the server API introduced in Nuxt 4.6. It appears in the Nuxt group of Vite DevTools. The lockfile has both the explicit DevTools 4.2.0 and the DevTools 3.4.4 bundled with Nuxt 4.6.4. Downstream Nuxt 4 apps can select v4 with the documented package-manager override. On v3, `devtools:ready` never fires and a v4-only inspector will be absent. This is a requirement of the inspector. The core module currently advertises Nuxt `^4.0.0` support. [Lockfile](../pnpm-lock.yaml) · [Module compatibility](../src/module.ts) · [Upgrade guide](https://nuxt.com/modules/devtools/upgrading-to-v4#nuxt-45) · [Module migration](https://nuxt.com/modules/devtools/module-migration#should-i-migrate-now)

## Native dock

1. The module registers the iframe through `onDevtoolsReady()` and `ctx.docks.register()`. It registers the existing route as `type: 'iframe'` under `groupId: NUXT_DEVTOOLS_GROUP_ID`. [Native registration](https://nuxt.com/modules/devtools/module-migration#ndt_dep_0005)
2. The native dock reads `window.parent.__NUXT_DEVTOOLS_HOST__` from the same-origin app. That host can call the existing `nuxt-state:inspect` hook against the current app's registry. This keeps the read-only snapshots and lazy factories in the browser and avoids adding server RPC for per-tab live state. [Native iframe bridge](https://nuxt.com/modules/devtools/module-migration#step-4-the-iframe-client) · [Per-app inspection hook](../src/runtime/app/plugins/devtools.client.ts)
3. The dock badge counts the exports selected by discovery, including project and layer states. The dock handle updates the badge when the count changes. [Dock update API](https://nuxt.com/modules/devtools/module-migration#ndt_dep_0006) · [Discovery metadata](../src/module.ts)

## Options after migration

- Surface actionable discovery diagnostics in DevTools Messages or register a Data Inspector source for build-time metadata such as known origins and layer overrides, if the module starts collecting the overridden candidates. Keep live values in the state inspector where they are scoped to the current app. [Messages](https://nuxt.com/modules/devtools/module-migration#step-6-notifications) · [Data Inspector extension](https://nuxt.com/modules/devtools/module-migration#ndt_dep_0009)

## Nuxt Kit 4.6

`@nuxt/kit` and the development versions of Nuxt and `@nuxt/schema` moved from `^4.5.2` to `^4.6.4`. Nuxt 4.6 gives Kit an explicit public API and reduces its dependency footprint. The installed `nuxt/kit` subpath re-exports `@nuxt/kit`. The existing module entry already uses public Kit helpers for layer directories, imports, plugins, templates, and the dev route. Keep the current import while the module supports earlier Nuxt 4 versions. [Module entry](../src/module.ts) · [Nuxt 4.6 release](https://github.com/nuxt/nuxt/releases/tag/v4.6.0)

- The inspector route uses `nuxt/server` and is registered as the portable `nuxt` variant of `addDevServerHandler`. This requires Nuxt 4.6+. [Server compatibility in Nuxt 4.6](https://github.com/nuxt/nuxt/releases/tag/v4.6.0#-for-module-authors)
- The `addTemplate` option `dependsOn` scopes regeneration of `nuxt-state/metadata.mjs` on file edits to the discovered state directories. Its contents derive from `imports:extend` and can change when a state export is renamed within an existing file. [Template dependencies](https://nuxt.com/docs/4.x/api/kit/templates#skipping-regeneration-in-development)
