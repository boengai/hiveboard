import type { IconProps } from '@/types'

export const ArchiveIcon = ({ size = '1em' }: IconProps) => (
  <svg
    aria-hidden="true"
    aria-label="Archive"
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
    <rect height="5" rx="1" width="20" x="2" y="3" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </svg>
)
