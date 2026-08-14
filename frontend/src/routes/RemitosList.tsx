import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SearchBar } from "../components/SearchBar";
import { FilterBar } from "../components/FilterBar";
import { RemitosTable } from "../components/RemitosTable";
import { DocumentPreviewModal } from "../components/DocumentPreviewModal";
import { ShareModal } from "../components/ShareModal";
import { cn } from "../lib/cn";
import { deleteRemito, listRemitos } from "../lib/api";
import { dateInputToDdMmYyyy } from "../lib/datetime";
import { getDownloadUrl } from "../lib/files";
import { REMITO_STATUS, type DeliveryNote } from "../types";

const PAGE_SIZE = 10;

const STATUS_FILTERS = [
  { label: "Todos", value: "" },
  { label: "Procesados", value: REMITO_STATUS.PROCESSED },
  { label: "En revisión", value: REMITO_STATUS.REQUIRES_REVIEW },
  { label: "Parciales", value: REMITO_STATUS.PARTIAL },
  { label: "Duplicados", value: REMITO_STATUS.DUPLICATE },
];

export function RemitosList() {
  const navigate = useNavigate();
  const [remitos, setRemitos] = useState<DeliveryNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // `<input type="date">` → siempre `YYYY-MM-DD`; se traduce a `DD/MM/YYYY` al pedir.
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [page, setPage] = useState(0);
  const [previewRemito, setPreviewRemito] = useState<DeliveryNote | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    // Mismo debounce de 300ms para TODOS los filtros de texto/fecha: se tipea
    // rápido en cualquiera de ellos y sale un solo request.
    const timeoutId = setTimeout(() => {
      setLoading(true);
      setError(null);

      listRemitos({
        q: searchQuery.trim() || undefined,
        status: statusFilter || undefined,
        fecha_desde: dateInputToDdMmYyyy(fechaDesde),
        fecha_hasta: dateInputToDdMmYyyy(fechaHasta),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
        .then((data) => {
          if (active) setRemitos(data);
        })
        .catch((err: Error) => {
          if (active) setError(err.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 300);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [searchQuery, statusFilter, fechaDesde, fechaHasta, page]);

  function changeFilter(value: string) {
    setStatusFilter(value);
    setPage(0);
  }

  function changeSearch(value: string) {
    setSearchQuery(value);
    setPage(0);
  }

  function changeFechaDesde(value: string) {
    setFechaDesde(value);
    setPage(0);
  }

  function changeFechaHasta(value: string) {
    setFechaHasta(value);
    setPage(0);
  }

  function clearFilters() {
    setFechaDesde("");
    setFechaHasta("");
    setPage(0);
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * "Seleccionar todos" opera solo sobre lo visible en la página actual, sin
   * pisar lo que quedó tildado en otras páginas.
   */
  function toggleSelectAll(ids: string[]) {
    setSelectedIds((current) => {
      const next = new Set(current);
      const allSelected = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const hasNextPage = remitos.length === PAGE_SIZE;
  const selectedCount = selectedIds.size;

  /**
   * Borrado optimista: sacamos la fila del estado local en vez de refetchear
   * la página entera. Si era el único remito de su archivo, el backend borra
   * también el archivo (fila + binarios en MinIO); acá no hace falta saberlo.
   */
  async function handleDelete(remito: DeliveryNote) {
    const label = remito.numero_remito ?? "sin número";
    if (!window.confirm(`¿Borrar el remito ${label}? Esta acción no se puede deshacer.`)) return;

    try {
      await deleteRemito(remito.id);
      setRemitos((current) => current.filter((r) => r.id !== remito.id));
      setSelectedIds((current) => {
        if (!current.has(remito.id)) return current;
        const next = new Set(current);
        next.delete(remito.id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar el remito");
    }
  }

  /**
   * `Promise.allSettled`, no `Promise.all`: si uno de varios falla, los que
   * sí se borraron tienen que desaparecer igual de la lista y de la
   * selección -- no todo o nada.
   */
  async function handleBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const plural = ids.length === 1 ? "" : "s";
    if (
      !window.confirm(
        `¿Borrar ${ids.length} remito${plural} seleccionado${plural}? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }

    const results = await Promise.allSettled(ids.map((id) => deleteRemito(id)));
    const succeededIds = new Set(
      ids.filter((_, index) => results[index]!.status === "fulfilled")
    );
    const failedCount = ids.length - succeededIds.size;

    setRemitos((current) => current.filter((r) => !succeededIds.has(r.id)));
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of succeededIds) next.delete(id);
      return next;
    });

    if (failedCount > 0) {
      setError(`No se pudieron borrar ${failedCount} de ${ids.length} remitos seleccionados.`);
    }
  }

  /**
   * Descarga cada archivo por separado (no hay adjuntado directo a WhatsApp,
   * esto es para el que prefiere mandarlos a mano). Con un `<a download>` por
   * remito y una pausa entre cada uno -- disparar varias descargas juntas
   * hace que el navegador bloquee todas menos la primera.
   */
  async function handleBulkDownload() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    setDownloading(true);
    setError(null);
    let failedCount = 0;

    for (const [index, id] of ids.entries()) {
      try {
        const url = await getDownloadUrl(id);
        const link = document.createElement("a");
        link.href = url;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch {
        failedCount += 1;
      }
      if (index < ids.length - 1) await new Promise((resolve) => setTimeout(resolve, 400));
    }

    setDownloading(false);
    if (failedCount > 0) {
      setError(`No se pudieron descargar ${failedCount} de ${ids.length} remitos seleccionados.`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <SearchBar value={searchQuery} onChange={changeSearch} />
          <FilterBar
            fechaDesde={fechaDesde}
            fechaHasta={fechaHasta}
            onFechaDesdeChange={changeFechaDesde}
            onFechaHastaChange={changeFechaHasta}
            onClear={clearFilters}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => changeFilter(filter.value)}
              className={cn(
                "w-32 rounded-lg px-3 py-1.5 text-center text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                statusFilter === filter.value
                  ? "bg-primary text-white"
                  : "border border-border bg-surface text-ink hover:bg-surface-raised"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium text-ink">
            {selectedCount} seleccionado{selectedCount === 1 ? "" : "s"}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-sm font-medium text-ink-muted transition hover:text-ink hover:underline"
            >
              Limpiar selección
            </button>
            <button
              type="button"
              onClick={() => setSharing(true)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
            >
              Compartir por WhatsApp
            </button>
            <button
              type="button"
              onClick={() => void handleBulkDownload()}
              disabled={downloading}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface-raised disabled:opacity-50"
            >
              {downloading ? "Descargando..." : "Descargar"}
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="rounded-lg border border-error/40 px-4 py-2 text-sm font-medium text-error transition hover:bg-error-soft"
            >
              Eliminar seleccionados
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-error/30 bg-error-soft px-4 py-3 text-sm text-error">
          Error al cargar remitos: {error}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-ink-muted">Cargando...</p>
      ) : (
        <RemitosTable
          remitos={remitos}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onSelect={(remito) => navigate(`/remitos/${remito.id}`)}
          onPreview={setPreviewRemito}
          onDelete={handleDelete}
        />
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPage((current) => Math.max(0, current - 1))}
          disabled={page === 0 || loading}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-surface-raised disabled:opacity-40"
        >
          Anterior
        </button>
        <span className="text-sm text-ink-muted">Página {page + 1}</span>
        <button
          type="button"
          onClick={() => setPage((current) => current + 1)}
          disabled={!hasNextPage || loading}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-surface-raised disabled:opacity-40"
        >
          Siguiente
        </button>
      </div>

      {previewRemito && (
        <DocumentPreviewModal remito={previewRemito} onClose={() => setPreviewRemito(null)} />
      )}

      {sharing && (
        <ShareModal
          remitoIds={[...selectedIds]}
          onClose={() => setSharing(false)}
          onShared={() => {
            setSharing(false);
            setSelectedIds(new Set());
          }}
        />
      )}
    </div>
  );
}
