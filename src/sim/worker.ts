import { runSimulationRuns } from './engine'
import { SimulationRunResult, SimulationSpec } from './types'

type WorkerInput = {
  spec: SimulationSpec
  startIndex: number
  runs: number
  workerId: number
}

type WorkerMessage =
  | { type: 'progress'; workerId: number; completed: number; total: number }
  | { type: 'result'; workerId: number; data: SimulationRunResult[] }

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  const { spec, startIndex, runs, workerId } = event.data
  const result = runSimulationRuns(spec, startIndex, runs, (completed) => {
    const message: WorkerMessage = { type: 'progress', workerId, completed, total: runs }
    self.postMessage(message)
  })
  const done: WorkerMessage = { type: 'result', workerId, data: result }
  self.postMessage(done)
}
