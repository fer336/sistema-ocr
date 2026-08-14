import { Eye, GripVertical, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { cn } from "../lib/cn";
import { formatFechaHora } from "../lib/datetime";
import { prefetchFileUrl } from "../lib/files";
import { useAuth } from "../lib/auth-context";
import type { DeliveryNote } from "../types";

type SortKey = "fecha_hora" | "numero_remito" | "numero_cliente" | "cliente" | "status";
type SortDirection = "asc" | "desc";

/** Columnas reordenables de la tabla. El checkbox y el borrado quedan fijos. */
type ColumnKey =
  | "numero_cliente"
  | "cliente"
  | "numero_remito"
  | "comentarios"
  | "fecha_hora"
  | "status"
  | "archivo";

/** Union discriminada: `sortable: true` garantiza que `key` es ordenable,
 *  así `toggleSort` recibe `SortKey` sin casts. */
type ColumnDef =
  | { key: SortKey; label: string; sortable: true }
  | { key: "comentarios" | "archivo"; label: string; sortable: false };

/** Orden canónico de las columnas (PRD: N.º cliente, Nombre, N.º remito,
 *  Comentarios, Fecha y hora, Estado, Archivo). El usuario puede reordenarlas
 *  y el orden queda persistido por usuario (ver `loadColumnOrder`). */
const COLUMNS: ColumnDef[] = [
  { key: "numero_cliente", label: "N.º cliente", sortable: true },
  { key: "cliente", label: "Nombre cliente", sortable: true },
  { key: "numero_remito", label: "N.º remito", sortable: true },
  { key: "comentarios", label: "Comentarios", sortable: false },
  { key: "fecha_hora", label: "Fecha y hora", sortable: true },
  { key: "status", label: "Estado", sortable: true },
  { key: "archivo", label: "Archivo", sortable: false },
];

const DEFAULT_ORDER: ColumnKey[] = COLUMNS.map((column) => column.key);

const COLUMN_ORDER_KEY_PREFIX = "remitos.columns.";

/** Clave de localStorage por usuario: cada usuario del cliente conserva su
 *  propio orden sin pisar el de los demás. Sin sesión, una clave global. */
function columnOrderStorageKey(userId?: string): string {
  return userId ? `${COLUMN_ORDER_KEY_PREFIX}${userId}` : "remitos.columns";
}

/**
 * Lee el orden guardado y lo valida como permutación exacta de las columnas;
 * si está corrupto, incompleto o repetido, vuelve al orden por defecto.
 */
function loadColumnOrder(userId?: string): ColumnKey[] {
  try {
    const raw = localStorage.getItem(columnOrderStorageKey(userId));
    if (!raw) return DEFAULT_ORDER;
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === COLUMNS.length &&
      new Set(parsed).size === COLUMNS.length &&
      parsed.every((key) => COLUMNS.some((column) => column.key === key))
    ) {
      return parsed as ColumnKey[];
    }
  } catch {
    // JSON corrupto: seguimos con el orden por defecto.
  }
  return DEFAULT_ORDER;
}

