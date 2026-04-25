import type { ButtonHTMLAttributes, RefAttributes } from 'react'

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style'
> &
  RefAttributes<HTMLButtonElement> & {
    size?: 'small' | 'default' | 'large' | 'icon'
    color?: 'default' | 'danger' | 'info' | 'primary' | 'success' | 'warning'
    variant?: 'ghost' | 'link' | 'link-muted' | 'secondary' | 'solid'
    block?: boolean
  }
