import { Eye, Trash2 } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { cn } from "../lib/cn";
import { formatFechaHora } from "../lib/datetime";
import { prefetchFileUrl } from "../lib/files";
import type { DeliveryNote } from "../types";

type SortKey = "fecha_hora" | "numero_remito" | "numero_cliente" | "cliente" | "status";
type SortDirection = "asc" | "desc";

interface RemitosTableProps {
  remitos: DeliveryNote[];
  /** Ids tildados para compartir. La selección vive en `RemitosList`. */
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  /** Tilda/destilda los remitos visibles en la página actual. */
  onToggleSelectAll: (ids: string[]) => void;
  onSelect: (remito: DeliveryNote) => void;
  onPreview: (remito: DeliveryNote) => void;
  /** Borrado de UN remito puntual. La confirmación vive en `RemitosList`. */
  onDelete: (remito: DeliveryNote) => void;
}

/** Mismo look para el checkbox de fila y el del header. */
const CHECKBOX_CLASS =
  "h-4 w-4 shrink-0 cursor-pointer accent-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none";

/**
 * Orden pedido por el usuario: N.º cliente, Nombre cliente, N.º remito,
 * Comentarios, Fecha y hora, Estado, Archivo. `Comentarios` y `Archivo` no
 * son ordenables, así que van hardcodeados entre estos dos grupos en vez de
 * vivir en este array -- ver `<thead>`/`<tbody>`, que insertan `Comentarios`
 * justo entre ambos y `Archivo` al final. Las `<td>` del cuerpo siguen
 * exactamente el mismo orden.
 */
const COLUMNS_BEFORE_COMENTARIOS: { key: SortKey; label: string }[] = [
  { key: "numero_cliente", label: "N.º cliente" },
  { key: "cliente", label: "Nombre cliente" },
  { key: "numero_remito", label: "N.º remito" },
];
const COLUMNS_AFTER_COMENTARIOS: { key: SortKey; label: string }[] = [
  { key: "fecha_hora", label: "Fecha y hora" },
  { key: "status", label: "Estado" },
];

function compare(a: DeliveryNote, b: DeliveryNote, key: SortKey): number {
  const left = a[key];
  const right = b[key];
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (key === "fecha_hora") {
    return new Date(left).getTime() - new Date(right).getTime();
  }
  return String(left).localeCompare(String(right), "es-AR", { numeric: true });
}

