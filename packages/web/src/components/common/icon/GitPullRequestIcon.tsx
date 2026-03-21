import type { IconProps } from '@/types'

export const GitPullRequestIcon = ({ size = '1em' }: IconProps) => (
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
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 012 2v7" />
    <path d="M6 9v12" />
  </svg>
)
