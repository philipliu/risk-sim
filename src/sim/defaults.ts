import { SimulationSpec } from './types'

export const defaultSpec: SimulationSpec = {
  horizonHours: 24,
  monteCarloRuns: 1,
  seed: 'stellar-001',
  mode: 'offchain_hold',
  authTimeoutSec: 5,
  issuerProcessing: {
    type: 'lognormal',
    mean: 180,
    p95: 600
  },
  networkLatency: {
    mode: 'combined',
    combined: {
      type: 'lognormal',
      mean: 320,
      p95: 900
    },
    terminalToNetwork: {
      type: 'lognormal',
      mean: 80,
      p95: 250
    },
    networkToIssuer: {
      type: 'lognormal',
      mean: 80,
      p95: 250
    },
    issuerToNetwork: {
      type: 'lognormal',
      mean: 80,
      p95: 250
    },
    networkToTerminal: {
      type: 'lognormal',
      mean: 80,
      p95: 250
    }
  },
  stellar: {
    ledgerCloseMean: 5.8,
    ledgerJitter: 1.2,
    submissionDelay: {
      type: 'lognormal',
      mean: 300,
      p95: 1200
    },
    inclusionProbability: 0.82,
    baseFee: 100,
    feeBumpFactor: 1.5,
    maxRetries: 3,
    backoffBaseMs: 800,
    backoffMultiplier: 1.8,
    maxSettleWindowSec: 120
  },
  outage: {
    enabled: false,
    startHour: 6,
    durationHours: 2,
    submissionDelayMultiplier: 2.2,
    inclusionProbabilityMultiplier: 0.6
  },
  userModel: {
    users: 1000,
    avgBalance: 300,
    balanceDistribution: {
      type: 'lognormal',
      mean: 300,
      p95: 1000
    },
    purchaseRate: 1.1,
    avgTicket: 25,
    ticketDistribution: {
      type: 'lognormal',
      mean: 25,
      p95: 80
    },
    burstinessEnabled: true,
    burstinessProbability: 0.18,
    burstinessMultiplier: 3
  },
  holds: {
    enabled: true,
    holdDurationSec: 120,
    allowIncremental: true
  },
  preAuth: {
    enabled: false,
    completionDelay: {
      type: 'lognormal',
      mean: 45000,
      p95: 120000
    },
    completionMultiplierMean: 1.02,
    completionMultiplierP95: 1.2
  },
  fraud: {
    enabled: false,
    fraudAttemptRate: 0.008,
    fraudAmountMultiplierMean: 1.4,
    fraudAmountMultiplierP95: 2.2,
    autoDeclineRate: 0.6
  },
  spendLimits: {
    enabled: false,
    perTransactionLimit: 300,
    perUserDailyLimit: 1200,
    perUserTimeslotLimit: 400,
    timeslotMinutes: 60
  },
  settlementSlaSec: 45
}
