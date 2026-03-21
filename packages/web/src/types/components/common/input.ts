import type {
  InputHTMLAttributes,
  RefAttributes,
  TextareaHTMLAttributes,
} from 'react'

// interface: extends native HTML attributes
export type TextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'style'
> &
  RefAttributes<HTMLInputElement>

// interface: extends native HTML attributes
export type TextAreaInputProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'className' | 'style'
> &
  RefAttributes<HTMLTextAreaElement>

export type SelectOption = {
  value: string
  label: string
}

export type SelectInputProps = {
  value?: string
  onValueChange?: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  id?: string
}

export type SwitchInputProps = {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  id?: string
}

export type ComboboxOption = {
  value: string
  label: string
  color?: string
}

export type ComboboxInputProps = {
  value: string[]
  onValueChange: (value: string[]) => void
  options: ComboboxOption[]
  placeholder?: string
  disabled?: boolean
  id?: string
  onCreateOption?: (name: string) => void | Promise<void>
  createLabel?: string
}
