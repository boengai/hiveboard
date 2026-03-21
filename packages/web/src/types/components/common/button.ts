import type { ButtonHTMLAttributes } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'small' | 'default' | 'large'
  color?: 'default' | 'primary' | 'danger' | 'ghost'
  block?: boolean
}
