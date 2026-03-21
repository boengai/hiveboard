import type { ReactNode } from 'react'

export type DrawerProps = {
  children: ReactNode
  title: string
  description?: string
  size?: 'default' | 'narrow' | 'wide'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode
}
