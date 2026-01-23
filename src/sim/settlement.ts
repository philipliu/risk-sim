import { RNG } from './rng'
import { OutageSpec, SettlementResult, StellarSpec } from './types'
import { sampleDistribution } from './sampling'

function sampleLedgerInterval(rng: RNG, mean: number, jitter: number) {
  if (jitter <= 0) return mean
  const delta = (rng() * 2 - 1) * jitter
  return Math.max(0.1, mean + delta)
}

export function simulateSettlement(
  rng: RNG,
  spec: StellarSpec,
  startTimeSec: number,
  outage: OutageSpec
): SettlementResult {
  const outageStart = outage.startHour * 3600
  const outageEnd = outageStart + outage.durationHours * 3600
  const inOutage = outage.enabled && startTimeSec >= outageStart && startTimeSec <= outageEnd

  const submissionDelayMs = sampleDistribution(rng, spec.submissionDelay)
  const submissionDelaySec = (submissionDelayMs / 1000) * (inOutage ? outage.submissionDelayMultiplier : 1)
  const inclusionProb = Math.min(
    0.999,
    Math.max(0, spec.inclusionProbability * (inOutage ? outage.inclusionProbabilityMultiplier : 1))
  )

  let timeSec = submissionDelaySec
  let retries = 0
  while (true) {
    const interval = sampleLedgerInterval(rng, spec.ledgerCloseMean, spec.ledgerJitter)
    const residual = rng() * interval
    timeSec += residual
    const included = rng() < inclusionProb
    if (included) {
      return {
        confirmed: true,
        timeSec,
        retries,
        gaveUp: false
      }
    }
    timeSec += interval - residual
    if (retries >= spec.maxRetries) {
      return {
        confirmed: false,
        timeSec,
        retries,
        gaveUp: true
      }
    }
    retries += 1
    const backoffMs = spec.backoffBaseMs * Math.pow(spec.backoffMultiplier, retries - 1)
    timeSec += backoffMs / 1000
    if (timeSec > spec.maxSettleWindowSec) {
      return {
        confirmed: false,
        timeSec,
        retries,
        gaveUp: true
      }
    }
  }
}
