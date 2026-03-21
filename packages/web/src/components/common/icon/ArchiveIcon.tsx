import type { IconProps } from '@/types'

export const ArchiveIcon = ({ size = '1em' }: IconProps) => (
  <svg
    aria-hidden="true"
    fill="none"
    height={size}
    role="presentation"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect height="5" width="22" x="1" y="3" />
    <line x1="10" x2="14" y1="12" y2="12" />
  </svg>
)
