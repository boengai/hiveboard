import type { IconProps } from '@/types'

export const DotIcon = ({ size = '1em' }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    role="presentation"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
  </svg>
)
