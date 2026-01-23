import { SimulationEvent } from './types'

export class MinHeap {
  private data: SimulationEvent[] = []

  push(item: SimulationEvent) {
    this.data.push(item)
    this.bubbleUp(this.data.length - 1)
  }

  pop() {
    if (this.data.length === 0) return undefined
    const top = this.data[0]
    const last = this.data.pop()
    if (last && this.data.length > 0) {
      this.data[0] = last
      this.bubbleDown(0)
    }
    return top
  }

  get size() {
    return this.data.length
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.data[parent].timeSec <= this.data[index].timeSec) break
      const tmp = this.data[parent]
      this.data[parent] = this.data[index]
      this.data[index] = tmp
      index = parent
    }
  }

  private bubbleDown(index: number) {
    const length = this.data.length
    while (true) {
      let smallest = index
      const left = 2 * index + 1
      const right = 2 * index + 2
      if (left < length && this.data[left].timeSec < this.data[smallest].timeSec) {
        smallest = left
      }
      if (right < length && this.data[right].timeSec < this.data[smallest].timeSec) {
        smallest = right
      }
      if (smallest === index) break
      const tmp = this.data[smallest]
      this.data[smallest] = this.data[index]
      this.data[index] = tmp
      index = smallest
    }
  }
}
