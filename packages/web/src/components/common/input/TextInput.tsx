import type { TextInputProps } from '@/types/components/common/input'

export const TextInput = (props: TextInputProps) => (
  <input
    className="w-full rounded-md border border-border-default bg-surface-inset px-3 py-2 text-body-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-honey-400 focus:shadow-glow-honey disabled:opacity-50"
    {...props}
  />
)
