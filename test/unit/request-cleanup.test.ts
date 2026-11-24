import { describe, expect, it, vi } from 'vitest'
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
})
