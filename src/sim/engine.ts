import {
  ExposureEvent,
  SimulationResults,
  SimulationRunResult,
  SimulationSpec,
  TimeSeriesPoint
} from './types'
import { createRng, RNG } from './rng'
import { average, histogram, percentile, sampleDistribution } from './sampling'
import { simulateSettlement } from './settlement'
import { MinHeap } from './queue'

const P95 = 0.95

function sampleInterarrival(rng: RNG, lambdaPerSec: number, bursty: boolean, burstProb: number, burstMult: number) {
  const rate = bursty && rng() < burstProb ? lambdaPerSec * burstMult : lambdaPerSec
  if (rate <= 0) return Infinity
  const u = Math.max(rng(), 1e-12)
  return -Math.log(u) / rate
}

function sampleNetworkLegs(rng: RNG, spec: SimulationSpec['networkLatency']) {
  if (spec.mode === 'combined') {
    const rttMs = sampleDistribution(rng, spec.combined)
    const half = rttMs / 2
    return {
      t1: half / 1000,
      t2: 0,
      t3: 0,
      t4: half / 1000
    }
  }
  return {
    t1: sampleDistribution(rng, spec.terminalToNetwork) / 1000,
    t2: sampleDistribution(rng, spec.networkToIssuer) / 1000,
    t3: sampleDistribution(rng, spec.issuerToNetwork) / 1000,
    t4: sampleDistribution(rng, spec.networkToTerminal) / 1000
  }
}

function initTimeSeries(horizonSec: number, bins: number) {
  const binSize = horizonSec / bins
  const series: TimeSeriesPoint[] = []
  for (let i = 0; i <= bins; i += 1) {
    series.push({
      timeSec: i * binSize,
      exposure: 0,
      approvals: 0,
      declines: 0,
      timeouts: 0
    })
  }
  return { series, binSize }
}

function addTimeSeriesPoint(series: TimeSeriesPoint[], binSize: number, timeSec: number, key: keyof TimeSeriesPoint) {
  const idx = Math.min(series.length - 1, Math.max(0, Math.floor(timeSec / binSize)))
  series[idx][key] += 1
}

function accumulateExposure(series: TimeSeriesPoint[], binSize: number, event: ExposureEvent) {
  const startIdx = Math.floor(event.startSec / binSize)
  const endIdx = Math.ceil(event.endSec / binSize)
  for (let i = Math.max(0, startIdx); i < Math.min(series.length, endIdx + 1); i += 1) {
    series[i].exposure += event.amount
  }
}

function buildScenarioSummary(spec: SimulationSpec) {
  const lines = [
    `Mode: ${spec.mode === 'wait_on_chain' ? 'Wait for on-chain' : 'Off-chain hold'}`,
    `Auth timeout: ${spec.authTimeoutSec}s`,
    `Users: ${spec.userModel.users}, horizon: ${spec.horizonHours}h, lambda/user: ${spec.userModel.purchaseRate}/hr`,
    `Stellar close ~${spec.stellar.ledgerCloseMean}s, inclusion: ${spec.stellar.inclusionProbability}`,
    `Network mean: ${spec.networkLatency.combined.mean}ms, issuer mean: ${spec.issuerProcessing.mean}ms`,
    `Holds: ${spec.holds.enabled ? `on (${spec.holds.holdDurationSec}s)` : 'off'}, pre-auth: ${spec.preAuth.enabled ? 'on' : 'off'}`
  ]
  return lines.join(' | ')
}

