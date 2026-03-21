import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { SwitchInputProps } from '@/types'

export const SwitchInput = ({
  checked,
  onCheckedChange,
  disabled,
  id,
}: SwitchInputProps) => (
  <SwitchPrimitive.Root
    checked={checked}
    className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border-default bg-surface-inset transition-colors focus-visible:shadow-glow-honey focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-honey-400 data-[state=checked]:bg-honey-400"
    disabled={disabled}
    id={id}
    onCheckedChange={onCheckedChange}
  >
    <SwitchPrimitive.Thumb className="block h-3.5 w-3.5 rounded-full bg-text-primary shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
  </SwitchPrimitive.Root>
)
