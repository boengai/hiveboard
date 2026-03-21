import type { IconProps } from '@/types/components/common/icon'

export const CheckIcon = ({ size = '1em' }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="presentation"
    aria-hidden="true"
  >
    <path d="M5 13l4 4L19 7" />
  </svg>
)
