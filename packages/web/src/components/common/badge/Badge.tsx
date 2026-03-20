import { tv } from '@/utils/tailwind-variants'

const badgeVariants = tv({
  base: 'inline-flex items-center rounded-full px-2 py-0.5 text-body-xs font-medium',
  variants: {
    color: {
      default: 'bg-gray-800 text-gray-300',
      info: 'bg-info-400/15 text-info-400',
      purple: 'bg-purple-400/15 text-purple-400',
      success: 'bg-success-400/15 text-success-400',
      teal: 'bg-teal-400/15 text-teal-400',
      warning: 'bg-warning-400/15 text-warning-400',
      error: 'bg-error-400/15 text-error-400',
      honey: 'bg-honey-400/15 text-honey-400',
    },
  },
  defaultVariants: { color: 'default' },
})

interface BadgeProps {
  children: React.ReactNode
  color?: 'default' | 'info' | 'purple' | 'success' | 'teal' | 'warning' | 'error' | 'honey'
  className?: string
}

export const Badge = ({ children, color, className }: BadgeProps) => (
  <span className={badgeVariants({ color, className })}>{children}</span>
)
