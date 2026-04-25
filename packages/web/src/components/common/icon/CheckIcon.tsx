import type { IconProps } from '@/types'

export const CheckIcon = ({ size = '1em' }: IconProps) => (
  <svg
    aria-hidden="true"
    aria-label="Check"
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
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
