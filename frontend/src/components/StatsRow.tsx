import { Link } from "react-router-dom";
import { REMITO_STATUS, SOURCE_FILE_STATUS, type RemitoStats } from "../types";

interface StatsRowProps {
  stats: RemitoStats;
}

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

  const tiles = [
    { label: "Total de remitos", value: stats.total ?? 0 },
    { label: "Procesados", value: notes[REMITO_STATUS.PROCESSED] ?? 0 },
    { label: "Pendientes", value: pendingFiles, hint: "archivos en cola" },
    { label: "En revisión", value: notes[REMITO_STATUS.REQUIRES_REVIEW] ?? 0 },
    { label: "Parciales", value: notes[REMITO_STATUS.PARTIAL] ?? 0 },
    {
      label: "Errores",
      value: files[SOURCE_FILE_STATUS.ERROR] ?? 0,
      hint: "archivos",
      to: "/errores",
    },
    {
      label: "Duplicados",
      value: (notes[REMITO_STATUS.DUPLICATE] ?? 0) + (files[SOURCE_FILE_STATUS.DUPLICATE] ?? 0),
      hint: "remitos + archivos",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
      {tiles.map((tile) => {
        const content = (
          <>
            <p className="text-sm text-ink-muted">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{tile.value}</p>
            {tile.hint && <p className="text-xs text-ink-muted">{tile.hint}</p>}
          </>
        );
        // Solo "Errores" es clickeable, y solo si hay algo que ver -- el
        // resto de los tiles no tiene una pantalla dedicada a la que ir.
        if ("to" in tile && tile.to && tile.value > 0) {
          return (
            <Link
              key={tile.label}
              to={tile.to}
              className="rounded-lg border border-error/30 bg-error-soft p-4 shadow-sm transition hover:bg-error-soft/70"
            >
              {content}
            </Link>
          );
        }
        return (
          <div key={tile.label} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
            {content}
          </div>
        );
      })}
    </div>
  );
}
