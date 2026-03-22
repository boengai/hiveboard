import type { TextInputProps } from '@/types'

export const TextInput = ({ onChange, ...rest }: TextInputProps) => (
  <input
    {...rest}
    autoComplete="off"
    className="w-full rounded-md border border-border-default bg-surface-inset px-3 py-2 text-body-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-honey-400 focus:shadow-glow-honey disabled:opacity-50"
    onChange={onChange ? (e) => onChange(e.target.value) : undefined}
  />
)
