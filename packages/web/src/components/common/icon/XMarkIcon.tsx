import type { IconProps } from '@/types'

export const XMarkIcon = ({ size = '1em' }: IconProps) => (
  <svg
    aria-hidden="true"
    fill="none"
    height={size}
    role="presentation"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2.5}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M6 18L18 6M6 6l12 12" />
  </svg>
)
