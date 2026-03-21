import type { IconProps } from "@/types/components/common/icon";

export const PlayIcon = ({ size = "1em" }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" role="presentation" aria-hidden="true">
    <polygon points="6,3 20,12 6,21" />
  </svg>
);
