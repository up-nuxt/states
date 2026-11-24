interface Batch {
  arrivals: number
  ready: Promise<void>
  release: () => void
}

const batches = new Map<string, Batch>()

// Hold the SSR renders open until the full group reaches this point.
export function waitForIsolationBatch(name: string, size: number): Promise<void> {
  let batch = batches.get(name)
  if (!batch) {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const timer = setTimeout(() => {
      batches.delete(name)
      reject(new Error(`Timed out waiting for ${size} concurrent SSR renders`))
    }, 10_000)
    batch = {
      arrivals: 0,
      ready: promise,
      release: () => {
        clearTimeout(timer)
        batches.delete(name)
        resolve()
      },
    }
    batches.set(name, batch)
  }
  if (++batch.arrivals === size) batch.release()
  return batch.ready
}
