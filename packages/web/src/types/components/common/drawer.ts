import type { ReactNode } from "react";

export interface DrawerProps {
  children: ReactNode;
  title: string;
  description?: string;
  size?: "default" | "narrow" | "wide";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
}
