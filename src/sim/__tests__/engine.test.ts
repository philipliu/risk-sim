import { describe, expect, it } from 'vitest'
import { runSimulation } from '../engine'
import { SimulationSpec } from '../types'

const spec: SimulationSpec = {
  horizonHours: 1,
  monteCarloRuns: 1,
  seed: 'deterministic',
  mode: 'offchain_hold',
  authTimeoutSec: 6,
  issuerProcessing: { type: 'lognormal', mean: 120, p95: 300 },
  networkLatency: {
    mode: 'combined',
    combined: { type: 'lognormal', mean: 200, p95: 500 },
    terminalToNetwork: { type: 'lognormal', mean: 50, p95: 120 },
    networkToIssuer: { type: 'lognormal', mean: 50, p95: 120 },
    issuerToNetwork: { type: 'lognormal', mean: 50, p95: 120 },
    networkToTerminal: { type: 'lognormal', mean: 50, p95: 120 }
  },
  stellar: {
    ledgerCloseMean: 6,
    ledgerJitter: 1,
    submissionDelay: { type: 'lognormal', mean: 200, p95: 600 },
    inclusionProbability: 0.8,
    baseFee: 100,
    feeBumpFactor: 1.5,
    maxRetries: 2,
    backoffBaseMs: 500,
    backoffMultiplier: 2,
    maxSettleWindowSec: 60
  },
  outage: {
    enabled: false,
    startHour: 0,
    durationHours: 0,
    submissionDelayMultiplier: 1,
    inclusionProbabilityMultiplier: 1
  },
  userModel: {
    users: 50,
    avgBalance: 200,
    balanceDistribution: { type: 'lognormal', mean: 200, p95: 400 },
    purchaseRate: 1,
    avgTicket: 20,
    ticketDistribution: { type: 'lognormal', mean: 20, p95: 50 },
    burstinessEnabled: false,
    burstinessProbability: 0,
    burstinessMultiplier: 1
  },
  holds: {
    enabled: true,
    holdDurationSec: 90,
    allowIncremental: true
  },
  preAuth: {
    enabled: false,
    completionDelay: { type: 'lognormal', mean: 60000, p95: 120000 },
    completionMultiplierMean: 1.05,
    completionMultiplierP95: 1.2
  },
  fraud: {
    enabled: false,
    doubleSpendRate: 0.01,
    blockOnFraudAttempt: true
  },
  spendLimits: {
    enabled: false,
    perTransactionLimit: 300,
    perUserDailyLimit: 1200,
    perUserTimeslotLimit: 400,
    timeslotMinutes: 60
  },
  settlementSlaSec: 40
}

describe('simulation engine', () => {
  it('produces deterministic metrics for fixed seed', () => {
    const result = runSimulation(spec)
    expect(result.metrics.approvals).toBe(32)
    expect(result.metrics.declines).toBe(0)
    expect(result.metrics.timeouts).toBe(0)
    expect(result.metrics.approvalRate).toBeCloseTo(1.0, 4)
    expect(result.metrics.avgAuthTimeSec).toBeCloseTo(0.2169, 3)
    expect(result.metrics.p95SettlementTimeSec).toBeCloseTo(14.216, 2)
    expect(result.metrics.exposureCount).toBe(0)
    expect(result.metrics.insufficientFundsSkipped).toBe(25)
  })
})
