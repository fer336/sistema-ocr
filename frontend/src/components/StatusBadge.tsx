import { cn } from "../lib/cn";
import { REMITO_STATUS } from "../types";

const STATUS_STYLES: Record<string, string> = {
  [REMITO_STATUS.PROCESSED]: "bg-green-100 text-green-700",
  [REMITO_STATUS.REQUIRES_REVIEW]: "bg-amber-100 text-amber-700",
  [REMITO_STATUS.DUPLICATE]: "bg-rose-100 text-rose-600",
};

const STATUS_LABELS: Record<string, string> = {
  [REMITO_STATUS.PROCESSED]: "Procesado",
  [REMITO_STATUS.REQUIRES_REVIEW]: "Requiere revisión",
  [REMITO_STATUS.DUPLICATE]: "Posible duplicado",
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        STATUS_STYLES[status] ?? "bg-slate-200/80 text-slate-800"
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
