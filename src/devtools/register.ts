import { NUXT_DEVTOOLS_GROUP_ID, onDevtoolsReady } from '@nuxt/devtools-kit'
import type { Nuxt } from '@nuxt/schema'

export function registerDevtools(route: string, nuxt: Nuxt): (count: number) => void {
  let count = 0
  let updateBadge: ((badge: string) => void) | undefined

  onDevtoolsReady((ctx) => {
    const dock = ctx.docks.register({
      id: 'nuxt-state',
      title: 'Nuxt States',
      icon: 'carbon:data-vis-4',
      groupId: NUXT_DEVTOOLS_GROUP_ID,
      category: 'app',
      type: 'iframe',
      url: route,
      badge: String(count),
    })
    updateBadge = (badge) => dock.update({ badge })
  }, nuxt)

  return (nextCount) => {
    if (nextCount === count) return
    count = nextCount
    updateBadge?.(String(count))
  }
}
