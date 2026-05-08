import type { ReactNode } from 'react'

export type DrawerProps = {
  children: ReactNode
  title: ReactNode
  description?: string
  size?: 'default' | 'narrow' | 'wide' | 'xl'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode
}