export function RemitosTable({
  remitos,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onSelect,
  onPreview,
  onDelete,
}: RemitosTableProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  if (remitos.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-muted">No se encontraron remitos.</p>;
  }

  const sorted = sortKey
    ? [...remitos].sort((a, b) => compare(a, b, sortKey) * (sortDirection === "asc" ? 1 : -1))
    : remitos;

  const visibleIds = remitos.map((remito) => remito.id);
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = selectedVisible === visibleIds.length;
  const someVisibleSelected = selectedVisible > 0 && !allVisibleSelected;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  }

  function sortableHeader(column: { key: SortKey; label: string }) {
    return (
      <th key={column.key} className="px-4 py-2 text-left font-medium text-ink-muted">
        <button
          type="button"
          onClick={() => toggleSort(column.key)}
          className="inline-flex items-center gap-1 transition hover:text-ink"
        >
          {column.label}
          <span
            className={cn("text-xs", sortKey === column.key ? "text-primary" : "text-transparent")}
            aria-hidden="true"
          >
            {sortKey === column.key && sortDirection === "desc" ? "▼" : "▲"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface shadow-sm md:block">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-raised">
            <tr>
              <th className="w-10 px-4 py-2">
                <input
                  type="checkbox"
                  className={CHECKBOX_CLASS}
                  checked={allVisibleSelected}
                  ref={(node) => {
                    // El estado "algunos tildados" no existe como prop, solo
                    // como propiedad del nodo.
                    if (node) node.indeterminate = someVisibleSelected;
                  }}
                  onChange={() => onToggleSelectAll(visibleIds)}
                  aria-label="Seleccionar todos los remitos visibles"
                />
              </th>
              {COLUMNS_BEFORE_COMENTARIOS.map(sortableHeader)}
              <th className="px-4 py-2 text-left font-medium text-ink-muted">Comentarios</th>
              {COLUMNS_AFTER_COMENTARIOS.map(sortableHeader)}
              <th className="w-16 px-4 py-2 text-center font-medium text-ink-muted">Archivo</th>
              <th className="w-16 px-4 py-2 text-center font-medium text-ink-muted">
                <span className="sr-only">Borrar</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((remito) => (
              <tr
                key={remito.id}
                className="cursor-pointer transition-colors hover:bg-surface-raised"
                onClick={() => onSelect(remito)}
              >
                <td className="px-4 py-2">
                  {/* Mismo `stopPropagation` que el botón "Ver": tildar no
                      tiene que abrir el detalle. */}
                  <input
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    checked={selectedIds.has(remito.id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => onToggleSelect(remito.id)}
                    aria-label={`Seleccionar remito ${remito.numero_remito ?? "sin número"}`}
                  />
                </td>
                <td className="px-4 py-2 text-ink">{remito.numero_cliente ?? "—"}</td>
                <td className="px-4 py-2 text-ink">{remito.cliente ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap font-medium text-ink">
                  {remito.numero_remito ?? "—"}
                </td>
                <td className="max-w-56 truncate px-4 py-2 text-ink" title={remito.comentarios ?? ""}>
                  {remito.comentarios ?? "—"}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-ink">
                  {formatFechaHora(remito.fecha_hora)}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={remito.status} />
                </td>
                <td className="px-4 py-2 text-center">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPreview(remito);
                    }}
                    onMouseEnter={() => prefetchFileUrl(remito.id)}
                    onFocus={() => prefetchFileUrl(remito.id)}
                    aria-label={`Ver remito ${remito.numero_remito ?? "sin número"}`}
                    className="text-primary transition hover:text-primary-hover"
                  >
                    <Eye className="mx-auto h-4 w-4" />
                  </button>
                </td>
                <td className="px-4 py-2 text-center">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(remito);
                    }}
                    aria-label={`Borrar remito ${remito.numero_remito ?? "sin número"}`}
                    className="text-error transition hover:text-error/70"
                  >
                    <Trash2 className="mx-auto h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="md:hidden">
        <label className="mb-3 flex items-center gap-2 px-1 text-sm text-ink-muted">
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={allVisibleSelected}
            ref={(node) => {
              if (node) node.indeterminate = someVisibleSelected;
            }}
            onChange={() => onToggleSelectAll(visibleIds)}
          />
          Seleccionar todos
        </label>

        <ul className="space-y-3">
          {sorted.map((remito) => (
            <li key={remito.id}>
              {/* El checkbox va FUERA del botón de fila: un `<input>` dentro de
                  un `<button>` no es HTML válido y el click no llegaría. */}
              <div className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
                <input
                  type="checkbox"
                  className={cn(CHECKBOX_CLASS, "mt-1")}
                  checked={selectedIds.has(remito.id)}
                  onChange={() => onToggleSelect(remito.id)}
                  aria-label={`Seleccionar remito ${remito.numero_remito ?? "sin número"}`}
                />
                <button
                  type="button"
                  onClick={() => onSelect(remito)}
                  className="min-w-0 flex-1 text-left transition active:opacity-70"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold text-ink">
                      {remito.numero_remito ?? "Sin número"}
                    </span>
                    <StatusBadge status={remito.status} />
                  </div>
                  <p className="mt-1 text-sm text-ink">{remito.cliente ?? "—"}</p>
                  <p className="text-sm text-ink-muted">
                    N.º cliente {remito.numero_cliente ?? "—"} · {formatFechaHora(remito.fecha_hora)}
                  </p>
                  {remito.comentarios && (
                    <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{remito.comentarios}</p>
                  )}
                </button>
              </div>
              <div className="mt-1 flex items-center gap-4 px-4">
                <button
                  type="button"
                  onClick={() => onPreview(remito)}
                  aria-label={`Ver remito ${remito.numero_remito ?? "sin número"}`}
                  className="flex items-center gap-1.5 text-sm font-medium text-primary"
                >
                  <Eye className="h-4 w-4" />
                  Ver documento
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(remito)}
                  aria-label={`Borrar remito ${remito.numero_remito ?? "sin número"}`}
                  className="text-error"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
