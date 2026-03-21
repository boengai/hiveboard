import { m } from 'motion/react'
import type { ComponentProps } from 'react'
import type { ButtonProps } from '@/types'
import { tv } from '@/utils'

const buttonVariants = tv({
  base: 'inline-flex items-center justify-center rounded-md font-medium text-body-sm transition-colors',
  defaultVariants: { color: 'default', size: 'default' },
  variants: {
    block: { true: 'w-full' },
    color: {
      danger: 'bg-error-400/15 text-error-400 hover:bg-error-400/25',
      default: 'bg-gray-800 text-gray-100 hover:bg-gray-700',
      ghost: 'text-text-secondary hover:bg-gray-800 hover:text-text-primary',
      primary: 'bg-honey-400 text-text-on-accent hover:bg-honey-500',
    },
    size: {
      default: 'h-8 px-3',
      large: 'h-10 px-4',
      small: 'h-7 px-2.5',
    },
  },
})

export const Button = ({ size, color, block, ...props }: ButtonProps) => (
  <m.button
    className={buttonVariants({ block, color, size })}
    whileHover={{ y: -1 }}
    whileTap={{ scale: 0.98 }}
    {...(props as ComponentProps<typeof m.button>)}
  />
)
