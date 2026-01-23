import React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { SimulationResults } from '../sim/types'

interface Props {
  results: SimulationResults | null
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function formatSeconds(value: number) {
  return `${value.toFixed(2)}s`
}

export function ResultsPanel({ results }: Props) {
  if (!results) {
    return (
      <div className="results-empty">
        <h2>Run the simulation</h2>
        <p>Set parameters, choose a mode, then click “Run simulation”.</p>
      </div>
    )
  }

  const { metrics, timeSeries } = results

  return (
    <div className="results">
      <section className="kpi-grid">
        <div className="kpi-card">
          <h3>Authorization</h3>
          <p>Approval rate: {formatPercent(metrics.approvalRate)}</p>
          <p>Decline rate: {formatPercent(metrics.declineRate)}</p>
          <p>Timeout rate: {formatPercent(metrics.timeoutRate)}</p>
          <p>Auth time avg: {formatSeconds(metrics.avgAuthTimeSec)}</p>
          <p>Auth time p95: {formatSeconds(metrics.p95AuthTimeSec)}</p>
          <p>Total spent: {metrics.totalSpent.toFixed(2)}</p>
          <p>Skipped (insufficient funds): {metrics.insufficientFundsSkipped}</p>
        </div>
        <div className="kpi-card">
          <h3>Settlement</h3>
          <p>Success rate: {formatPercent(metrics.settlementSuccessRate)}</p>
          <p>Fail rate: {formatPercent(metrics.settlementFailRate)}</p>
          <p>Confirm avg: {formatSeconds(metrics.avgSettlementTimeSec)}</p>
          <p>Confirm p95: {formatSeconds(metrics.p95SettlementTimeSec)}</p>
          <p>Retry p95: {metrics.retryP95.toFixed(1)}</p>
        </div>
        <div className="kpi-card">
          <h3>Exposure</h3>
          <p>Exposure events: {metrics.exposureCount}</p>
          <p>Total exposure: {metrics.totalExposure.toFixed(2)}</p>
          <p>Peak exposure: {metrics.peakExposure.toFixed(2)}</p>
          <p>P95 exposure: {metrics.p95Exposure.toFixed(2)}</p>
          <p>P95 exposure duration: {formatSeconds(metrics.exposureDurationP95Sec)}</p>
        </div>
        <div className="kpi-card">
          <h3>Holds & Pre-auth</h3>
          <p>Overspend prevented: {metrics.overspendPrevented}</p>
          <p>Avg pending holds: {metrics.avgPendingHolds.toFixed(2)}</p>
          <p>P95 pending holds: {metrics.p95PendingHolds.toFixed(2)}</p>
          <p>Pre-auth mismatch: {formatPercent(metrics.preAuthMismatchRate)}</p>
          <p>Incremental auth success: {formatPercent(metrics.incrementalAuthSuccessRate)}</p>
        </div>
        <div className="kpi-card">
          <h3>Fraud</h3>
          <p>Attempt rate: {formatPercent(metrics.fraudAttemptRate)}</p>
          <p>Approval rate: {formatPercent(metrics.fraudApprovalRate)}</p>
          <p>Fraud exposure: {metrics.fraudExposureTotal.toFixed(2)}</p>
          <p>Fraud loss: {metrics.fraudLossTotal.toFixed(2)}</p>
          <p>Limit declines: {metrics.limitDeclines}</p>
          <p>Approval rate (no limits): {formatPercent(metrics.fraudApprovalRateNoLimits)}</p>
          <p>Exposure (no limits): {metrics.fraudExposureTotalNoLimits.toFixed(2)}</p>
          <p>Loss (no limits): {metrics.fraudLossTotalNoLimits.toFixed(2)}</p>
        </div>
      </section>

      <section className="chart-grid">
        <div className="chart-card">
          <h3>Exposure + Auth Outcomes Over Time</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={timeSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timeSec" tickFormatter={(v) => `${(v / 3600).toFixed(1)}h`} />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Line yAxisId="left" type="monotone" dataKey="exposure" stroke="#f97316" />
              <Line yAxisId="right" type="monotone" dataKey="approvals" stroke="#10b981" />
              <Line yAxisId="right" type="monotone" dataKey="declines" stroke="#ef4444" />
              <Line yAxisId="right" type="monotone" dataKey="timeouts" stroke="#a855f7" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card">
          <h3>Settlement Time Percentiles</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={results.settlementPercentiles}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#38bdf8" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card">
          <h3>Auth Time Percentiles</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={results.authPercentiles}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#34d399" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card">
          <h3>Exposure Amount Percentiles</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={results.exposurePercentiles}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#fb7185" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card">
          <h3>Exposure per User</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={results.exposurePerUserHistogram}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" hide />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#facc15" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="scenario">
        <h3>Scenario Summary</h3>
        <p>{results.scenarioSummary}</p>
      </section>
    </div>
  )
}
