import { describe, expect, it } from 'vitest'
import { gammaParamsFromMeanP95, gammaQuantile, lognormalParamsFromMeanP95 } from '../sampling'

describe('sampling helpers', () => {
  it('lognormal params reproduce mean and p95', () => {
    const mean = 100
    const p95 = 220
    const { mu, sigma } = lognormalParamsFromMeanP95(mean, p95)
    const derivedMean = Math.exp(mu + 0.5 * sigma * sigma)
    const derivedP95 = Math.exp(mu + 1.6448536269514722 * sigma)
    expect(derivedMean).toBeCloseTo(mean, 5)
    expect(derivedP95).toBeCloseTo(p95, 4)
  })

  it('gamma params reproduce p95 within tolerance', () => {
    const mean = 50
    const p95 = 120
    const { shape, scale } = gammaParamsFromMeanP95(mean, p95)
    const derivedP95 = gammaQuantile(0.95, shape, scale)
    expect(derivedP95).toBeCloseTo(p95, 1)
  })
})
