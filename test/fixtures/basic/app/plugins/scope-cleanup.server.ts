const source = shallowRef(0)
interface Probe {
  disposals: number
  changes: number
  phase: 'created' | 'waiting' | 'error' | 'resumed'
  release?: () => void
}
const results = new Map<string, Probe>()

const useScopeCleanup = defineState(() => {
  const { searchParams } = useRequestURL()
  const marker = searchParams.get('scope-cleanup')!
  const result: Probe = { disposals: 0, changes: 0, phase: 'created' }
  const snapshot = reactive({ marker })
  results.set(marker, result)

  watch(source, () => result.changes++, { flush: 'sync' })
  onScopeDispose(() => {
    result.disposals++
    snapshot.marker = 'disposed before serialization'
  })

  return { snapshot }
})

async function waitForAbort(result: Probe, phase: 'waiting' | 'error'): Promise<void> {
  result.phase = phase
  await new Promise<void>((resolve) => {
    const deadline = setTimeout(resolve, 5_000)
    result.release = () => {
      clearTimeout(deadline)
      resolve()
    }
  })
  result.phase = 'resumed'
}

export default defineNuxtPlugin(async (nuxtApp) => {
  const url = useRequestURL()
  if (url.pathname !== '/') return

  const check = url.searchParams.get('scope-check')
  if (check) {
    const result = results.get(check)
    if (result?.disposals) {
      source.value++
      if (result.phase === 'created' || url.searchParams.has('remove')) results.delete(check)
    }
    if (url.searchParams.has('release')) result?.release?.()
    useState(
      'scope-check',
      () =>
        `scope-disposals:${result?.disposals},scope-changes:${result?.changes},scope-phase:${result?.phase}`,
    )
  }

  const marker = url.searchParams.get('scope-cleanup')
  if (marker) {
    useScopeCleanup()
    const result = results.get(marker)!
    if (url.searchParams.has('abort')) {
      if (url.searchParams.has('fail')) {
        nuxtApp.hooks.hookOnce('app:error', () => waitForAbort(result, 'error'))
      } else {
        await waitForAbort(result, 'waiting')
      }
    }
    if (url.searchParams.has('fail'))
      throw createError({ statusCode: 503, statusMessage: 'Scope probe' })
  }
})
