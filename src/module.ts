import { basename, relative } from 'node:path'
import {
  addDevServerHandler,
  addImports,
  addImportsDir,
  addPlugin,
  addTemplate,
  createResolver,
  defineNuxtModule,
  getLayerDirectories,
  hasNuxtCompatibility,
} from '@nuxt/kit'
import { registerDevtools } from './devtools/register'

export type ModuleOptions = Record<string, never>

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@up-nuxt/states',
    compatibility: {
      nuxt: '^4.0.0',
    },
  },
  defaults: {},
  async setup(_options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const defineStateSource = resolver.resolve('./runtime/app/composables/defineState')

    addImports({
      name: 'defineState',
      from: defineStateSource,
    })

    nuxt.options.optimization.keyedComposables.push({
      name: 'defineState',
      source: defineStateSource,
      argumentLength: 2,
    })

    addPlugin(resolver.resolve('./runtime/app/plugins/hydration'))

    const devtools = nuxt.options.devtools
    const devtoolsEnabled =
      nuxt.options.dev &&
      devtools !== false &&
      !(typeof devtools === 'object' && devtools.enabled === false)

    const layers = getLayerDirectories(nuxt)
    const stateDirectories = layers.map((layer) => resolver.resolve(layer.app, 'states'))

    if (devtoolsEnabled && (await hasNuxtCompatibility({ nuxt: '>=4.6.0' }, nuxt))) {
      const devtoolsRoute = '/__nuxt_state_devtools__/'
      let knownStates: Array<{ name: string; source: string; origin: string }> = []
      const updateDockBadge = registerDevtools(devtoolsRoute, nuxt)

      nuxt.hook('imports:extend', (imports) => {
        const winners = new Map<string, { name: string; source: string; origin: string }>()

        for (const item of imports) {
          const layerIndex = stateDirectories.findIndex(
            (directory) => item.from === directory || item.from.startsWith(`${directory}/`),
          )
          const name = item.as || item.name
          if (layerIndex < 0 || winners.has(name)) continue

          const layer = layers[layerIndex]!
          const projectRelative = relative(nuxt.options.rootDir, item.from)
          const source = projectRelative.startsWith('..') ? basename(item.from) : projectRelative
          const layerRelative = relative(nuxt.options.rootDir, layer.root).replace(/\/$/, '')

          winners.set(name, {
            name,
            source,
            origin: layerIndex === 0 ? 'Project' : layerRelative || basename(layer.root),
          })
        }

        knownStates = [...winners.values()].sort((a, b) => a.name.localeCompare(b.name))
        updateDockBadge(knownStates.length)
      })

      addTemplate({
        filename: 'nuxt-state/metadata.mjs',
        dependsOn: ({ path }) =>
          stateDirectories.some((directory) => path.startsWith(`${directory}/`)),
        getContents: () => `export default ${JSON.stringify(knownStates)}`,
      })

      addPlugin(resolver.resolve('./runtime/app/plugins/devtools.client'))
      const { default: handler } = await import('./runtime/server/devtools')
      addDevServerHandler({ route: devtoolsRoute, handler: { nuxt: handler } })
    }

    // Nuxt uses literal directories to recognize changes and globs to scan nested files.
    // The source path still determines each import's native layer priority.
    addImportsDir(stateDirectories.flatMap((directory) => [directory, `${directory}/**`]))
  },
})
