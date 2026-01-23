import React from 'react'

interface SliderInputProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  tooltip?: string
  onChange: (value: number) => void
}

export function SliderInput({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  tooltip,
  onChange
}: SliderInputProps) {
  return (
    <div className="control" title={tooltip}>
      <div className="control-header">
        <label title={tooltip}>{label}</label>
        <span className="control-value">
          {value} {unit}
        </span>
      </div>
      <div className="control-inputs">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          title={tooltip}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          title={tooltip}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  )
}

interface ToggleProps {
  label: string
  checked: boolean
  tooltip?: string
  onChange: (value: boolean) => void
}

export function Toggle({ label, checked, tooltip, onChange }: ToggleProps) {
  return (
    <label className="toggle" title={tooltip}>
      <input type="checkbox" checked={checked} title={tooltip} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

interface SelectProps {
  label: string
  value: string
  options: { value: string; label: string }[]
  tooltip?: string
  onChange: (value: string) => void
}

export function SelectInput({ label, value, options, tooltip, onChange }: SelectProps) {
  return (
    <div className="control" title={tooltip}>
      <div className="control-header">
        <label title={tooltip}>{label}</label>
      </div>
      <select value={value} title={tooltip} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
