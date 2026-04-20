import { m } from 'motion/react'
import type { ComponentProps } from 'react'
import type { ButtonProps } from '@/types'
import { tv } from '@/utils'

const buttonVariants = tv({
  base: 'inline-flex items-center justify-center rounded-md font-medium text-body-sm transition-colors',
  compoundVariants: [
    // solid × color
    {
      class: 'bg-gray-800 text-gray-100 hover:bg-gray-700',
      color: 'default',
      variant: 'solid',
    },
    {
      class: 'bg-honey-400 text-text-on-accent hover:bg-honey-500',
      color: 'primary',
      variant: 'solid',
    },
    {
      class: 'bg-error-400/15 text-error-400 hover:bg-error-400/25',
      color: 'danger',
      variant: 'solid',
    },
    // ghost × color
    {
      class:
        'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
      color: 'default',
      variant: 'ghost',
    },
    {
      class: 'text-honey-400 hover:bg-honey-400/10',
      color: 'primary',
      variant: 'ghost',
    },
    {
      class: 'text-error-400 hover:bg-error-400/10',
      color: 'danger',
      variant: 'ghost',
    },
    // link × color (colored text, underline on hover)
    {
      class: 'text-text-secondary hover:text-text-primary',
      color: 'default',
      variant: 'link',
    },
    { class: 'text-honey-600', color: 'primary', variant: 'link' },
    { class: 'text-error-400', color: 'danger', variant: 'link' },
    // link-muted × color (tertiary text, shifts toward color on hover)
    {
      class: 'text-text-tertiary hover:text-text-primary',
      color: 'default',
      variant: 'link-muted',
    },
    {
      class: 'text-text-tertiary hover:text-honey-400',
      color: 'primary',
      variant: 'link-muted',
    },
    {
      class: 'text-text-tertiary hover:text-error-400',
      color: 'danger',
      variant: 'link-muted',
    },
    // link variants drop button-shape padding/bg
    {
      class: 'h-auto bg-transparent px-0',
      variant: ['link', 'link-muted'],
    },
    // link variants scale text size with size prop
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
      primary: '',
    },
    size: {
      default: 'h-8 px-3',
      icon: 'h-7 w-7 p-0',
      large: 'h-10 px-4',
      small: 'h-7 px-2.5',
    },
    variant: {
      ghost: '',
      link: 'rounded-none underline-offset-2 hover:underline',
      'link-muted': 'rounded-none',
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
