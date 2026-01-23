import React, { useEffect, useMemo, useRef, useState } from 'react'
import { defaultSpec } from './sim/defaults'
import { SimulationResults, SimulationRunResult, SimulationSpec } from './sim/types'
import { DistributionControl } from './components/DistributionControl'
import { ResultsPanel } from './components/ResultsPanel'
import { SelectInput, SliderInput, Toggle } from './components/ControlRow'
import './index.css'

const modeOptions = [
  { value: 'wait_on_chain', label: 'A) Wait for on-chain confirmation' },
  { value: 'offchain_hold', label: 'B) Off-chain hold then settle' }
]

const latencyOptions = [
  { value: 'combined', label: 'Combined RTT' },
  { value: 'per_leg', label: 'Per leg' }
]

function useSimulationPool() {
  const workersRef = useRef<Worker[]>([])

  const run = async (
    spec: SimulationSpec,
    onProgress: (value: number) => void
  ): Promise<SimulationRunResult[]> => {
    const totalRuns = Math.max(1, Math.floor(spec.monteCarloRuns))
    const workerCount = Math.min(navigator.hardwareConcurrency ?? 4, totalRuns)
    workersRef.current.forEach((worker) => worker.terminate())
    workersRef.current = Array.from({ length: workerCount }, () => new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' }))

    const runsPerWorker = Math.floor(totalRuns / workerCount)
    const remainder = totalRuns % workerCount
    let startIndex = 0
    const progressByWorker = new Array(workerCount).fill(0)
    const results: SimulationRunResult[] = []

    const promises = workersRef.current.map((worker, idx) => {
      const runs = runsPerWorker + (idx < remainder ? 1 : 0)
      const workerId = idx
      const message = { spec, startIndex, runs, workerId }
      startIndex += runs
      return new Promise<void>((resolve) => {
        worker.onmessage = (
          event: MessageEvent<
            | { type: 'progress'; workerId: number; completed: number; total: number }
            | { type: 'result'; workerId: number; data: SimulationRunResult[] }
          >
        ) => {
          if (event.data.type === 'progress') {
            progressByWorker[event.data.workerId] = event.data.completed
            const completed = progressByWorker.reduce((sum, v) => sum + v, 0)
            onProgress(completed / totalRuns)
          }
          if (event.data.type === 'result') {
            results.push(...event.data.data)
            resolve()
          }
        }
        worker.postMessage(message)
      })
    })

    await Promise.all(promises)
    workersRef.current.forEach((worker) => worker.terminate())
    workersRef.current = []
    return results
  }

  return { run }
}

type StoredRun = {
  id: string
  timestamp: number
  spec: SimulationSpec
  results: SimulationResults
}

const STORAGE_KEY = 'risk-sim-history'
const HISTORY_LIMIT = 20

export default function App() {
  const [spec, setSpec] = useState<SimulationSpec>(defaultSpec)
  const [results, setResults] = useState<SimulationResults | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [history, setHistory] = useState<StoredRun[]>([])
  const [page, setPage] = useState(0)
  const { run } = useSimulationPool()

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as StoredRun[]
      setHistory(parsed)
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
    } catch {
      // Ignore storage quota or serialization issues; keep in-memory history.
    }
  }, [history])

  const handleRun = () => {
    setIsRunning(true)
    setProgress(0)
    const runAll = async () => {
      const hasAlt = spec.fraud.enabled && spec.spendLimits.enabled
      const totalRuns = spec.monteCarloRuns * (hasAlt ? 2 : 1)
      let completedRuns = 0

      const baseRuns = await run(spec, (value) => {
        const progress = (completedRuns + value * spec.monteCarloRuns) / totalRuns
        setProgress(progress)
      })
      completedRuns += spec.monteCarloRuns

      const { aggregateRunResults } = await import('./sim/engine')
      let result = aggregateRunResults(spec, baseRuns)

      if (hasAlt) {
        const altSpec = { ...spec, spendLimits: { ...spec.spendLimits, enabled: false } }
        const altRuns = await run(altSpec, (value) => {
          const progress = (completedRuns + value * spec.monteCarloRuns) / totalRuns
          setProgress(progress)
        })
        completedRuns += spec.monteCarloRuns
        const altResult = aggregateRunResults(altSpec, altRuns)
        result.metrics.fraudApprovalRateNoLimits = altResult.metrics.fraudApprovalRate
        result.metrics.fraudExposureTotalNoLimits = altResult.metrics.fraudExposureTotal
        result.metrics.fraudLossTotalNoLimits = altResult.metrics.fraudLossTotal
      } else {
        result.metrics.fraudApprovalRateNoLimits = result.metrics.fraudApprovalRate
        result.metrics.fraudExposureTotalNoLimits = result.metrics.fraudExposureTotal
        result.metrics.fraudLossTotalNoLimits = result.metrics.fraudLossTotal
      }

      const entry: StoredRun = {
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        timestamp: Date.now(),
        spec,
        results: result
      }
        setHistory((prev) => [entry, ...prev].slice(0, HISTORY_LIMIT))
        setPage(0)
        setResults(result)
        setIsRunning(false)
        setProgress(0)
    }

    runAll().catch(() => {
      setIsRunning(false)
      setProgress(0)
    })
  }

  const handleExport = () => {
    const payload = JSON.stringify(spec, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `risk-sim-settings-${Date.now()}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as SimulationSpec
        setSpec(parsed)
      } catch {
        // Ignore invalid JSON
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  const summary = useMemo(() => {
    return `Seed: ${spec.seed} | Runs: ${spec.monteCarloRuns} | Horizon: ${spec.horizonHours}h`
  }, [spec])

  const pageSize = 5
  const totalPages = Math.max(1, Math.ceil(history.length / pageSize))
  const pageItems = history.slice(page * pageSize, page * pageSize + pageSize)
  
  useEffect(() => {
    if (history.length === 0) {
      setPage(0)
      return
    }
    const maxPage = Math.max(0, totalPages - 1)
    setPage((p) => (p > maxPage ? maxPage : p))
  }, [history.length, totalPages])

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="kicker">Stellar Self-Custody Debit Card</p>
          <h1>Card Auth → On-Chain Settlement Risk Lab</h1>
        </div>
        <div className="run-controls">
          <p>{summary}</p>
          <div className="run-actions">
            <button className="ghost-button" onClick={handleExport} type="button">
              Export JSON
            </button>
            <label className="ghost-button">
              Import JSON
              <input type="file" accept="application/json" onChange={handleImport} hidden />
            </label>
          </div>
          {isRunning && (
            <div className="run-status">
              <div className="progress-bar">
                <div
                  className={`progress-bar-fill ${progress > 0 ? 'determinate' : 'indeterminate'}`}
                  style={progress > 0 ? { width: `${Math.min(100, progress * 100)}%` } : undefined}
                />
              </div>
              <span>{progress > 0 ? `Running… ${Math.round(progress * 100)}%` : 'Running simulation…'}</span>
            </div>
          )}
          <button className="run-button" onClick={handleRun} disabled={isRunning}>
            {isRunning ? 'Running…' : 'Run simulation'}
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="panel">
          <section>
            <h2>Mode & Simulation</h2>
            <SelectInput
              label="Authorization Mode"
              value={spec.mode}
              options={modeOptions}
              tooltip="Issuer response strategy for authorization"
              onChange={(value) => setSpec({ ...spec, mode: value as SimulationSpec['mode'] })}
            />
            <SliderInput
              label="Auth timeout"
              value={spec.authTimeoutSec}
              min={2}
              max={15}
              step={1}
              unit="s"
              tooltip="Assumption: issuer response deadline by region (rulebooks are proprietary)"
              onChange={(value) => setSpec({ ...spec, authTimeoutSec: value })}
            />
            <SliderInput
              label="Horizon"
              value={spec.horizonHours}
              min={1}
              max={72}
              step={1}
              unit="h"
              tooltip="Length of simulated time window"
              onChange={(value) => setSpec({ ...spec, horizonHours: value })}
            />
            <SliderInput
              label="Monte Carlo runs"
              value={spec.monteCarloRuns}
              min={1}
              max={10}
              step={1}
              tooltip="Number of independent runs averaged"
              onChange={(value) => setSpec({ ...spec, monteCarloRuns: value })}
            />
            <div className="control">
              <div className="control-header">
                <label title="Seed for deterministic PRNG">PRNG seed</label>
              </div>
              <input
                type="text"
                value={spec.seed}
                onChange={(e) => setSpec({ ...spec, seed: e.target.value })}
              />
            </div>
          </section>

          <section>
            <h2>Network + Issuer</h2>
            <SelectInput
              label="Latency model"
              value={spec.networkLatency.mode}
              options={latencyOptions}
              tooltip="Choose combined RTT or per-leg distributions"
              onChange={(value) =>
                setSpec({
                  ...spec,
                  networkLatency: { ...spec.networkLatency, mode: value as SimulationSpec['networkLatency']['mode'] }
                })
              }
            />
            {spec.networkLatency.mode === 'combined' ? (
            <DistributionControl
              label="Combined RTT (ms)"
              value={spec.networkLatency.combined}
              tooltip="Assumption: end-to-end card network RTT distribution"
              onChange={(value) =>
                setSpec({
                  ...spec,
                  networkLatency: { ...spec.networkLatency, combined: value }
                })
              }
            />
            ) : (
              <>
                <DistributionControl
                  label="Terminal → Network (ms)"
                  value={spec.networkLatency.terminalToNetwork}
                  tooltip="Latency distribution for terminal to network leg"
                  onChange={(value) =>
                    setSpec({
                      ...spec,
                      networkLatency: { ...spec.networkLatency, terminalToNetwork: value }
                    })
                  }
                />
                <DistributionControl
                  label="Network → Issuer (ms)"
                  value={spec.networkLatency.networkToIssuer}
                  tooltip="Latency distribution for network to issuer leg"
                  onChange={(value) =>
                    setSpec({
                      ...spec,
                      networkLatency: { ...spec.networkLatency, networkToIssuer: value }
                    })
                  }
                />
                <DistributionControl
                  label="Issuer → Network (ms)"
                  value={spec.networkLatency.issuerToNetwork}
                  tooltip="Latency distribution for issuer to network leg"
                  onChange={(value) =>
                    setSpec({
                      ...spec,
                      networkLatency: { ...spec.networkLatency, issuerToNetwork: value }
                    })
                  }
                />
                <DistributionControl
                  label="Network → Terminal (ms)"
                  value={spec.networkLatency.networkToTerminal}
                  tooltip="Latency distribution for network to terminal leg"
                  onChange={(value) =>
                    setSpec({
                      ...spec,
                      networkLatency: { ...spec.networkLatency, networkToTerminal: value }
                    })
                  }
                />
              </>
            )}
            <DistributionControl
              label="Issuer processing (ms)"
              value={spec.issuerProcessing}
              tooltip="Assumption: issuer internal processing latency distribution"
              onChange={(value) => setSpec({ ...spec, issuerProcessing: value })}
            />
          </section>

          <section>
            <h2>Stellar Settlement</h2>
            <SliderInput
              label="Ledger close mean"
              value={spec.stellar.ledgerCloseMean}
              min={0.2}
              max={10}
              step={0.2}
              unit="s"
              tooltip="Based on recent Stellar averages (~5.8–6.0s)"
              onChange={(value) => setSpec({ ...spec, stellar: { ...spec.stellar, ledgerCloseMean: value } })}
            />
            <SliderInput
              label="Ledger jitter"
              value={spec.stellar.ledgerJitter}
              min={0}
              max={3}
              step={0.1}
              unit="s"
              tooltip="Random variation around ledger close mean"
              onChange={(value) => setSpec({ ...spec, stellar: { ...spec.stellar, ledgerJitter: value } })}
            />
            <DistributionControl
              label="Submission delay (ms)"
              value={spec.stellar.submissionDelay}
              tooltip="Assumption: RPC/Horizon submission latency distribution"
              onChange={(value) => setSpec({ ...spec, stellar: { ...spec.stellar, submissionDelay: value } })}
            />
            <SliderInput
              label="Inclusion probability"
              value={spec.stellar.inclusionProbability}
              min={0.1}
              max={0.99}
              step={0.01}
              tooltip="Assumption: per-ledger inclusion (congestion and fee dependent)"
              onChange={(value) =>
                setSpec({ ...spec, stellar: { ...spec.stellar, inclusionProbability: value } })
              }
            />
            <SliderInput
              label="Base fee (stroops)"
              value={spec.stellar.baseFee}
              min={100}
              max={2000}
              step={50}
              tooltip="Base fee used for context/fee bumping"
              onChange={(value) => setSpec({ ...spec, stellar: { ...spec.stellar, baseFee: value } })}
            />
            <SliderInput
              label="Fee bump factor"
              value={spec.stellar.feeBumpFactor}
              min={1}
              max={3}
              step={0.1}
              tooltip="Multiplier used when retrying with higher fees"
              onChange={(value) => setSpec({ ...spec, stellar: { ...spec.stellar, feeBumpFactor: value } })}
            />
            <SliderInput
              label="Max retries"
              value={spec.stellar.maxRetries}
              min={0}
              max={6}
              step={1}
              tooltip="Maximum number of resubmissions"
              onChange={(value) => setSpec({ ...spec, stellar: { ...spec.stellar, maxRetries: value } })}
            />
            <SliderInput
              label="Backoff base"
              value={spec.stellar.backoffBaseMs}
              min={200}
              max={3000}
              step={100}
              unit="ms"
              tooltip="Base backoff between retries"
              onChange={(value) => setSpec({ ...spec, stellar: { ...spec.stellar, backoffBaseMs: value } })}
            />
            <SliderInput
              label="Backoff multiplier"
              value={spec.stellar.backoffMultiplier}
              min={1}
              max={3}
              step={0.1}
              tooltip="Exponential multiplier for retry backoff"
              onChange={(value) =>
                setSpec({ ...spec, stellar: { ...spec.stellar, backoffMultiplier: value } })
              }
            />
            <SliderInput
              label="Max settle window"
              value={spec.stellar.maxSettleWindowSec}
              min={10}
              max={300}
              step={5}
              unit="s"
              tooltip="Give up on settlement after this time"
              onChange={(value) =>
                setSpec({ ...spec, stellar: { ...spec.stellar, maxSettleWindowSec: value } })
              }
            />
            <SliderInput
              label="Settlement SLA"
              value={spec.settlementSlaSec}
              min={5}
              max={120}
              step={5}
              unit="s"
              tooltip="Window after approval before exposure is flagged"
              onChange={(value) => setSpec({ ...spec, settlementSlaSec: value })}
            />
            <Toggle
              label="Partial outage"
              checked={spec.outage.enabled}
              tooltip="Simulate a period of slower submissions and lower inclusion"
              onChange={(value) => setSpec({ ...spec, outage: { ...spec.outage, enabled: value } })}
            />
            {spec.outage.enabled && (
              <div className="inline-grid">
                <SliderInput
                  label="Outage start"
                  value={spec.outage.startHour}
                  min={0}
                  max={23}
                  step={1}
                  unit="h"
                  tooltip="Hour in simulation to begin outage"
                  onChange={(value) => setSpec({ ...spec, outage: { ...spec.outage, startHour: value } })}
                />
                <SliderInput
                  label="Outage duration"
                  value={spec.outage.durationHours}
                  min={1}
                  max={12}
                  step={1}
                  unit="h"
                  tooltip="Length of outage window"
                  onChange={(value) => setSpec({ ...spec, outage: { ...spec.outage, durationHours: value } })}
                />
                <SliderInput
                  label="Delay multiplier"
                  value={spec.outage.submissionDelayMultiplier}
                  min={1}
                  max={5}
                  step={0.1}
                  tooltip="Multiplier applied to submission delay"
                  onChange={(value) =>
                    setSpec({ ...spec, outage: { ...spec.outage, submissionDelayMultiplier: value } })
                  }
                />
                <SliderInput
                  label="Inclusion multiplier"
                  value={spec.outage.inclusionProbabilityMultiplier}
                  min={0.1}
                  max={1}
                  step={0.05}
                  tooltip="Multiplier applied to inclusion probability"
                  onChange={(value) =>
                    setSpec({ ...spec, outage: { ...spec.outage, inclusionProbabilityMultiplier: value } })
                  }
                />
              </div>
            )}
          </section>

          <section>
            <h2>User Model</h2>
            <SliderInput
              label="Users"
              value={spec.userModel.users}
              min={100}
              max={5000}
              step={100}
              tooltip="Number of simulated cardholders"
              onChange={(value) => setSpec({ ...spec, userModel: { ...spec.userModel, users: value } })}
            />
            <DistributionControl
              label="Balance distribution"
              value={spec.userModel.balanceDistribution}
              tooltip="Initial user balance distribution"
              onChange={(value) =>
                setSpec({ ...spec, userModel: { ...spec.userModel, balanceDistribution: value } })
              }
            />
            <SliderInput
              label="Purchase rate"
              value={spec.userModel.purchaseRate}
              min={0.2}
              max={6}
              step={0.1}
              unit="/hr"
              tooltip="Poisson rate per user"
              onChange={(value) => setSpec({ ...spec, userModel: { ...spec.userModel, purchaseRate: value } })}
            />
            <DistributionControl
              label="Ticket size"
              value={spec.userModel.ticketDistribution}
              tooltip="Distribution of transaction amounts"
              onChange={(value) =>
                setSpec({ ...spec, userModel: { ...spec.userModel, ticketDistribution: value } })
              }
            />
            <Toggle
              label="Burstiness"
              checked={spec.userModel.burstinessEnabled}
              tooltip="Enable occasional spikes in purchase rate"
              onChange={(value) =>
                setSpec({ ...spec, userModel: { ...spec.userModel, burstinessEnabled: value } })
              }
            />
            {spec.userModel.burstinessEnabled && (
              <div className="inline-grid">
                <SliderInput
                  label="Burst probability"
                  value={spec.userModel.burstinessProbability}
                  min={0.05}
                  max={0.5}
                  step={0.01}
                  tooltip="Chance a purchase occurs during a bursty period"
                  onChange={(value) =>
                    setSpec({
                      ...spec,
                      userModel: { ...spec.userModel, burstinessProbability: value }
                    })
                  }
                />
                <SliderInput
                  label="Burst multiplier"
                  value={spec.userModel.burstinessMultiplier}
                  min={1}
                  max={6}
                  step={0.2}
                  tooltip="Multiplier applied to purchase rate during bursts"
                  onChange={(value) =>
                    setSpec({
                      ...spec,
                      userModel: { ...spec.userModel, burstinessMultiplier: value }
                    })
                  }
                />
              </div>
            )}
          </section>

          <section>
            <h2>Holds + Pre-auth</h2>
            <Toggle
              label="Holds enabled"
              checked={spec.holds.enabled}
              tooltip="Reserve funds immediately after approval (mode B)"
              onChange={(value) => setSpec({ ...spec, holds: { ...spec.holds, enabled: value } })}
            />
            <SliderInput
              label="Hold duration"
              value={spec.holds.holdDurationSec}
              min={30}
              max={600}
              step={10}
              unit="s"
              tooltip="How long a hold stays if settlement is delayed"
              onChange={(value) => setSpec({ ...spec, holds: { ...spec.holds, holdDurationSec: value } })}
            />
            <Toggle
              label="Allow incremental holds"
              checked={spec.holds.allowIncremental}
              tooltip="Allow additional holds when pre-auth completion increases amount"
              onChange={(value) =>
                setSpec({ ...spec, holds: { ...spec.holds, allowIncremental: value } })
              }
            />
            <Toggle
              label="Pre-auth mode"
              checked={spec.preAuth.enabled}
              tooltip="Model an initial auth and later completion with different amount"
              onChange={(value) => setSpec({ ...spec, preAuth: { ...spec.preAuth, enabled: value } })}
            />
            {spec.preAuth.enabled && (
              <>
                <DistributionControl
                  label="Completion delay (ms)"
                  value={spec.preAuth.completionDelay}
                  tooltip="Delay between pre-auth and completion"
                  onChange={(value) => setSpec({ ...spec, preAuth: { ...spec.preAuth, completionDelay: value } })}
                />
                <SliderInput
                  label="Completion multiplier mean"
                  value={spec.preAuth.completionMultiplierMean}
                  min={0.9}
                  max={1.5}
                  step={0.01}
                  tooltip="Average multiplier for final amount vs. pre-auth"
                  onChange={(value) =>
                    setSpec({ ...spec, preAuth: { ...spec.preAuth, completionMultiplierMean: value } })
                  }
                />
                <SliderInput
                  label="Completion multiplier p95"
                  value={spec.preAuth.completionMultiplierP95}
                  min={1}
                  max={2}
                  step={0.05}
                  tooltip="P95 multiplier for final amount vs. pre-auth"
                  onChange={(value) =>
                    setSpec({ ...spec, preAuth: { ...spec.preAuth, completionMultiplierP95: value } })
                  }
                />
              </>
            )}
          </section>

          <section>
            <h2>Fraud Model</h2>
            <Toggle
              label="Enable fraud simulation"
              checked={spec.fraud.enabled}
              tooltip="Introduce fraudulent attempts with separate behavior"
              onChange={(value) => setSpec({ ...spec, fraud: { ...spec.fraud, enabled: value } })}
            />
            {spec.fraud.enabled && (
              <>
                <SliderInput
                  label="Fraud attempt rate"
                  value={spec.fraud.fraudAttemptRate}
                  min={0}
                  max={0.05}
                  step={0.001}
                  tooltip="Probability a purchase attempt is fraudulent"
                  onChange={(value) => setSpec({ ...spec, fraud: { ...spec.fraud, fraudAttemptRate: value } })}
                />
                <SliderInput
                  label="Auto-decline rate"
                  value={spec.fraud.autoDeclineRate}
                  min={0}
                  max={1}
                  step={0.05}
                  tooltip="Share of fraud attempts blocked by pre-checks"
                  onChange={(value) => setSpec({ ...spec, fraud: { ...spec.fraud, autoDeclineRate: value } })}
                />
                <SliderInput
                  label="Fraud amount multiplier mean"
                  value={spec.fraud.fraudAmountMultiplierMean}
                  min={1}
                  max={3}
                  step={0.05}
                  tooltip="Average fraud amount relative to normal ticket size"
                  onChange={(value) =>
                    setSpec({ ...spec, fraud: { ...spec.fraud, fraudAmountMultiplierMean: value } })
                  }
                />
                <SliderInput
                  label="Fraud amount multiplier p95"
                  value={spec.fraud.fraudAmountMultiplierP95}
                  min={1}
                  max={5}
                  step={0.1}
                  tooltip="P95 fraud amount relative to normal ticket size"
                  onChange={(value) =>
                    setSpec({ ...spec, fraud: { ...spec.fraud, fraudAmountMultiplierP95: value } })
                  }
                />
              </>
            )}
          </section>

          <section>
            <h2>Spend Limits</h2>
            <Toggle
              label="Enable spend limits"
              checked={spec.spendLimits.enabled}
              tooltip="Apply per-transaction, per-user daily, and global daily caps"
              onChange={(value) => setSpec({ ...spec, spendLimits: { ...spec.spendLimits, enabled: value } })}
            />
            {spec.spendLimits.enabled && (
              <>
                <SliderInput
                  label="Per-transaction limit"
                  value={spec.spendLimits.perTransactionLimit}
                  min={0}
                  max={5000}
                  step={25}
                  tooltip="Decline if a single transaction exceeds this amount"
                  onChange={(value) =>
                    setSpec({ ...spec, spendLimits: { ...spec.spendLimits, perTransactionLimit: value } })
                  }
                />
                <SliderInput
                  label="Per-user daily limit"
                  value={spec.spendLimits.perUserDailyLimit}
                  min={0}
                  max={20000}
                  step={100}
                  tooltip="Decline if a user's total daily spend exceeds this amount"
                  onChange={(value) =>
                    setSpec({ ...spec, spendLimits: { ...spec.spendLimits, perUserDailyLimit: value } })
                  }
                />
                <SliderInput
                  label="Timeslot limit (per user)"
                  value={spec.spendLimits.perUserTimeslotLimit}
                  min={0}
                  max={5000}
                  step={50}
                  tooltip="Decline if a user exceeds this spend within a time window"
                  onChange={(value) =>
                    setSpec({ ...spec, spendLimits: { ...spec.spendLimits, perUserTimeslotLimit: value } })
                  }
                />
                <SliderInput
                  label="Timeslot window"
                  value={spec.spendLimits.timeslotMinutes}
                  min={5}
                  max={240}
                  step={5}
                  unit="min"
                  tooltip="Window length used for per-user timeslot limits"
                  onChange={(value) =>
                    setSpec({ ...spec, spendLimits: { ...spec.spendLimits, timeslotMinutes: value } })
                  }
                />
              </>
            )}
          </section>
        </aside>

        <section className="content">
          {history.length > 0 && (
            <section className="history">
              <div className="history-header">
                <h2>Run History</h2>
                <div className="history-actions">
                  <button
                    className="ghost-button"
                    onClick={() => setHistory([])}
                    type="button"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="history-list">
                {pageItems.length === 0 ? (
                  <p className="muted">No runs on this page.</p>
                ) : (
                  pageItems.map((item) => (
                    <div key={item.id} className="history-item">
                      <div>
                        <strong>{new Date(item.timestamp).toLocaleString()}</strong>
                      <p className="muted">
                        {item.spec.mode === 'wait_on_chain' ? 'Wait on-chain' : 'Off-chain hold'} · Seed {item.spec.seed} ·
                        Approval {Math.round(item.results.metrics.approvalRate * 100)}% ·
                        Auth {item.spec.authTimeoutSec}s ·
                        Ledger {item.spec.stellar.ledgerCloseMean}s ·
                        Fraud loss ${item.results.metrics.fraudLossTotal.toFixed(0)} ·
                        Spent ${item.results.metrics.totalSpent.toFixed(0)}
                      </p>
                      </div>
                      <div className="history-buttons">
                      <button
                        className="ghost-button"
                        onClick={() => {
                          setResults(item.results)
                          setSpec(item.spec)
                        }}
                        type="button"
                      >
                        View
                      </button>
                        <button
                          className="ghost-button"
                          onClick={() => setSpec(item.spec)}
                          type="button"
                        >
                          Use params
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="history-pagination">
                <button
                  className="ghost-button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  Prev
                </button>
                <span>
                  Page {page + 1} / {totalPages}
                </span>
                <button
                  className="ghost-button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Next
                </button>
              </div>
            </section>
          )}
          <ResultsPanel results={results} />
        </section>
      </main>
    </div>
  )
}
