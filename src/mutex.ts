// simple mutex for serializing pglite access
export class Mutex {
  private locked = false
  private queue: Array<() => void> = []

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.locked = false
    }
  }
}

// shared mutex instance for serializing pglite access across proxy and replication handler
export const pgMutex = new Mutex()
