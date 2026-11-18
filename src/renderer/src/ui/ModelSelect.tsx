import type { JSX } from 'react'
import type { ModelOption } from '../../../shared/types'

interface ModelSelectProps {
  label: string
  value: string
  /** Models from the API key; null while loading or when the list could not be fetched. */
  options: ModelOption[] | null
  loading: boolean
  onChange(value: string): void
}

/** Dropdown of the account's models; falls back to a text field when the list is unavailable. */
export function ModelSelect({
  label,
  value,
  options,
  loading,
  onChange
}: ModelSelectProps): JSX.Element {
  if (!options && !loading) {
    return (
      <label className="sub-field">
        <span>{label}</span>
        <input
          className="input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    )
  }

  const list = options ?? []
  const current = list.find((m) => m.id === value)
  return (
    <label className="sub-field">
      <span>{label}</span>
      <select
        className="input"
        value={value}
        disabled={loading}
        onChange={(e) => onChange(e.target.value)}
      >
        {!current && (
          <option value={value}>
            {loading || !value ? value : `${value} (not available for this key)`}
          </option>
        )}
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
          </option>
        ))}
      </select>
      {current?.shutdownDate && (
        <span className="note note--warn">
          OpenAI will retire this model on {current.shutdownDate}.
        </span>
      )}
    </label>
  )
}
