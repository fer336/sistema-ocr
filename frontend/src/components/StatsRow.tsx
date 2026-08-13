import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  FileStack,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "../lib/cn";
import { REMITO_STATUS, SOURCE_FILE_STATUS, type RemitoStats } from "../types";

interface StatsRowProps {
  stats: RemitoStats;
}

type Accent = "primary" | "success" | "warning" | "info" | "error";

/** Clases del badge de ícono por acento -- mismo patrón que los "-soft" de
 * `StatusBadge`, así los colores quedan consistentes en toda la app. */
const ACCENT_CLASSES: Record<Accent, string> = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
  error: "bg-error-soft text-error",
};

/**
 * Contadores del Dashboard (PRD §18 pantalla 1).
 *
 * `pendientes` y `errores` sólo existen a nivel `source_files`: un remito
 * nunca está "pendiente", el pendiente es el archivo que todavía no pasó por
 * OCR. Por eso se leen de `source_files_by_status`.
 */
export function StatsRow({ stats }: StatsRowProps) {
  const notes = stats.remitos_by_status ?? {};
  const files = stats.source_files_by_status ?? {};

  const pendingFiles =
    (files[SOURCE_FILE_STATUS.UPLOADED] ?? 0) +
    (files[SOURCE_FILE_STATUS.PENDING] ?? 0) +
    (files[SOURCE_FILE_STATUS.PROCESSING] ?? 0);

  const tiles: {
    label: string;
    value: number;
    hint?: string;
    to?: string;
    icon: LucideIcon;
    accent: Accent;
  }[] = [
    { label: "Total de remitos", value: stats.total ?? 0, icon: FileStack, accent: "primary" },
    {
      label: "Procesados",
      value: notes[REMITO_STATUS.PROCESSED] ?? 0,
      icon: CheckCircle2,
      accent: "success",
    },
    {
      label: "Pendientes",
      value: pendingFiles,
      hint: "archivos en cola",
      icon: Clock,
      accent: "warning",
    },
    {
      label: "En revisión",
      value: notes[REMITO_STATUS.REQUIRES_REVIEW] ?? 0,
      icon: Eye,
      accent: "info",
    },
    {
      label: "Parciales",
      value: notes[REMITO_STATUS.PARTIAL] ?? 0,
      icon: AlertCircle,
      accent: "warning",
    },
    {
      label: "Errores",
      value: files[SOURCE_FILE_STATUS.ERROR] ?? 0,
      hint: "archivos",
      to: "/errores",
      icon: AlertTriangle,
      accent: "error",
    },
    {
      label: "Duplicados",
      value: (notes[REMITO_STATUS.DUPLICATE] ?? 0) + (files[SOURCE_FILE_STATUS.DUPLICATE] ?? 0),
      hint: "remitos + archivos",
      icon: Copy,
      accent: "info",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
      {tiles.map((tile) => {
        const content = (
          <>
            <span
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-lg",
                ACCENT_CLASSES[tile.accent]
              )}
            >
              <tile.icon className="h-5 w-5" />
            </span>
            <p className="mt-3 text-sm text-ink-muted">{tile.label}</p>
            <p className="mt-0.5 text-2xl font-semibold text-ink">{tile.value}</p>
            {tile.hint && <p className="text-xs text-ink-muted">{tile.hint}</p>}
          </>
        );
        const cardClass =
          "rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md";
        // Solo "Errores" es clickeable, y solo si hay algo que ver -- el
        // resto de los tiles no tiene una pantalla dedicada a la que ir.
        if ("to" in tile && tile.to && tile.value > 0) {
          return (
            <Link key={tile.label} to={tile.to} className={cn(cardClass, "border-error/30")}>
              {content}
            </Link>
          );
        }
        return (
          <div key={tile.label} className={cardClass}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
