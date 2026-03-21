import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

// interface: extends native HTML attributes
export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'style'> {}

// interface: extends native HTML attributes
export interface TextAreaInputProps
  extends Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'className' | 'style'
  > {}

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
