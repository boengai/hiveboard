import * as SelectPrimitive from '@radix-ui/react-select'
import { ChevronDownIcon } from '@/components/common/icon'
import type { SelectInputProps, SelectOption } from '@/types'

const itemClass =
  'cursor-pointer px-3 py-2 text-body-sm text-text-primary outline-none data-highlighted:bg-surface-raised data-highlighted:text-text-primary'

const renderItem = (opt: SelectOption) => (
  <SelectPrimitive.Item className={itemClass} key={opt.value} value={opt.value}>
    <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
)

export const SelectInput = ({
  value,
  onValueChange,
  options,
  groups,
  placeholder,
  disabled,
}: SelectInputProps) => (
  <SelectPrimitive.Root
    disabled={disabled}
    onValueChange={onValueChange}
    value={value}
  >
    <SelectPrimitive.Trigger className="inline-flex w-full items-center justify-between rounded-md border border-border-default bg-surface-inset px-3 py-2 text-body-sm text-text-primary outline-none transition-colors focus:border-honey-400 focus:shadow-glow-honey disabled:opacity-50 data-placeholder:text-text-tertiary">
      <SelectPrimitive.Value placeholder={placeholder ?? 'Select…'} />
      <SelectPrimitive.Icon className="ml-2 text-text-tertiary">
        <ChevronDownIcon />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>

    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className="z-50 w-(--radix-select-trigger-width) overflow-hidden rounded-md border border-border-default bg-surface-overlay shadow-lg"
        position="popper"
        sideOffset={4}
      >
        <SelectPrimitive.Viewport>
          {groups
            ? groups.map((group, idx) => (
                <SelectPrimitive.Group key={group.label}>
                  <SelectPrimitive.Label className="px-3 pt-2 pb-1 font-medium text-text-tertiary text-xs uppercase tracking-wide">
                    {group.label}
                  </SelectPrimitive.Label>
                  {group.options.map(renderItem)}
                  {idx < groups.length - 1 ? (
                    <SelectPrimitive.Separator className="my-1 h-px bg-border-default/60" />
                  ) : null}
                </SelectPrimitive.Group>
              ))
            : (options ?? []).map(renderItem)}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
)
