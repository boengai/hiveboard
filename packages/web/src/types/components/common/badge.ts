import type { ReactNode } from 'react'

export interface BadgeProps {
  children: ReactNode
  color?:
    | 'default'
    | 'info'
    | 'purple'
    | 'success'
    | 'teal'
    | 'warning'
    | 'error'
    | 'honey'
  className?: string
}
