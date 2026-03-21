import type { IconProps } from '@/types'

export const ChevronDownIcon = ({ size = '1em' }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="presentation"
    aria-hidden="true"
  >
    <path d="M3 4.5L6 7.5L9 4.5" />
  </svg>
)
