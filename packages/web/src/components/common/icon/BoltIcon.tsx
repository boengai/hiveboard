import type { IconProps } from '@/types'

export const BoltIcon = ({ size = '1em' }: IconProps) => (
  <svg
    aria-hidden="true"
    fill="currentColor"
    height={size}
    role="presentation"
    stroke="none"
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10" />
  </svg>
)
