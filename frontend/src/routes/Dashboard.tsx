import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { StatsRow } from "../components/StatsRow";
import { StatusBadge } from "../components/StatusBadge";
import { getRemitoStats, listRemitos } from "../lib/api";
import { formatFechaHora } from "../lib/datetime";
import { REMITO_STATUS, type DeliveryNote, type RemitoStats } from "../types";

const RECENT_LIMIT = 8;

export function Dashboard() {
  const [remitos, setRemitos] = useState<DeliveryNote[]>([]);
  const [stats, setStats] = useState<RemitoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getRemitoStats(), listRemitos({ limit: RECENT_LIMIT })])
      .then(([statsData, recent]) => {
        if (!active) return;
        setStats(statsData);
        setRemitos(recent);
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

  const byStatus = stats?.remitos_by_status ?? {};
  const pendingReview =
    (byStatus[REMITO_STATUS.REQUIRES_REVIEW] ?? 0) + (byStatus[REMITO_STATUS.PARTIAL] ?? 0);

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg border border-error/30 bg-error-soft px-4 py-3 text-sm text-error">
          Error al cargar el resumen: {error}
        </p>
      )}

      {loading ? (
        // Skeleton que refleja el layout final (tiles + lista) para evitar
        // saltos de layout al terminar la carga; `aria-hidden` + sr-only
        // mantienen el anuncio accesible sin duplicar contenido.
        <>
          <p className="sr-only">Cargando...</p>
          <div className="space-y-6" aria-hidden="true">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="h-36 animate-pulse rounded-xl border border-border bg-surface-raised" />
              ))}
            </div>
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-surface-raised" />
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-lg font-semibold text-ink">Dashboard</h1>
              <p className="text-sm text-ink-muted">Resumen de remitos y archivos</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Link
                to="/escanear"
                className="rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-primary-hover"
              >
                Escanear remitos
              </Link>
              <Link
                to="/remitos"
                className="rounded-lg border border-border bg-surface px-4 py-2.5 text-center text-sm font-medium text-ink transition hover:bg-surface-raised"
              >
                Ver todos los remitos
              </Link>
              {pendingReview > 0 && (
                <Link
                  to="/revision"
                  className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-2.5 text-center text-sm font-medium text-warning transition hover:bg-warning-soft/70"
                >
                  Revisar {pendingReview} remito{pendingReview === 1 ? "" : "s"}
                </Link>
              )}
            </div>
          </div>

          {stats && <StatsRow stats={stats} />}

          <section className="rounded-lg border border-border bg-surface shadow-sm">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-ink">
              Últimos remitos
            </h2>
            {remitos.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <FileText className="h-8 w-8 text-ink-muted/60" aria-hidden="true" />
                <p className="text-sm text-ink-muted">Todavía no hay remitos cargados.</p>
                <Link
                  to="/escanear"
                  className="text-sm font-medium text-primary transition hover:text-primary-hover"
                >
                  Escanear el primer remito
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {remitos.map((remito) => (
                  <li key={remito.id}>
                    <Link
                      to={`/remitos/${remito.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-surface-raised"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">
                          {remito.numero_remito ?? "Sin número"}
                        </span>
                        <span className="block truncate text-sm text-ink-muted">{remito.cliente ?? "—"}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge status={remito.status} />
                        <span className="text-sm text-ink-muted">{formatFechaHora(remito.fecha_hora)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
