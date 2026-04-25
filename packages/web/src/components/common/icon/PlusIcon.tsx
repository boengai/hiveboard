import type { IconProps } from '@/types'

export const PlusIcon = ({ size = '1em' }: IconProps) => (
  <svg
    aria-hidden="true"
    aria-label="Plus"
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </svg>
)
