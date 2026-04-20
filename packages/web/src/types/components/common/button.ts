import type { ButtonHTMLAttributes, RefAttributes } from 'react'

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style'
> &
  RefAttributes<HTMLButtonElement> & {
    size?: 'small' | 'default' | 'large' | 'icon'
    color?: 'default' | 'primary' | 'danger'
    variant?: 'solid' | 'ghost' | 'link' | 'link-muted'
    block?: boolean
  }
