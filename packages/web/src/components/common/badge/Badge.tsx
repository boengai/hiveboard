import type { BadgeProps } from '@/types'
import { tv } from '@/utils'

const badgeVariants = tv({
  base: 'inline-flex items-center border px-1.5 font-medium uppercase tracking-wider text-body-xs',
  defaultVariants: { color: 'default' },
  variants: {
    color: {
      default: 'border-border-default bg-surface-raised text-text-secondary',
      error: 'border-error-500 bg-error-500/10 text-error-400',
      honey: 'border-honey-400 bg-honey-400/10 text-honey-300',
      info: 'border-info-500 bg-info-500/10 text-info-400',
      purple: 'border-purple-500 bg-purple-500/10 text-purple-400',
      success: 'border-success-500 bg-success-500/10 text-success-400',
      teal: 'border-teal-500 bg-teal-500/10 text-teal-400',
      warning: 'border-warning-500 bg-warning-500/10 text-warning-400',
    },
  },
})

export const Badge = ({ children, color }: BadgeProps) => (
  <span className={badgeVariants({ color })}>
    <span aria-hidden className="opacity-60">[</span>
    <span className="px-1">{children}</span>
    <span aria-hidden className="opacity-60">]</span>
  </span>
)
