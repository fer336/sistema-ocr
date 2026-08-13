import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  CopyCheck,
  Loader2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import { STATUS_LABELS, STATUS_STYLES } from "../lib/status";
import { SOURCE_FILE_STATUS } from "../types";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_ICONS: Record<string, LucideIcon> = {
  [SOURCE_FILE_STATUS.UPLOADED]: Upload,
  [SOURCE_FILE_STATUS.PENDING]: Clock,
  [SOURCE_FILE_STATUS.PROCESSING]: Loader2,
  [SOURCE_FILE_STATUS.PROCESSED]: CheckCircle2,
  [SOURCE_FILE_STATUS.REQUIRES_REVIEW]: AlertTriangle,
  [SOURCE_FILE_STATUS.PARTIAL]: AlertTriangle,
  [SOURCE_FILE_STATUS.ERROR]: AlertTriangle,
  [SOURCE_FILE_STATUS.DUPLICATE]: CopyCheck,
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const Icon = STATUS_ICONS[status] ?? CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        STATUS_STYLES[status] ?? "bg-surface-raised text-ink-muted",
        className
      )}
    >
      <Icon className={cn("h-3 w-3", status === SOURCE_FILE_STATUS.PROCESSING && "animate-spin")} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
