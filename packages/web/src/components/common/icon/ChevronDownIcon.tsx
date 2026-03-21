import type { IconProps } from '@/types'

export const ChevronDownIcon = ({ size = '1em' }: IconProps) => (
  <svg
    aria-hidden="true"
    fill="none"
    height={size}
    role="presentation"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.5}
    viewBox="0 0 12 12"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M3 4.5L6 7.5L9 4.5" />
  </svg>
)
