import type { IconProps } from '@/types'

export const PlusIcon = ({ size = '1em' }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="presentation"
    aria-hidden="true"
  >
    <path d="M12 4v16m8-8H4" />
  </svg>
)
