import { defineNuxtPlugin } from '#app'
import knownStates from '#build/nuxt-state/metadata'
import { inspectActiveStates, type StateInspectorPage } from '../state-inspector'

interface InspectorRequest {
  query?: string
  page?: number
  result?: StateInspectorPage & {
    known: Array<{ name: string; source: string; origin: string }>
  }
}

export default defineNuxtPlugin({
  name: 'nuxt-state:devtools',
  setup(nuxtApp) {
    nuxtApp.hook(
      'nuxt-state:inspect' as never,
      ((request: InspectorRequest) => {
        request.result = {
          ...inspectActiveStates(nuxtApp, request.query, request.page),
          known: knownStates,
        }
      }) as never,
    )
  },
})
