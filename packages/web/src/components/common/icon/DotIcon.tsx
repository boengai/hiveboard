import type { IconProps } from '@/types'

export const DotIcon = ({ size = '1em' }: IconProps) => (
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
    <circle cx="12" cy="12" r="3" />
  </svg>
)
