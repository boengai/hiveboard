import type { ButtonHTMLAttributes } from 'react'

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style'
> & {
  size?: 'small' | 'default' | 'large'
  color?: 'default' | 'primary' | 'danger' | 'ghost'
  block?: boolean
}