function isDefaultOrder(order: ColumnKey[]): boolean {
  return (
    order.length === DEFAULT_ORDER.length &&
    order.every((key, index) => key === DEFAULT_ORDER[index])
  );
}

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
  const { user } = useAuth();
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(() => loadColumnOrder(user?.id));
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // Persistir el orden apenas cambia. TODOS los hooks van antes del early
  // return de "no se encontraron remitos" (reglas de los hooks).
  useEffect(() => {
    try {
      localStorage.setItem(columnOrderStorageKey(user?.id), JSON.stringify(columnOrder));
    } catch {
      // localStorage no disponible (modo privado, cuota llena): el orden vive
      // solo en memoria esta sesión.
    }
  }, [columnOrder, user?.id]);

  if (remitos.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-muted">No se encontraron remitos.</p>;
  }

  const dragging = dragIndex !== null;

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

  /** Mueve la columna arrastrada a la posición de destino y persiste. */
  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    setColumnOrder((current) => {
      const next = [...current];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDragIndex(null);
    setOverIndex(null);
  }

  function resetColumns() {
    setColumnOrder(DEFAULT_ORDER);
  }

  function headerContent(column: ColumnDef) {
    if (column.sortable) {
      return (
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
      );
    }
    return <span>{column.label}</span>;
  }

  /**
   * Header arrastrable (HTML5 DnD, mouse): un click simple sigue ordenando,
   * arrastrar mueve la columna. Firefox exige `setData` para arrancar el drag.
   */
  function renderHeader(column: ColumnDef, index: number) {
    const isArchivo = column.key === "archivo";
    return (
      <th
        key={column.key}
        draggable
        title={dragging ? undefined : "Arrastrar para reordenar"}
        onDragStart={(event) => {
          setDragIndex(index);
          setOverIndex(null);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", column.key);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (overIndex !== index) setOverIndex(index);
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleDrop(index);
        }}
        onDragEnd={() => {
          setDragIndex(null);
          setOverIndex(null);
        }}
        className={cn(
          "group cursor-grab select-none px-4 py-2 text-left font-medium text-ink-muted transition-colors",
          isArchivo && "text-center",
          dragging && dragIndex === index && "opacity-40",
          dragging && overIndex === index && dragIndex !== index && "bg-primary-soft"
        )}
      >
        <div className={cn("flex items-center gap-1", isArchivo && "justify-center")}>
          {headerContent(column)}
          <GripVertical
            className={cn(
              "h-3.5 w-3.5 opacity-0 transition group-hover:opacity-60",
              dragging && dragIndex === index && "opacity-60"
            )}
            aria-hidden="true"
          />
        </div>
      </th>
    );
  }

  /** Celdas del cuerpo en el mismo orden que los headers. */
  function renderCell(column: ColumnKey, remito: DeliveryNote) {
    switch (column) {
      case "numero_cliente":
        return <td className="px-4 py-2 whitespace-nowrap text-ink">{remito.numero_cliente ?? "—"}</td>;
      case "cliente":
        return (
          <td className="max-w-56 truncate px-4 py-2 text-ink" title={remito.cliente ?? ""}>
            {remito.cliente ?? "—"}
          </td>
        );
      case "numero_remito":
        return (
          <td className="px-4 py-2 whitespace-nowrap font-medium text-ink">
            {remito.numero_remito ?? "—"}
          </td>
        );
      case "comentarios":
        return (
          <td className="max-w-56 truncate px-4 py-2 text-ink" title={remito.comentarios ?? ""}>
            {remito.comentarios ?? "—"}
          </td>
        );
      case "fecha_hora":
        return <td className="px-4 py-2 whitespace-nowrap text-ink">{formatFechaHora(remito.fecha_hora)}</td>;
      case "status":
        return (
          <td className="px-4 py-2 whitespace-nowrap">
            <StatusBadge status={remito.status} />
          </td>
        );
      case "archivo":
        return (
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
        );
      default:
        return null;
    }
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface shadow-sm md:block">
        {!isDefaultOrder(columnOrder) && (
          <div className="flex justify-end border-b border-border px-4 py-2">
            <button
              type="button"
              onClick={resetColumns}
              className="text-xs font-medium text-ink-muted transition hover:text-ink hover:underline"
            >
              Restablecer orden de columnas
            </button>
          </div>
        )}
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
              {columnOrder.map((key, index) => {
                const column = COLUMNS.find((candidate) => candidate.key === key)!;
                return renderHeader(column, index);
              })}
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
                {columnOrder.map((key) => renderCell(key, remito))}
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
              <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
                {/* El checkbox va FUERA del botón de fila: un `<input>` dentro
                    de un `<button>` no es HTML válido y el click no llegaría. */}
                <div className="flex items-start gap-3">
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
                    <p className="mt-1 truncate text-sm text-ink">{remito.cliente ?? "—"}</p>

                    {/* Metadata en grilla simétrica de 2 columnas con etiquetas: cada dato
                        queda alineado con su par y no se mezclan en una sola línea. */}
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <dt className="text-xs text-ink-muted">N.º cliente</dt>
                        <dd className="truncate text-sm text-ink">{remito.numero_cliente ?? "—"}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs text-ink-muted">Fecha y hora</dt>
                        <dd className="truncate text-sm text-ink">{formatFechaHora(remito.fecha_hora)}</dd>
                      </div>
                    </dl>

                    {remito.comentarios && (
                      <div className="mt-3">
                        <p className="text-xs text-ink-muted">Comentarios</p>
                        <p className="line-clamp-2 text-sm text-ink-muted">{remito.comentarios}</p>
                      </div>
                    )}
                  </button>
                </div>

                {/* Acciones en dos mitades iguales: mismo tamaño y peso visual, divididas
                    por un separador. El botón de borrado gana target táctil y queda
                    alineado con "Ver documento" en vez de flotar como ícono suelto. */}
                <div className="mt-4 grid grid-cols-2 divide-x divide-border overflow-hidden rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => onPreview(remito)}
                    aria-label={`Ver remito ${remito.numero_remito ?? "sin número"}`}
                    className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-primary transition active:bg-surface-raised"
                  >
                    <Eye className="h-4 w-4" />
                    Ver documento
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(remito)}
                    aria-label={`Borrar remito ${remito.numero_remito ?? "sin número"}`}
                    className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-error transition active:bg-error-soft"
                  >
                    <Trash2 className="h-4 w-4" />
                    Eliminar
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