export function simulateOnce(spec: SimulationSpec, baseSeed: string, runIndex: number): SimulationRunResult {
  const rng = createRng(`${baseSeed}-${runIndex}`)
  const horizonSec = spec.horizonHours * 3600
  const events = new MinHeap()
  const balances: number[] = []
  const holdTotals = new Array(spec.userModel.users).fill(0)
  const holdCounts = new Array(spec.userModel.users).fill(0)
  const pendingHoldSamples: number[] = []
  const userDailySpend = new Map<number, Map<number, number>>()
  const userTimeslotSpend = new Map<number, Map<number, number>>()

  let txnId = 0
  for (let u = 0; u < spec.userModel.users; u += 1) {
    balances[u] = sampleDistribution(rng, spec.userModel.balanceDistribution)
    let t = 0
    const lambdaPerSec = spec.userModel.purchaseRate / 3600
    while (t < horizonSec) {
      const inter = sampleInterarrival(
        rng,
        lambdaPerSec,
        spec.userModel.burstinessEnabled,
        spec.userModel.burstinessProbability,
        spec.userModel.burstinessMultiplier
      )
      t += inter
      if (t > horizonSec) break
      const amount = sampleDistribution(rng, spec.userModel.ticketDistribution)
      events.push({
        timeSec: t,
        type: 'purchase',
        userId: u,
        txnId: txnId,
        amount
      })
      txnId += 1
    }
  }

  const approvals: number[] = []
  const declines: number[] = []
  const timeouts: number[] = []
  const authTimes: number[] = []
  const settlementTimes: number[] = []
  const retries: number[] = []
  const exposureEvents: ExposureEvent[] = []
  const exposureDurations: number[] = []

  const authContext = new Map<
    number,
    { requestTime: number; legsOut: number; issuerDone: number; amount: number; isFraud: boolean }
  >()
  const holdByTxn = new Map<number, { userId: number; amount: number; approvalTime: number }>()

  const dayIndex = (timeSec: number) => Math.floor(timeSec / 86400)

  const getUserDailySpend = (userId: number, day: number) => {
    const userMap = userDailySpend.get(userId)
    if (!userMap) return 0
    return userMap.get(day) ?? 0
  }

  const addUserDailySpend = (userId: number, day: number, amount: number) => {
    let userMap = userDailySpend.get(userId)
    if (!userMap) {
      userMap = new Map()
      userDailySpend.set(userId, userMap)
    }
    userMap.set(day, (userMap.get(day) ?? 0) + amount)
  }

  const timeslotIndex = (timeSec: number) => {
    const windowSec = Math.max(1, spec.spendLimits.timeslotMinutes) * 60
    return Math.floor(timeSec / windowSec)
  }

  const getUserTimeslotSpend = (userId: number, slot: number) => {
    const userMap = userTimeslotSpend.get(userId)
    if (!userMap) return 0
    return userMap.get(slot) ?? 0
  }

  const addUserTimeslotSpend = (userId: number, slot: number, amount: number) => {
    let userMap = userTimeslotSpend.get(userId)
    if (!userMap) {
      userMap = new Map()
      userTimeslotSpend.set(userId, userMap)
    }
    userMap.set(slot, (userMap.get(slot) ?? 0) + amount)
  }

  const canApproveWithLimits = (userId: number, amount: number, timeSec: number) => {
    if (!spec.spendLimits.enabled) return true
    if (spec.spendLimits.perTransactionLimit > 0 && amount > spec.spendLimits.perTransactionLimit) {
      return false
    }
    const day = dayIndex(timeSec)
    if (
      spec.spendLimits.perUserDailyLimit > 0 &&
      getUserDailySpend(userId, day) + amount > spec.spendLimits.perUserDailyLimit
    ) {
      return false
    }
    const slot = timeslotIndex(timeSec)
    if (
      spec.spendLimits.perUserTimeslotLimit > 0 &&
      getUserTimeslotSpend(userId, slot) + amount > spec.spendLimits.perUserTimeslotLimit
    ) {
      return false
    }
    return true
  }

  const applySpendLimits = (userId: number, amount: number, timeSec: number) => {
    if (!spec.spendLimits.enabled) return
    const day = dayIndex(timeSec)
    addUserDailySpend(userId, day, amount)
    const slot = timeslotIndex(timeSec)
    addUserTimeslotSpend(userId, slot, amount)
  }

  let overspendPrevented = 0
  let preAuthMismatchCount = 0
  let preAuthCount = 0
  let incrementalAuthSuccessCount = 0
  let incrementalAuthCount = 0
  let fraudAttempts = 0
  let fraudApprovals = 0
  let fraudExposureTotal = 0
  let fraudApprovedAmount = 0
  let fraudLossTotal = 0
  let limitDeclines = 0
  let totalSpent = 0
  let insufficientFundsSkipped = 0

  const { series, binSize } = initTimeSeries(horizonSec, 120)

  while (events.size > 0) {
    const event = events.pop()
    if (!event) break

    if (event.type === 'purchase') {
      const userId = event.userId
      const availablePre = balances[userId] - holdTotals[userId]
      if (availablePre <= 0) {
        continue
      }
      let amount = event.amount
      const isFraud = spec.fraud.enabled && rng() < spec.fraud.fraudAttemptRate
      if (isFraud) {
        fraudAttempts += 1
        const multiplierSpec = {
          type: 'lognormal' as const,
          mean: spec.fraud.fraudAmountMultiplierMean,
          p95: spec.fraud.fraudAmountMultiplierP95
        }
        amount *= sampleDistribution(rng, multiplierSpec)
        const autoDecline = rng() < spec.fraud.autoDeclineRate
        if (autoDecline) {
          declines.push(event.txnId)
          addTimeSeriesPoint(series, binSize, event.timeSec, 'declines')
          continue
        }
      }
      const legs = sampleNetworkLegs(rng, spec.networkLatency)
      const processingSec = sampleDistribution(rng, spec.issuerProcessing) / 1000
      const issuerDone = event.timeSec + legs.t1 + legs.t2 + processingSec
      const authTime = legs.t1 + legs.t2 + processingSec + legs.t3 + legs.t4

      if (spec.mode === 'wait_on_chain') {
        const settlement = simulateSettlement(rng, spec.stellar, issuerDone, spec.outage)
        const settlementTime = settlement.timeSec
        authContext.set(event.txnId, {
          requestTime: event.timeSec,
          legsOut: legs.t3 + legs.t4,
          issuerDone,
          amount,
          isFraud
        })
        events.push({
          timeSec: issuerDone + settlementTime,
          type: 'settlement',
          userId,
          txnId: event.txnId,
          amount,
          isFraud,
          settlement
        })
      } else {
        if (authTime > spec.authTimeoutSec) {
          timeouts.push(event.txnId)
          addTimeSeriesPoint(series, binSize, event.timeSec, 'timeouts')
          continue
        }
        if (!canApproveWithLimits(userId, amount, event.timeSec)) {
          limitDeclines += 1
          declines.push(event.txnId)
          addTimeSeriesPoint(series, binSize, event.timeSec, 'declines')
          continue
        }
        const availableBalance = balances[userId] - holdTotals[userId]
        if (availableBalance < amount) {
          if (balances[userId] >= amount) {
            overspendPrevented += 1
          }
          insufficientFundsSkipped += 1
          continue
        }
        approvals.push(event.txnId)
        if (isFraud) fraudApprovals += 1
        authTimes.push(authTime)
        addTimeSeriesPoint(series, binSize, event.timeSec, 'approvals')
        applySpendLimits(userId, amount, event.timeSec)
        totalSpent += amount
        if (isFraud) {
          fraudApprovedAmount += amount
          fraudLossTotal += amount
        }

        const approvalTime = issuerDone
        if (spec.holds.enabled) {
          holdTotals[userId] += amount
          holdCounts[userId] += 1
          pendingHoldSamples.push(holdCounts[userId])
          events.push({
            timeSec: approvalTime + spec.holds.holdDurationSec,
            type: 'hold_expiry',
            userId,
            txnId: event.txnId,
            amount,
            isFraud
          })
          holdByTxn.set(event.txnId, { userId, amount, approvalTime })
        }

        if (spec.preAuth.enabled) {
          preAuthCount += 1
          const completionDelaySec = sampleDistribution(rng, spec.preAuth.completionDelay) / 1000
          const multiplierSpec = {
            type: 'lognormal' as const,
            mean: spec.preAuth.completionMultiplierMean,
            p95: spec.preAuth.completionMultiplierP95
          }
          const multiplier = sampleDistribution(rng, multiplierSpec)
          const finalAmount = amount * multiplier
          if (Math.abs(finalAmount - amount) / amount > 0.05) {
            preAuthMismatchCount += 1
          }
          events.push({
            timeSec: event.timeSec + completionDelaySec,
            type: 'completion',
            userId,
            txnId: event.txnId,
            amount: finalAmount,
            relatedAmount: amount,
            isFraud
          })
        } else {
          const settlement = simulateSettlement(rng, spec.stellar, issuerDone, spec.outage)
          events.push({
            timeSec: issuerDone + settlement.timeSec,
            type: 'settlement',
            userId,
            txnId: event.txnId,
            amount,
            isFraud,
            settlement
          })
        }
      }
    }

    if (event.type === 'completion') {
      const userId = event.userId
      const finalAmount = event.amount
      const initialAmount = event.relatedAmount ?? event.amount
      const delta = finalAmount - initialAmount
      if (delta > 0 && spec.holds.allowIncremental) {
        incrementalAuthCount += 1
        if (!canApproveWithLimits(userId, delta, event.timeSec)) {
          limitDeclines += 1
        } else {
          applySpendLimits(userId, delta, event.timeSec)
        }
        const availableBalance = balances[userId] - holdTotals[userId]
        if (availableBalance >= delta) {
          incrementalAuthSuccessCount += 1
          holdTotals[userId] += delta
          holdCounts[userId] += 1
          pendingHoldSamples.push(holdCounts[userId])
        }
      }
      const legs = sampleNetworkLegs(rng, spec.networkLatency)
      const processingSec = sampleDistribution(rng, spec.issuerProcessing) / 1000
      const issuerDone = event.timeSec + legs.t1 + legs.t2 + processingSec
      const settlement = simulateSettlement(rng, spec.stellar, issuerDone, spec.outage)
      events.push({
        timeSec: issuerDone + settlement.timeSec,
        type: 'settlement',
        userId,
        txnId: event.txnId,
        amount: finalAmount,
        settlement,
        isFraud: event.isFraud
      })
    }

    if (event.type === 'hold_expiry') {
      const hold = holdByTxn.get(event.txnId)
      if (hold) {
        holdTotals[hold.userId] -= hold.amount
        holdCounts[hold.userId] = Math.max(0, holdCounts[hold.userId] - 1)
        pendingHoldSamples.push(holdCounts[hold.userId])
        holdByTxn.delete(event.txnId)
      }
    }

    if (event.type === 'settlement') {
      const settlement = event.settlement
      if (!settlement) continue
      const userId = event.userId

      if (spec.mode === 'wait_on_chain') {
        const ctx = authContext.get(event.txnId)
        if (!ctx) continue
        const authTime = (event.timeSec - ctx.requestTime) + ctx.legsOut
        if (authTime > spec.authTimeoutSec || !settlement.confirmed) {
          if (authTime > spec.authTimeoutSec) {
            timeouts.push(event.txnId)
            addTimeSeriesPoint(series, binSize, event.timeSec, 'timeouts')
          } else {
            declines.push(event.txnId)
            addTimeSeriesPoint(series, binSize, event.timeSec, 'declines')
          }
          continue
        }
        if (!canApproveWithLimits(userId, event.amount, ctx.requestTime)) {
          limitDeclines += 1
          declines.push(event.txnId)
          addTimeSeriesPoint(series, binSize, event.timeSec, 'declines')
          continue
        }
        if (balances[userId] < event.amount) {
          insufficientFundsSkipped += 1
          continue
        }
        balances[userId] -= event.amount
        approvals.push(event.txnId)
        if (ctx.isFraud) fraudApprovals += 1
        authTimes.push(authTime)
        settlementTimes.push(settlement.timeSec)
        retries.push(settlement.retries)
        addTimeSeriesPoint(series, binSize, event.timeSec, 'approvals')
        applySpendLimits(userId, event.amount, ctx.requestTime)
        totalSpent += event.amount
        if (ctx.isFraud) {
          fraudApprovedAmount += event.amount
          fraudLossTotal += event.amount
        }
      } else {
        const hold = holdByTxn.get(event.txnId)
        const approvalTime = hold?.approvalTime ?? event.timeSec
        const settlementTime = settlement.timeSec
        let confirmed = settlement.confirmed
        if (confirmed && balances[userId] >= event.amount) {
          balances[userId] -= event.amount
        } else {
          confirmed = false
        }

        if (confirmed) {
          settlementTimes.push(settlementTime)
          retries.push(settlement.retries)
        }

        if (!confirmed || settlementTime > spec.settlementSlaSec) {
          const endTime = approvalTime + Math.min(settlementTime, spec.stellar.maxSettleWindowSec)
          exposureEvents.push({
            userId,
            amount: event.amount,
            startSec: approvalTime,
            endSec: endTime
          })
          exposureDurations.push(endTime - approvalTime)
          if (event.isFraud) {
            fraudExposureTotal += event.amount
          }
        }

        if (hold) {
          holdTotals[userId] -= hold.amount
          holdCounts[userId] = Math.max(0, holdCounts[userId] - 1)
          pendingHoldSamples.push(holdCounts[userId])
          holdByTxn.delete(event.txnId)
        }
      }
    }
  }

  for (const exp of exposureEvents) {
    accumulateExposure(series, binSize, exp)
  }

  return {
    metrics: {
      approvals: approvals.length,
      declines: declines.length,
      timeouts: timeouts.length,
      approvalRate: 0,
      declineRate: 0,
      timeoutRate: 0,
      avgAuthTimeSec: average(authTimes),
      p95AuthTimeSec: percentile(authTimes, P95),
      settlementSuccessRate: 0,
      settlementFailRate: 0,
      avgSettlementTimeSec: average(settlementTimes),
      p95SettlementTimeSec: percentile(settlementTimes, P95),
      retryP95: percentile(retries, P95),
      exposureCount: exposureEvents.length,
      totalExposure: exposureEvents.reduce((sum, e) => sum + e.amount, 0),
      peakExposure: Math.max(0, ...series.map((s) => s.exposure)),
      p95Exposure: percentile(series.map((s) => s.exposure), P95),
      exposureDurationP95Sec: percentile(exposureDurations, P95),
      overspendPrevented,
      avgPendingHolds: average(pendingHoldSamples),
      p95PendingHolds: percentile(pendingHoldSamples, P95),
      preAuthMismatchRate: preAuthCount ? preAuthMismatchCount / preAuthCount : 0,
      incrementalAuthSuccessRate: incrementalAuthCount
        ? incrementalAuthSuccessCount / incrementalAuthCount
        : 0,
      fraudAttemptRate: fraudAttempts ? fraudAttempts / Math.max(1, approvals.length + declines.length + timeouts.length) : 0,
      fraudApprovalRate: fraudAttempts ? fraudApprovals / fraudAttempts : 0,
      fraudExposureTotal,
      fraudLossTotal,
      limitDeclines,
      totalSpent,
      insufficientFundsSkipped
    },
    timeSeries: series,
    settlementTimes,
    authTimes,
    exposureEvents,
    retries,
    exposureDurations,
    pendingHoldSamples,
    preAuthMismatchCount,
    preAuthCount,
    incrementalAuthSuccessCount,
    incrementalAuthCount,
    fraudAttempts,
    fraudApprovals
  }
}

