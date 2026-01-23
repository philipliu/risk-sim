import React from 'react'
import { DistributionSpec, DistributionType } from '../sim/types'

interface Props {
  label: string
  value: DistributionSpec
  onChange: (value: DistributionSpec) => void
  tooltip?: string
}

export function DistributionControl({ label, value, onChange, tooltip }: Props) {
  const update = (patch: Partial<DistributionSpec>) => {
    onChange({ ...value, ...patch })
  }

  return (
    <div className="distribution" title={tooltip}>
      <div className="control-header">
        <label title={tooltip}>{label}</label>
      </div>
      <div className="distribution-grid">
        <select
          value={value.type}
          title={tooltip}
          onChange={(e) => update({ type: e.target.value as DistributionType })}
        >
          <option value="lognormal">Lognormal</option>
          <option value="gamma">Gamma</option>
        </select>
        <input
          type="number"
          value={value.mean}
          min={0}
          step={1}
          title={tooltip}
          onChange={(e) => update({ mean: Number(e.target.value) })}
        />
        <input
          type="number"
          value={value.p95}
          min={0}
          step={1}
          title={tooltip}
          onChange={(e) => update({ p95: Number(e.target.value) })}
        />
      </div>
      <div className="distribution-labels">
        <span>Type</span>
        <span>Mean</span>
        <span>P95</span>
      </div>
    </div>
  )
}
