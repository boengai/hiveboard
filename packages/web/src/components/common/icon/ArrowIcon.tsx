import type { IconProps } from '@/types'

export const ArrowIcon = ({
  size = '1em',
  direction = 'left',
}: IconProps & { direction?: 'left' | 'right' }) => {
  switch (direction) {
    case 'right':
      return (
        <svg
          aria-hidden="true"
          aria-label="Arrow Right"
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
          <path d="M18 8L22 12L18 16" />
          <path d="M2 12H22" />
        </svg>
      )
    default:
      return (
        <svg
          aria-hidden="true"
          aria-label="Arrow Left"
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
          <path d="M6 8L2 12L6 16" />
          <path d="M2 12H22" />
        </svg>
      )
  }
}