function mergeTimeSeries(target: TimeSeriesPoint[], source: TimeSeriesPoint[]) {
  for (let i = 0; i < target.length; i += 1) {
    target[i].approvals += source[i].approvals
    target[i].declines += source[i].declines
    target[i].timeouts += source[i].timeouts
    target[i].exposure += source[i].exposure
  }
}

export function runSimulationRuns(
  spec: SimulationSpec,
  startIndex: number,
  count: number,
  onProgress?: (value: number) => void
): SimulationRunResult[] {
  const runs: SimulationRunResult[] = []
  for (let i = 0; i < count; i += 1) {
    const run = simulateOnce(spec, spec.seed, startIndex + i)
    runs.push(run)
    if (onProgress) onProgress(i + 1)
  }
  return runs
}

export function aggregateRunResults(spec: SimulationSpec, runs: SimulationRunResult[]): SimulationResults {
  const runCount = Math.max(1, runs.length)
  let aggregateSeries: TimeSeriesPoint[] = []
  const settlementTimes: number[] = []
  const authTimes: number[] = []
  const exposureEvents: ExposureEvent[] = []
  const retries: number[] = []
  const exposureDurations: number[] = []
  const pendingHoldSamples: number[] = []
  let approvals = 0
  let declines = 0
  let timeouts = 0
  let fraudAttempts = 0
  let fraudApprovals = 0
  let fraudExposureTotal = 0
  let fraudLossTotal = 0
  let overspendPrevented = 0
  let limitDeclines = 0
  let totalSpent = 0
  let insufficientFundsSkipped = 0
  let preAuthMismatch = 0
  let preAuthCount = 0
  let incrementalAuthSuccess = 0
  let incrementalAuthCount = 0

  for (const run of runs) {
    approvals += run.metrics.approvals
    declines += run.metrics.declines
    timeouts += run.metrics.timeouts
    overspendPrevented += run.metrics.overspendPrevented
    fraudAttempts += run.fraudAttempts
    fraudApprovals += run.fraudApprovals
    fraudExposureTotal += run.metrics.fraudExposureTotal
    fraudLossTotal += run.metrics.fraudLossTotal
    limitDeclines += run.metrics.limitDeclines
    totalSpent += run.metrics.totalSpent
    insufficientFundsSkipped += run.metrics.insufficientFundsSkipped
    settlementTimes.push(...run.settlementTimes)
    authTimes.push(...run.authTimes)
    exposureEvents.push(...run.exposureEvents)
    retries.push(...run.retries)
    exposureDurations.push(...run.exposureDurations)
    pendingHoldSamples.push(...run.pendingHoldSamples)
    preAuthMismatch += run.preAuthMismatchCount
    preAuthCount += run.preAuthCount
    incrementalAuthSuccess += run.incrementalAuthSuccessCount
    incrementalAuthCount += run.incrementalAuthCount

    if (aggregateSeries.length === 0) {
      aggregateSeries = run.timeSeries.map((point) => ({ ...point }))
    } else {
      mergeTimeSeries(aggregateSeries, run.timeSeries)
    }
  }

  const total = approvals + declines + timeouts
  const settlementSuccessRate = settlementTimes.length / Math.max(1, approvals)
  const settlementFailRate = 1 - settlementSuccessRate

  const metrics = {
    approvals,
    declines,
    timeouts,
    approvalRate: total ? approvals / total : 0,
    declineRate: total ? declines / total : 0,
    timeoutRate: total ? timeouts / total : 0,
    avgAuthTimeSec: average(authTimes),
    p95AuthTimeSec: percentile(authTimes, P95),
    settlementSuccessRate,
    settlementFailRate,
    avgSettlementTimeSec: average(settlementTimes),
    p95SettlementTimeSec: percentile(settlementTimes, P95),
    retryP95: percentile(retries, P95),
    exposureCount: exposureEvents.length,
    totalExposure: exposureEvents.reduce((sum, e) => sum + e.amount, 0),
    peakExposure: Math.max(0, ...aggregateSeries.map((s) => s.exposure)),
    p95Exposure: percentile(aggregateSeries.map((s) => s.exposure), P95),
    exposureDurationP95Sec: percentile(exposureDurations, P95),
    overspendPrevented,
    avgPendingHolds: average(pendingHoldSamples),
    p95PendingHolds: percentile(pendingHoldSamples, P95),
    preAuthMismatchRate: preAuthCount ? preAuthMismatch / preAuthCount : 0,
    incrementalAuthSuccessRate: incrementalAuthCount ? incrementalAuthSuccess / incrementalAuthCount : 0,
    fraudAttemptRate: total ? fraudAttempts / total : 0,
    fraudApprovalRate: fraudAttempts ? fraudApprovals / fraudAttempts : 0,
    fraudExposureTotal,
    fraudLossTotal,
    limitDeclines,
    totalSpent,
    insufficientFundsSkipped,
    fraudApprovalRateNoLimits: 0,
    fraudExposureTotalNoLimits: 0,
    fraudLossTotalNoLimits: 0
  }

  const timeSeries = aggregateSeries.map((point) => ({
    ...point,
    approvals: point.approvals / runCount,
    declines: point.declines / runCount,
    timeouts: point.timeouts / runCount,
    exposure: point.exposure / runCount
  }))

  const settlementHistogram = histogram(settlementTimes, 24)
  const authHistogram = histogram(authTimes, 24)
  const exposureHistogram = histogram(exposureEvents.map((e) => e.amount), 20)
  const percentileLabels = [0.5, 0.75, 0.9, 0.95, 0.99]
  const settlementPercentiles = percentileLabels.map((p) => ({
    label: `p${Math.round(p * 100)}`,
    value: percentile(settlementTimes, p)
  }))
  const authPercentiles = percentileLabels.map((p) => ({
    label: `p${Math.round(p * 100)}`,
    value: percentile(authTimes, p)
  }))
  const exposurePercentiles = percentileLabels.map((p) => ({
    label: `p${Math.round(p * 100)}`,
    value: percentile(exposureEvents.map((e) => e.amount), p)
  }))
  const exposureByUser = new Map<number, number>()
  for (const event of exposureEvents) {
    exposureByUser.set(event.userId, (exposureByUser.get(event.userId) ?? 0) + event.amount)
  }
  const exposurePerUserHistogram = histogram([...exposureByUser.values()], 20)
  const retryHistogram = histogram(retries, 10)

  return {
    metrics,
    timeSeries,
    settlementHistogram,
    authHistogram,
    exposureHistogram,
    exposurePerUserHistogram,
    settlementPercentiles,
    authPercentiles,
    exposurePercentiles,
    retryHistogram,
    exposureEvents,
    scenarioSummary: buildScenarioSummary(spec),
    seed: spec.seed
  }
}

