import type { FieldErrorProps } from '@/types'

export const FieldError = ({ errors }: FieldErrorProps) => {
  const first = errors.find((e) => e != null)
  if (!first) return null
  const msg = typeof first === 'string' ? first : first.message
  return <span className="text-body-xs text-error-400">{msg}</span>
}
