import * as SelectPrimitive from '@radix-ui/react-select'
import { ChevronDownIcon } from '@/components/common/icon'
import type { SelectInputProps } from '@/types/components/common/input'

export const SelectInput = ({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
}: SelectInputProps) => (
  <SelectPrimitive.Root
    value={value}
    onValueChange={onValueChange}
    disabled={disabled}
  >
    <SelectPrimitive.Trigger className="inline-flex w-full items-center justify-between rounded-md border border-border-default bg-surface-inset px-3 py-2 text-body-sm text-text-primary outline-none transition-colors focus:border-honey-400 focus:shadow-glow-honey disabled:opacity-50 data-[placeholder]:text-text-tertiary">
      <SelectPrimitive.Value placeholder={placeholder ?? 'Select…'} />
      <SelectPrimitive.Icon className="ml-2 text-text-tertiary">
        <ChevronDownIcon />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>

    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className="z-50 overflow-hidden rounded-md border border-border-default bg-surface-overlay shadow-lg"
        position="popper"
        sideOffset={4}
      >
        <SelectPrimitive.Viewport>
          {options.map((opt) => (
            <SelectPrimitive.Item
              key={opt.value}
              value={opt.value}
              className="cursor-pointer px-3 py-2 text-body-sm text-text-primary outline-none data-[highlighted]:bg-surface-raised data-[highlighted]:text-text-primary"
            >
              <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
            </SelectPrimitive.Item>
          ))}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
)