function runSimulationInternal(
  spec: SimulationSpec,
  onProgress?: (value: number) => void,
  progressScale = 1,
  progressOffset = 0
): SimulationResults {
  const runs = Math.max(1, Math.floor(spec.monteCarloRuns))
  const runResults = runSimulationRuns(spec, 0, runs, (completed) => {
    if (onProgress) onProgress(progressOffset + (completed / runs) * progressScale)
  })
  return aggregateRunResults(spec, runResults)
}

export function runSimulation(spec: SimulationSpec): SimulationResults {
  const base = runSimulationInternal(spec)
  if (spec.fraud.enabled && spec.spendLimits.enabled) {
    const altSpec: SimulationSpec = {
      ...spec,
      spendLimits: { ...spec.spendLimits, enabled: false }
    }
    const noLimits = runSimulationInternal(altSpec)
    base.metrics.fraudApprovalRateNoLimits = noLimits.metrics.fraudApprovalRate
    base.metrics.fraudExposureTotalNoLimits = noLimits.metrics.fraudExposureTotal
    base.metrics.fraudLossTotalNoLimits = noLimits.metrics.fraudLossTotal
  } else {
    base.metrics.fraudApprovalRateNoLimits = base.metrics.fraudApprovalRate
    base.metrics.fraudExposureTotalNoLimits = base.metrics.fraudExposureTotal
    base.metrics.fraudLossTotalNoLimits = base.metrics.fraudLossTotal
  }
  return base
}

export function runSimulationWithProgress(
  spec: SimulationSpec,
  onProgress: (value: number) => void
): SimulationResults {
  const hasAlt = spec.fraud.enabled && spec.spendLimits.enabled
  const phaseScale = hasAlt ? 0.5 : 1
  onProgress(0)
  const base = runSimulationInternal(spec, onProgress, phaseScale, 0)
  if (hasAlt) {
    const altSpec: SimulationSpec = {
      ...spec,
      spendLimits: { ...spec.spendLimits, enabled: false }
    }
    const noLimits = runSimulationInternal(altSpec, onProgress, phaseScale, phaseScale)
    base.metrics.fraudApprovalRateNoLimits = noLimits.metrics.fraudApprovalRate
    base.metrics.fraudExposureTotalNoLimits = noLimits.metrics.fraudExposureTotal
    base.metrics.fraudLossTotalNoLimits = noLimits.metrics.fraudLossTotal
  } else {
    base.metrics.fraudApprovalRateNoLimits = base.metrics.fraudApprovalRate
    base.metrics.fraudExposureTotalNoLimits = base.metrics.fraudExposureTotal
    base.metrics.fraudLossTotalNoLimits = base.metrics.fraudLossTotal
  }
  onProgress(1)
  return base
}
