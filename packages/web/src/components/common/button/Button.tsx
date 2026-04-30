import { m } from 'motion/react'
import type { ComponentProps } from 'react'
import type { ButtonProps } from '@/types'
import { tv } from '@/utils'

const buttonVariants = tv({
  base: 'inline-flex items-center justify-center border font-medium text-body-sm transition-colors',
  compoundVariants: [
    // solid × color — bordered + tinted bg + accent text (TUI style)
    {
      class:
        'border-border-default bg-surface-raised text-text-primary hover:border-border-hover',
      color: 'default',
      variant: 'solid',
    },
    {
      class:
        'border-honey-400 bg-honey-400/10 text-honey-300 hover:bg-honey-400/20 hover:shadow-glow-honey',
      color: 'primary',
      variant: 'solid',
    },
    {
      class:
        'border-error-500 bg-error-500/10 text-error-400 hover:bg-error-500/20',
      color: 'danger',
      variant: 'solid',
    },
    {
      class:
        'border-info-500 bg-info-500/10 text-info-400 hover:bg-info-500/20',
      color: 'info',
      variant: 'solid',
    },
    {
      class:
        'border-success-500 bg-success-500/10 text-success-400 hover:bg-success-500/20',
      color: 'success',
      variant: 'solid',
    },
    {
      class:
        'border-warning-500 bg-warning-500/10 text-warning-400 hover:bg-warning-500/20',
      color: 'warning',
      variant: 'solid',
    },
    // secondary × color — flatter, lower-emphasis variant of solid
    {
      class:
        'border-border-default bg-transparent text-text-secondary hover:border-border-hover hover:text-text-primary',
      color: 'default',
      variant: 'secondary',
    },
    {
      class:
        'border-honey-400/40 bg-transparent text-honey-300 hover:border-honey-400 hover:bg-honey-400/10',
      color: 'primary',
      variant: 'secondary',
    },
    {
      class:
        'border-error-500/40 bg-transparent text-error-400 hover:border-error-500 hover:bg-error-500/10',
      color: 'danger',
      variant: 'secondary',
    },
    {
      class:
        'border-info-500/40 bg-transparent text-info-400 hover:border-info-500 hover:bg-info-500/10',
      color: 'info',
      variant: 'secondary',
    },
    {
      class:
        'border-success-500/40 bg-transparent text-success-400 hover:border-success-500 hover:bg-success-500/10',
      color: 'success',
      variant: 'secondary',
    },
    {
      class:
        'border-warning-500/40 bg-transparent text-warning-400 hover:border-warning-500 hover:bg-warning-500/10',
      color: 'warning',
      variant: 'secondary',
    },
    // ghost × color — borderless until hover
    {
      class:
        'border-transparent bg-transparent text-text-secondary hover:border-border-default hover:text-text-primary',
      color: 'default',
      variant: 'ghost',
    },
    {
      class:
        'border-transparent bg-transparent text-honey-300 hover:border-honey-400 hover:bg-honey-400/10',
      color: 'primary',
      variant: 'ghost',
    },
    {
      class:
        'border-transparent bg-transparent text-error-400 hover:border-error-500 hover:bg-error-500/10',
      color: 'danger',
      variant: 'ghost',
    },
    // link variants — drop button chrome entirely
    {
      class: 'border-transparent text-text-secondary hover:text-text-primary',
      color: 'default',
      variant: 'link',
    },
    {
      class: 'border-transparent text-honey-400 hover:text-honey-300',
      color: 'primary',
      variant: 'link',
    },
    {
      class: 'border-transparent text-error-400',
      color: 'danger',
      variant: 'link',
    },
    {
      class: 'border-transparent text-text-tertiary hover:text-text-primary',
      color: 'default',
      variant: 'link-muted',
    },
    {
      class: 'border-transparent text-text-tertiary hover:text-honey-300',
      color: 'primary',
      variant: 'link-muted',
    },
    {
      class: 'border-transparent text-text-tertiary hover:text-error-400',
      color: 'danger',
      variant: 'link-muted',
    },
    {
      class: 'h-auto bg-transparent px-0',
      variant: ['link', 'link-muted'],
    },
    {
      class: 'text-body-xs',
      size: 'small',
      variant: ['link', 'link-muted'],
    },
  ],
  defaultVariants: { color: 'default', size: 'default', variant: 'solid' },
  variants: {
    block: { true: 'w-full' },
    color: {
      danger: '',
      default: '',
      info: '',
      primary: '',
      success: '',
      warning: '',
    },
    size: {
      default: 'h-8 px-3',
      icon: 'h-7 w-7 p-0',
      large: 'h-10 px-4',
      small: 'h-7 px-2.5',
    },
    variant: {
      ghost: '',
      link: 'underline-offset-2 hover:underline',
      'link-muted': '',
      secondary: '',
      solid: '',
    },
  },
})

export const Button = ({
  size,
  color,
  variant,
  block,
  ...props
}: ButtonProps) => (
  <m.button
    className={buttonVariants({ block, color, size, variant })}
    whileHover={{ y: -1 }}
    whileTap={{ scale: 0.98 }}
    {...(props as ComponentProps<typeof m.button>)}
  />
)
