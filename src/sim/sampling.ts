import { DistributionSpec } from './types'
import { RNG } from './rng'

const SQRT_2PI = Math.sqrt(2 * Math.PI)
const INV_SQRT_2PI = 1 / SQRT_2PI

export function normalSample(rng: RNG) {
  const u1 = Math.max(rng(), 1e-12)
  const u2 = Math.max(rng(), 1e-12)
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

export function lognormalParamsFromMeanP95(mean: number, p95: number) {
  const z = 1.6448536269514722
  const lnMean = Math.log(mean)
  const lnP95 = Math.log(p95)
  const a = 0.5
  const b = -z
  const c = lnP95 - lnMean
  const disc = b * b - 4 * a * c
  const sigma = (-b + Math.sqrt(Math.max(disc, 1e-12))) / (2 * a)
  const mu = lnMean - 0.5 * sigma * sigma
  return { mu, sigma }
}

export function sampleLognormal(rng: RNG, mean: number, p95: number) {
  if (mean <= 0 || p95 <= 0) {
    return 0
  }
  const { mu, sigma } = lognormalParamsFromMeanP95(mean, p95)
  const n = normalSample(rng)
  return Math.exp(mu + sigma * n)
}

function gammaLn(z: number) {
  const p = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019571e-6,
    1.5056327351493116e-7
  ]
  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - gammaLn(1 - z)
  }
  z -= 1
  let x = 0.99999999999980993
  for (let i = 0; i < p.length; i += 1) {
    x += p[i] / (z + i + 1)
  }
  const t = z + p.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

function gammaPSeries(a: number, x: number) {
  let sum = 1 / a
  let del = sum
  let ap = a
  for (let n = 1; n <= 100; n += 1) {
    ap += 1
    del *= x / ap
    sum += del
    if (Math.abs(del) < Math.abs(sum) * 3e-8) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammaLn(a))
}

function gammaPContinuedFraction(a: number, x: number) {
  const MAX = 100
  const EPS = 3e-8
  const FPMIN = 1e-30
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i <= MAX; i += 1) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return Math.exp(-x + a * Math.log(x) - gammaLn(a)) * h
}

export function regularizedGammaP(a: number, x: number) {
  if (x <= 0) return 0
  if (x < a + 1) {
    return gammaPSeries(a, x)
  }
  return 1 - gammaPContinuedFraction(a, x)
}

export function gammaQuantile(p: number, shape: number, scale: number) {
  if (p <= 0) return 0
  if (p >= 1) return Infinity
  const mean = shape * scale
  let low = 0
  let high = mean * 10 + 10
  for (let i = 0; i < 60; i += 1) {
    const mid = 0.5 * (low + high)
    const cdf = regularizedGammaP(shape, mid / scale)
    if (cdf < p) {
      low = mid
    } else {
      high = mid
    }
  }
  return 0.5 * (low + high)
}

export function gammaParamsFromMeanP95(mean: number, p95: number) {
  if (mean <= 0 || p95 <= 0) return { shape: 1, scale: 1 }
  let low = 0.2
  let high = 20
  for (let i = 0; i < 60; i += 1) {
    const mid = 0.5 * (low + high)
    const scale = mean / mid
    const q95 = gammaQuantile(0.95, mid, scale)
    if (q95 < p95) {
      high = mid
    } else {
      low = mid
    }
  }
  const shape = 0.5 * (low + high)
  const scale = mean / shape
  return { shape, scale }
}

export function sampleGamma(rng: RNG, shape: number, scale: number) {
  if (shape <= 0) return 0
  if (shape < 1) {
    const u = Math.max(rng(), 1e-12)
    return sampleGamma(rng, shape + 1, scale) * Math.pow(u, 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  while (true) {
    let x = normalSample(rng)
    let v = 1 + c * x
    if (v <= 0) continue
    v = v * v * v
    const u = rng()
    if (u < 1 - 0.0331 * Math.pow(x, 4)) return scale * d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return scale * d * v
    }
  }
}

export function sampleDistribution(rng: RNG, spec: DistributionSpec) {
  if (spec.type === 'gamma') {
    const { shape, scale } = gammaParamsFromMeanP95(spec.mean, spec.p95)
    return sampleGamma(rng, shape, scale)
  }
  return sampleLognormal(rng, spec.mean, spec.p95)
}

export function histogram(values: number[], bins: number) {
  if (values.length === 0) return []
  const max = Math.max(...values)
  const min = Math.min(...values)
  const width = max === min ? 1 : (max - min) / bins
  const counts = new Array(bins).fill(0)
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor((v - min) / width))
    counts[idx] += 1
  }
  return counts.map((count, i) => {
    const start = min + i * width
    const end = start + width
    return {
      label: `${start.toFixed(1)}-${end.toFixed(1)}`,
      value: count
    }
  })
}

export function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[idx]
}

export function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}
