import type { IconProps } from '@/types'

export const DotIcon = ({ size = '1em' }: IconProps) => (
  <svg
    aria-hidden="true"
    aria-label="Dot"
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
    <circle cx="12.1" cy="12.1" r="1" />
  </svg>
)
