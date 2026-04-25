import type {
  InputHTMLAttributes,
  ReactNode,
  RefAttributes,
  TextareaHTMLAttributes,
} from 'react'

export type FieldLabelProps = {
  htmlFor?: string
  children: ReactNode
  required?: boolean
}

export type FieldErrorProps = {
  errors: Array<string | { message: string } | undefined>
}

// interface: extends native HTML attributes
export type TextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'autoComplete' | 'className' | 'onChange' | 'spellCheck' | 'style'
> &
  RefAttributes<HTMLInputElement> & {
    onChange?: (value: string) => void
  }

// interface: extends native HTML attributes
export type TextAreaInputProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'autoComplete' | 'className' | 'onChange' | 'spellCheck' | 'style'
> &
  RefAttributes<HTMLTextAreaElement> & {
    onChange?: (value: string) => void
  }

export type SelectOption = {
  value: string
  label: string
}

export type SelectOptionGroup = {
  label: string
  options: SelectOption[]
}

export type SelectInputProps = {
  value?: string
  onValueChange?: (value: string) => void
  /** Flat list of options. Ignored when `groups` is provided. */
  options?: SelectOption[]
  /** Grouped options rendered as labelled sections. Takes precedence over `options`. */
  groups?: SelectOptionGroup[]
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

type ComboboxInputBaseProps = {
  options: ComboboxOption[]
  placeholder?: string
  disabled?: boolean
  id?: string
  onCreateOption?: (name: string) => void | Promise<void>
  createLabel?: string
}

export type ComboboxInputProps = ComboboxInputBaseProps &
  (
    | {
        multiple: true
        value: string[]
        onValueChange: (value: string[]) => void
      }
    | {
        multiple?: false
        value: string
        onValueChange: (value: string) => void
      }
  )
