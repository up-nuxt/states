import { computed, getCurrentScope, onScopeDispose, reactive, ref, watchEffect } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineState } from '../../src/runtime/app/composables/defineState'
import {
  collectStateSnapshots,
  getStateRegistry,
  receiveStateSnapshots,
} from '../../src/runtime/app/state-registry'
import { setCurrentNuxtApp } from './nuxt-app-mock'

const defineStateInternal = defineState as unknown as <T>(
  factory: () => T,
  internalKey?: string,
) => () => T

describe('defineState', () => {
  beforeEach(() => setCurrentNuxtApp({}))

  it('is lazy and invokes its factory once per Nuxt app', () => {
    const factory = vi.fn(() => ({ value: ref(0) }))
    const useExample = defineState(factory)

    expect(factory).not.toHaveBeenCalled()
    useExample()
    useExample()

    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('returns the exact same object to every caller in one app', () => {
    const useExample = defineState(() => ({ value: ref(0) }))

    expect(useExample()).toBe(useExample())
  })

  it('runs factories in an app-lived detached Vue effect scope', () => {
    const source = ref(0)
    const observed = vi.fn()
    const useExample = defineState(() => {
      const scope = getCurrentScope()
      watchEffect(() => observed(source.value), { flush: 'sync' })
      return { scope }
    })

    const state = useExample()
    source.value++

    expect(state.scope?.detached).toBe(true)
    expect(observed).toHaveBeenLastCalledWith(1)
  })

  it('stops the detached scope when the Vue app unmounts', () => {
    const cleanups: Array<() => void> = []
    const nuxtApp = {
      vueApp: {
        onUnmount(cleanup: () => void) {
          cleanups.push(cleanup)
        },
      },
    }
    const source = ref(0)
    const observed = vi.fn()
    setCurrentNuxtApp(nuxtApp)
    const useExample = defineState(() => {
      watchEffect(() => observed(source.value), { flush: 'sync' })
      return { source }
    })

    useExample()
    expect(cleanups).toHaveLength(1)
    cleanups[0]!()
    source.value++

    expect(observed).toHaveBeenCalledTimes(1)
  })

  it('creates isolated objects for different Nuxt apps', () => {
    const useExample = defineState(() => ({ value: ref(0) }))
    const firstApp = {}
    const secondApp = {}

    setCurrentNuxtApp(firstApp)
    const first = useExample()
    first.value.value = 42

    setCurrentNuxtApp(secondApp)
    const second = useExample()

    expect(second).not.toBe(first)
    expect(second.value.value).toBe(0)

    setCurrentNuxtApp(firstApp)
    expect(useExample()).toBe(first)
    expect(useExample().value.value).toBe(42)
  })

  it('preserves standard ref, reactive, computed, and function behavior', () => {
    const useCounter = defineState(() => {
      const count = ref(1)
      const profile = reactive({ name: 'Guest' })
      const double = computed(() => count.value * 2)
      const increment = (amount = 1) => (count.value += amount)

      return { count, profile, double, increment }
    })

    const first = useCounter()
    const second = useCounter()
    first.count.value++
    second.profile.name = 'Nuxt User'
    second.increment(3)

    expect(first.count.value).toBe(5)
    expect(first.double.value).toBe(10)
    expect(first.profile.name).toBe('Nuxt User')
  })

  it('keeps multiple defineState closures independent', () => {
    const useFirst = defineState(() => ({ value: ref('first') }))
    const useSecond = defineState(() => ({ value: ref('second') }))

    expect(useFirst()).not.toBe(useSecond())
    useFirst().value.value = 'changed'
    expect(useSecond().value.value).toBe('second')
  })

  it('collects final state at render time instead of factory defaults', () => {
    const nuxtApp = {}
    setCurrentNuxtApp(nuxtApp)
    const useCounter = defineStateInternal(() => ({ count: ref(0) }), '$counter')

    useCounter().count.value = 41

    expect(collectStateSnapshots(nuxtApp)).toEqual({
      $counter: {
        count: { type: 'ref', value: 41 },
      },
    })
  })

  it('omits active states without mutable snapshot members', () => {
    const nuxtApp = {}
    setCurrentNuxtApp(nuxtApp)
    const useReadOnly = defineStateInternal(() => ({ label: 'ready' }), '$readOnly')
    const useCounter = defineStateInternal(() => ({ count: ref(undefined) }), '$counter')

    useReadOnly()
    expect(collectStateSnapshots(nuxtApp)).toBeUndefined()

    useCounter()
    expect(collectStateSnapshots(nuxtApp)).toEqual({
      $counter: { count: { type: 'ref', value: undefined } },
    })
    expect(getStateRegistry(nuxtApp).active.has('$readOnly')).toBe(true)
  })

  it('restores a compiler-keyed state before returning it', () => {
    const nuxtApp = {}
    setCurrentNuxtApp(nuxtApp)
    receiveStateSnapshots(nuxtApp, {
      $counter: {
        count: { type: 'ref', value: 41 },
      },
    })
    const useCounter = defineStateInternal(() => {
      const count = ref(0)
      const double = computed(() => count.value * 2)
      const increment = () => count.value++
      return { count, double, increment }
    }, '$counter')

    const state = useCounter()

    expect(state.count.value).toBe(41)
    expect(state.double.value).toBe(82)
    state.increment()
    expect(state.double.value).toBe(84)
  })

  it('rejects async factories at runtime for JavaScript callers', async () => {
    const useAsyncState = defineState((async () => ({ value: 1 })) as never)

    expect(() => useAsyncState()).toThrowError(
      '[@up-nuxt/states] State factories must be synchronous.',
    )
  })

  it('disposes the scope when reading a factory result’s then property throws', () => {
    const dispose = vi.fn()
    const useBroken = defineState(() => {
      onScopeDispose(dispose)
      // oxlint-disable-next-line unicorn/no-thenable -- Exercise the Promise-like validation error path.
      return Object.defineProperty({}, 'then', {
        get() {
          throw new Error('broken then')
        },
      })
    })

    expect(() => useBroken()).toThrow('broken then')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it.each([true, false])(
    'retries a failed restore with a fresh instance (pending: %s)',
    (pending) => {
      const nuxtApp = {}
      setCurrentNuxtApp(nuxtApp)
      const snapshots = {
        $counter: {
          count: { type: 'ref', value: 41 },
          other: { type: 'ref', value: 42 },
        },
      }
      const dispose = vi.fn()
      let attempts = 0
      const useCounter = defineStateInternal(() => {
        const attempt = ++attempts
        onScopeDispose(dispose)
        const other = ref(0)
        return {
          count: ref(0),
          get other() {
            if (attempt === 1) throw new Error('broken restore')
            return other
          },
        }
      }, '$counter')

      if (pending) {
        receiveStateSnapshots(nuxtApp, snapshots)
        expect(() => useCounter()).toThrow('broken restore')
      } else {
        useCounter()
        expect(() => receiveStateSnapshots(nuxtApp, snapshots)).toThrow('broken restore')
      }

      expect(dispose).toHaveBeenCalledOnce()
      expect(getStateRegistry(nuxtApp).active.has('$counter')).toBe(false)
      expect(useCounter().count.value).toBe(41)
      expect(useCounter().other.value).toBe(42)
      expect(attempts).toBe(2)
    },
  )
})
