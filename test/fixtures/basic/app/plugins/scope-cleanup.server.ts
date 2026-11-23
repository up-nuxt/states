const source = shallowRef(0)
const results = new Map<string, { disposals: number; changes: number }>()

const useScopeCleanup = defineState(() => {
  const { searchParams } = useRequestURL()
  const marker = searchParams.get('scope-cleanup')!
  const result = { disposals: 0, changes: 0 }
  const snapshot = reactive({ marker })
  results.set(marker, result)

  watch(source, () => result.changes++, { flush: 'sync' })
  onScopeDispose(() => {
    result.disposals++
    snapshot.marker = 'disposed before serialization'
  })

  return { snapshot }
})

export default defineNuxtPlugin(() => {
  const url = useRequestURL()
  if (url.pathname !== '/') return

  const check = url.searchParams.get('scope-check')
  if (check) {
    const result = results.get(check)
    if (result?.disposals) {
      source.value++
      results.delete(check)
    }
    useState(
      'scope-check',
      () => `scope-disposals:${result?.disposals},scope-changes:${result?.changes}`,
    )
  }

  if (url.searchParams.has('scope-cleanup')) {
    useScopeCleanup()
    if (url.searchParams.has('fail'))
      throw createError({ statusCode: 503, statusMessage: 'Scope probe' })
  }
})
