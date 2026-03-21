import type { ButtonHTMLAttributes } from 'react'

// interface: extends native HTML attributes
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'small' | 'default' | 'large'
  color?: 'default' | 'primary' | 'danger' | 'ghost'
  block?: boolean
}
