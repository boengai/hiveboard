import type { ReactNode } from 'react'

export type BadgeProps = {
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
}
