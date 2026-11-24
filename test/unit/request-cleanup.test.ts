import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import installCleanup from '../../src/runtime/server/request-cleanup'
import {
  disposeRequestStates,
  registerRequestCleanup,
} from '../../src/runtime/shared/request-cleanup'

describe('SSR request cleanup', () => {
  it('runs cleanup once and disposes late registrations immediately after close', () => {
    const context = {}
    const dispose = vi.fn()
    const lateDispose = vi.fn()

    registerRequestCleanup(context, dispose)
    disposeRequestStates(context)
    registerRequestCleanup(context, lateDispose)

    expect(dispose).toHaveBeenCalledOnce()
    expect(lateDispose).toHaveBeenCalledOnce()
    disposeRequestStates(context)
    expect(dispose).toHaveBeenCalledOnce()
    expect(lateDispose).toHaveBeenCalledOnce()
  })

  it.each(['finish', 'close', 'afterResponse'])('releases registered callbacks after %s', (end) => {
    const response = new EventEmitter()
    const context = {}
    const event = { context, node: end === 'afterResponse' ? undefined : { res: response } }
    const hooks: Record<string, (request: typeof event) => void> = {}
    const captureError = vi.fn()
    installCleanup({
      hooks: {
        hook: (name: string, handler: (request: typeof event) => void) => (hooks[name] = handler),
      },
      captureError,
    } as unknown as Parameters<typeof installCleanup>[0])
    const dispose = vi.fn()
    hooks.request!(event)
    registerRequestCleanup(context, dispose)
    if (end !== 'afterResponse') response.emit(end)
    hooks.afterResponse!(event)

    expect(dispose).toHaveBeenCalledOnce()
    expect(response.listenerCount('finish')).toBe(0)
    expect(response.listenerCount('close')).toBe(0)
    expect(captureError).not.toHaveBeenCalled()
  })

  it('releases all registered scopes even when one cleanup throws', () => {
    const context = {}
    const error = new Error('cleanup failed')
    const clean = vi.fn()
    registerRequestCleanup(context, () => {
      throw error
    })
    registerRequestCleanup(context, clean)

    expect(() => disposeRequestStates(context)).toThrow(AggregateError)
    expect(clean).toHaveBeenCalledOnce()
    expect(() => disposeRequestStates(context)).not.toThrow()
  })
})
