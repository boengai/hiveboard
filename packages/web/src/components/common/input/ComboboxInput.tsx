import * as Popover from '@radix-ui/react-popover'
import { useEffect, useRef, useState } from 'react'
import { CheckIcon, PlusIcon, XMarkIcon } from '@/components/common/icon'
import type { ComboboxInputProps } from '@/types'

export const ComboboxInput = (props: ComboboxInputProps) => {
  const {
    options,
    placeholder,
    disabled,
    id,
    onCreateOption,
    createLabel = 'Create',
  } = props

  const isMulti = props.multiple === true

  // Normalise value to array internally for shared logic
  const valueArr: string[] = isMulti
    ? (props as Extract<ComboboxInputProps, { multiple: true }>).value
    : (props as Extract<ComboboxInputProps, { multiple?: false }>).value
      ? [(props as Extract<ComboboxInputProps, { multiple?: false }>).value]
      : []

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase()),
  )

  const showCreate =
    search.trim() !== '' &&
    !options.some(
      (opt) => opt.label.toLowerCase() === search.trim().toLowerCase(),
    ) &&
    onCreateOption

  // Reset highlighted index when search text changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on search change
  useEffect(() => {
    setHighlightedIndex(0)
  }, [search])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return
    const items = listRef.current.querySelectorAll('[data-combobox-item]')
    items[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  // For single mode: select text on open so typing replaces it; restore on close
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync display on open/close
  useEffect(() => {
    if (!isMulti) {
      if (open) {
        inputRef.current?.select()
      } else {
        const selected = options.find((opt) => opt.value === valueArr[0])
        setSearch(selected?.label ?? valueArr[0] ?? '')
      }
    }
  }, [open, isMulti])

  // For single mode: sync search when value changes from outside while closed
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync on external value change
  useEffect(() => {
    if (!isMulti && !open) {
      const selected = options.find((opt) => opt.value === valueArr[0])
      setSearch(selected?.label ?? valueArr[0] ?? '')
    }
  }, [valueArr[0], isMulti])

  const selectOption = (optionValue: string) => {
    if (isMulti) {
      const p = props as Extract<ComboboxInputProps, { multiple: true }>
      if (p.value.includes(optionValue)) {
        p.onValueChange(p.value.filter((v) => v !== optionValue))
      } else {
        p.onValueChange([...p.value, optionValue])
      }
      setSearch('')
      inputRef.current?.focus()
    } else {
      const p = props as Extract<ComboboxInputProps, { multiple?: false }>
      const opt = options.find((o) => o.value === optionValue)
      p.onValueChange(optionValue)
      setSearch(opt?.label ?? optionValue)
      setOpen(false)
    }
  }

  const removeOption = (optionValue: string) => {
    if (!isMulti) return
    const p = props as Extract<ComboboxInputProps, { multiple: true }>
    p.onValueChange(p.value.filter((v) => v !== optionValue))
    inputRef.current?.focus()
  }

  const handleCreate = async () => {
    if (!onCreateOption || !search.trim()) return
    await onCreateOption(search.trim())
    if (isMulti) {
      setSearch('')
    } else {
      setOpen(false)
    }
    inputRef.current?.focus()
  }

  const totalItems = filtered.length + (showCreate ? 1 : 0)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
      } else {
        setHighlightedIndex((i) => (i + 1) % totalItems)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((i) => (i - 1 + totalItems) % totalItems)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (showCreate && highlightedIndex === filtered.length) {
        handleCreate()
      } else if (filtered[highlightedIndex]) {
        selectOption(filtered[highlightedIndex].value)
      }
    } else if (
      e.key === 'Backspace' &&
      search === '' &&
      isMulti &&
      valueArr.length > 0
    ) {
      const p = props as Extract<ComboboxInputProps, { multiple: true }>
      p.onValueChange(p.value.slice(0, -1))
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const selectedOptions = valueArr
    .map((v) => options.find((opt) => opt.value === v))
    .filter(Boolean)

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Anchor asChild>
        <div
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex w-full flex-wrap items-center gap-1 rounded-md border border-border-default bg-surface-inset px-3 py-2 text-body-sm text-text-primary outline-none transition-colors focus-within:border-honey-400 focus-within:shadow-glow-honey disabled:opacity-50"
          onClick={() => {
            if (!disabled) {
              inputRef.current?.focus()
              if (!open) setOpen(true)
            }
          }}
          onKeyDown={handleKeyDown}
          role="combobox"
          tabIndex={0}
        >
          {isMulti &&
            selectedOptions.map(
              (opt) =>
                opt && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-body-xs"
                    key={opt.value}
                    style={
                      opt.color
                        ? {
                            backgroundColor: `${opt.color}20`,
                            color: opt.color,
                          }
                        : undefined
                    }
                  >
                    {opt.label}
                    <button
                      className="ml-0.5 inline-flex text-gray-500 hover:text-gray-300"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeOption(opt.value)
                      }}
                      type="button"
                    >
                      <XMarkIcon size={12} />
                    </button>
                  </span>
                ),
            )}
          <input
            autoComplete="off"
            className="min-w-[60px] flex-1 bg-transparent text-body-sm text-text-primary outline-none placeholder:text-text-tertiary"
            disabled={disabled}
            id={id}
            onChange={(e) => {
              setSearch(e.target.value)
              if (!open) setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={
              isMulti
                ? selectedOptions.length === 0
                  ? (placeholder ?? 'Select…')
                  : ''
                : !open && search
                  ? undefined
                  : (placeholder ?? 'Select…')
            }
            ref={inputRef}
            spellCheck={false}
            type="text"
            value={search}
          />
        </div>
      </Popover.Anchor>

      <Popover.Portal>
        <Popover.Content
          className="z-50 max-h-60 w-(--radix-popover-trigger-width) overflow-auto rounded-md border border-border-default bg-surface-overlay shadow-lg"
          onOpenAutoFocus={(e) => e.preventDefault()}
          sideOffset={4}
        >
          <div ref={listRef} role="listbox">
            {filtered.map((opt, index) => {
              const isSelected = valueArr.includes(opt.value)
              const isHighlighted = index === highlightedIndex
              return (
                <div
                  aria-selected={isSelected}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-body-sm text-text-primary outline-none data-highlighted:bg-surface-raised"
                  data-combobox-item
                  data-highlighted={isHighlighted || undefined}
                  key={opt.value}
                  onClick={() => selectOption(opt.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') selectOption(opt.value)
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  role="option"
                  tabIndex={0}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {isSelected && <CheckIcon size={14} />}
                  </span>
                  {opt.color && (
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: opt.color }}
                    />
                  )}
                  {opt.label}
                </div>
              )
            })}
            {showCreate && (
              <div
                aria-selected={false}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-body-sm text-honey-400 outline-none data-highlighted:bg-surface-raised"
                data-combobox-item
                data-highlighted={
                  highlightedIndex === filtered.length || undefined
                }
                onClick={handleCreate}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                }}
                onMouseEnter={() => setHighlightedIndex(filtered.length)}
                role="option"
                tabIndex={0}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <PlusIcon size={14} />
                </span>
                {createLabel} &ldquo;{search.trim()}&rdquo;
              </div>
            )}
            {filtered.length === 0 && !showCreate && (
              <div className="px-3 py-2 text-body-sm text-text-tertiary">
                No results
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
