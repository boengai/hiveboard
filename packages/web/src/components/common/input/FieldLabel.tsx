import type { FieldLabelProps } from '@/types'

export const FieldLabel = ({
  htmlFor,
  children,
  required,
}: FieldLabelProps) => (
  <label
    className="font-medium text-body-sm text-text-secondary"
    htmlFor={htmlFor}
  >
    {children}
    {required && <span className="ml-0.5 text-honey-400">*</span>}
  </label>
)
