import { m } from 'motion/react'
import { Drawer as VaulDrawer } from 'vaul'
import type { DrawerProps } from '@/types'
import { tv } from '@/utils'

const overlayVariants = tv({
  base: 'fixed inset-0 z-40 bg-black/40 backdrop-blur-xs',
})

const contentVariants = tv({
  base: [
    'fixed z-50 flex h-full flex-col border-border-default border-l bg-surface-raised outline-none',
    'data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0',
  ],
  defaultVariants: { size: 'default' },
  variants: {
    size: {
      default: 'w-[480px] max-w-[90vw]',
      narrow: 'w-[360px] max-w-[85vw]',
      wide: 'w-[640px] max-w-[95vw]',
    },
  },
})

export const Drawer = ({
  children,
  title,
  description,
  size = 'default',
  open,
  onOpenChange,
  trigger,
}: DrawerProps) => (
  <VaulDrawer.Root direction="right" onOpenChange={onOpenChange} open={open}>
    {trigger && <VaulDrawer.Trigger asChild>{trigger}</VaulDrawer.Trigger>}
    <VaulDrawer.Portal>
      <VaulDrawer.Overlay className={overlayVariants()} />
      <VaulDrawer.Content className={contentVariants({ size })}>
        <div className="flex w-full shrink-0 items-center gap-3 border-border-default border-b bg-surface-overlay/50 px-5 py-3.5">
          <VaulDrawer.Close asChild>
            <m.button
              className="size-3 shrink-0 rounded-full bg-error-400"
              whileHover={{ opacity: 0.8, scale: 1.15 }}
              whileTap={{ scale: 0.9 }}
            >
              <span className="sr-only">Close</span>
            </m.button>
          </VaulDrawer.Close>
          <VaulDrawer.Title className="grow truncate font-medium text-body-sm text-text-secondary">
            {title}
          </VaulDrawer.Title>
          <VaulDrawer.Description className="hidden">
            {description ?? title}
          </VaulDrawer.Description>
        </div>
        <div
          className="flex size-full grow flex-col gap-5 overflow-y-auto p-5"
          data-vaul-no-drag
        >
          {children}
        </div>
      </VaulDrawer.Content>
    </VaulDrawer.Portal>
  </VaulDrawer.Root>
)
