import type { TextAreaInputProps } from '@/types'

export const TextAreaInput = (props: TextAreaInputProps) => (
  <textarea
    className="w-full resize-y rounded-md border border-border-default bg-surface-inset px-3 py-2 text-body-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-honey-400 focus:shadow-glow-honey disabled:opacity-50"
    {...props}
  />
)
