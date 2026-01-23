export type DistributionType = 'lognormal' | 'gamma'
export type Mode = 'wait_on_chain' | 'offchain_hold'
export type LatencyMode = 'combined' | 'per_leg'

export interface DistributionSpec {
  type: DistributionType
  mean: number
  p95: number
}

export interface NetworkLatencySpec {
  mode: LatencyMode
  combined: DistributionSpec
  terminalToNetwork: DistributionSpec
  networkToIssuer: DistributionSpec
  issuerToNetwork: DistributionSpec
  networkToTerminal: DistributionSpec
}

export interface StellarSpec {
  ledgerCloseMean: number
  ledgerJitter: number
  submissionDelay: DistributionSpec
  inclusionProbability: number
  baseFee: number
  feeBumpFactor: number
  maxRetries: number
  backoffBaseMs: number
  backoffMultiplier: number
  maxSettleWindowSec: number
}

export interface OutageSpec {
  enabled: boolean
  startHour: number
  durationHours: number
  submissionDelayMultiplier: number
  inclusionProbabilityMultiplier: number
}

export interface UserModelSpec {
  users: number
  avgBalance: number
  balanceDistribution: DistributionSpec
  purchaseRate: number
  avgTicket: number
  ticketDistribution: DistributionSpec
  burstinessEnabled: boolean
  burstinessProbability: number
  burstinessMultiplier: number
}

export interface HoldSpec {
  enabled: boolean
  holdDurationSec: number
  allowIncremental: boolean
}

export interface PreAuthSpec {
  enabled: boolean
  completionDelay: DistributionSpec
  completionMultiplierMean: number
  completionMultiplierP95: number
}

export interface FraudSpec {
  enabled: boolean
  fraudAttemptRate: number
  fraudAmountMultiplierMean: number
  fraudAmountMultiplierP95: number
  autoDeclineRate: number
}

export interface SpendLimitSpec {
  enabled: boolean
  perTransactionLimit: number
  perUserDailyLimit: number
  perUserTimeslotLimit: number
  timeslotMinutes: number
}

export interface SimulationSpec {
  horizonHours: number
  monteCarloRuns: number
  seed: string
  mode: Mode
  authTimeoutSec: number
  issuerProcessing: DistributionSpec
  networkLatency: NetworkLatencySpec
  stellar: StellarSpec
  outage: OutageSpec
  userModel: UserModelSpec
  holds: HoldSpec
  preAuth: PreAuthSpec
  fraud: FraudSpec
  spendLimits: SpendLimitSpec
  settlementSlaSec: number
}

export interface SettlementResult {
  confirmed: boolean
  timeSec: number
  retries: number
  gaveUp: boolean
}

export interface ExposureEvent {
  userId: number
  amount: number
  startSec: number
  endSec: number
}

export interface TimeSeriesPoint {
  timeSec: number
  exposure: number
  approvals: number
  declines: number
  timeouts: number
}

export interface HistogramBin {
  label: string
  value: number
}

export interface SimulationMetrics {
  approvals: number
  declines: number
  timeouts: number
  approvalRate: number
  declineRate: number
  timeoutRate: number
  avgAuthTimeSec: number
  p95AuthTimeSec: number
  settlementSuccessRate: number
  settlementFailRate: number
  avgSettlementTimeSec: number
  p95SettlementTimeSec: number
  retryP95: number
  exposureCount: number
  totalExposure: number
  peakExposure: number
  p95Exposure: number
  exposureDurationP95Sec: number
  overspendPrevented: number
  avgPendingHolds: number
  p95PendingHolds: number
  preAuthMismatchRate: number
  incrementalAuthSuccessRate: number
  fraudAttemptRate: number
  fraudApprovalRate: number
  fraudExposureTotal: number
  fraudLossTotal: number
  limitDeclines: number
  totalSpent: number
  fraudApprovalRateNoLimits: number
  fraudExposureTotalNoLimits: number
  fraudLossTotalNoLimits: number
  insufficientFundsSkipped: number
}

export interface SimulationResults {
  metrics: SimulationMetrics
  timeSeries: TimeSeriesPoint[]
  settlementHistogram: HistogramBin[]
  authHistogram: HistogramBin[]
  exposureHistogram: HistogramBin[]
  exposurePerUserHistogram: HistogramBin[]
  settlementPercentiles: HistogramBin[]
  authPercentiles: HistogramBin[]
  exposurePercentiles: HistogramBin[]
  retryHistogram: HistogramBin[]
  exposureEvents: ExposureEvent[]
  scenarioSummary: string
  seed: string
}

export interface SimulationRunResult {
  metrics: SimulationMetrics
  timeSeries: TimeSeriesPoint[]
  settlementTimes: number[]
  authTimes: number[]
  exposureEvents: ExposureEvent[]
  retries: number[]
  exposureDurations: number[]
  pendingHoldSamples: number[]
  preAuthMismatchCount: number
  preAuthCount: number
  incrementalAuthSuccessCount: number
  incrementalAuthCount: number
  fraudAttempts: number
  fraudApprovals: number
}

export type SimulationEventType =
  | 'purchase'
  | 'settlement'
  | 'hold_expiry'
  | 'completion'

export interface SimulationEvent {
  timeSec: number
  type: SimulationEventType
  userId: number
  txnId: number
  amount: number
  relatedAmount?: number
  settlement?: SettlementResult
  isFraud?: boolean
}
