import type { IconProps } from '@/types'

export const PlayIcon = ({ size = '1em' }: IconProps) => (
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
    <polygon points="6,3 20,12 6,21" />
  </svg>
)
