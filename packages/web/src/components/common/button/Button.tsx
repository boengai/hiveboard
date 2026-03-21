import { m } from 'motion/react'
import type { ComponentProps } from 'react'
import type { ButtonProps } from '@/types/components/common/button'
import { tv } from '@/utils/tailwind-variants'

const buttonVariants = tv({
  base: 'inline-flex items-center justify-center rounded-md font-medium transition-colors text-body-sm',
  variants: {
    size: {
      small: 'h-7 px-2.5',
      default: 'h-8 px-3',
      large: 'h-10 px-4',
    },
    color: {
      default: 'bg-gray-800 text-gray-100 hover:bg-gray-700',
      primary: 'bg-honey-400 text-text-on-accent hover:bg-honey-500',
      danger: 'bg-error-400/15 text-error-400 hover:bg-error-400/25',
      ghost: 'text-text-secondary hover:bg-gray-800 hover:text-text-primary',
    },
    block: { true: 'w-full' },
  },
  defaultVariants: { size: 'default', color: 'default' },
})

export const Button = ({ size, color, block, ...props }: ButtonProps) => (
  <m.button
    className={buttonVariants({ size, color, block })}
    whileHover={{ y: -1 }}
    whileTap={{ scale: 0.98 }}
    {...(props as ComponentProps<typeof m.button>)}
  />
)
