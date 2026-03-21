import type { IconProps } from "@/types/components/common/icon";

export const BoltIcon = ({ size = "1em" }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" role="presentation" aria-hidden="true">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10" />
  </svg>
);
