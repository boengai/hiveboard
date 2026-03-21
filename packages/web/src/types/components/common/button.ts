import type { ButtonHTMLAttributes, RefAttributes } from 'react'

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style'
> &
  RefAttributes<HTMLButtonElement> & {
    size?: 'small' | 'default' | 'large'
    color?: 'default' | 'primary' | 'danger' | 'ghost'
    block?: boolean
  }
