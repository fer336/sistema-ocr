import { useEffect, useState } from "react";
import { RemitoDetail } from "../components/RemitoDetail";
import { cn } from "../lib/cn";
import { listRemitos } from "../lib/api";
import { formatFechaHora } from "../lib/datetime";
import { statusLabel } from "../lib/status";
import { REMITO_STATUS, type DeliveryNote } from "../types";

/** Solo entran a la cola de revisión los estados que la piden (PRD §13). */
const REVIEW_STATUSES = [REMITO_STATUS.REQUIRES_REVIEW, REMITO_STATUS.PARTIAL];

export function Review() {
  const [queue, setQueue] = useState<DeliveryNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    Promise.all(REVIEW_STATUSES.map((status) => listRemitos({ status })))
      .then((results) => {
        if (!active) return;
        const merged = results.flat();
        setQueue(merged);
        setSelectedId((current) =>
          current && merged.some((item) => item.id === current) ? current : (merged[0]?.id ?? null)
        );
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const selected = queue.find((item) => item.id === selectedId) ?? null;

  function handleUpdated(updated: DeliveryNote) {
    const index = queue.findIndex((item) => item.id === updated.id);
    if (index === -1) return;

    if (REVIEW_STATUSES.some((status) => status === updated.status)) {
      setQueue(queue.map((item) => (item.id === updated.id ? updated : item)));
      return;
    }

    // Salió de los estados revisables: lo sacamos de la cola y avanzamos.
    const next = queue.filter((item) => item.id !== updated.id);
    setQueue(next);
    setSelectedId(next[Math.min(index, next.length - 1)]?.id ?? null);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">Revisión manual</h2>
        <p className="text-sm text-ink-muted">
          Remitos con campos dudosos o incompletos. Corregí los valores y aprobá.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-error/30 bg-error-soft px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-ink-muted">Cargando cola de revisión...</p>
      ) : queue.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-ink-muted">
          No hay remitos pendientes de revisión.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <ul className="max-h-96 space-y-2 overflow-y-auto lg:max-h-none">
            {queue.map((remito) => (
              <li key={remito.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(remito.id)}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left text-sm transition",
                    remito.id === selectedId
                      ? "border-primary bg-primary/5"
                      : "border-border bg-surface hover:bg-surface-raised"
                  )}
                >
                  <span className="block font-medium text-ink">
                    {remito.numero_remito ?? "Sin número"}
                  </span>
                  <span className="block text-ink-muted">{remito.cliente ?? "Sin cliente"}</span>
                  <span className="block text-xs text-ink-muted">
                    {formatFechaHora(remito.fecha_hora)} · {statusLabel(remito.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {selected && (
            <RemitoDetail
              key={selected.id}
              remito={selected}
              onUpdated={handleUpdated}
              startEditing
              approveLabel="Aprobar y siguiente"
            />
          )}
        </div>
      )}
    </div>
  );
}
