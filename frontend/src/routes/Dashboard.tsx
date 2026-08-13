import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
        <p className="py-8 text-center text-sm text-ink-muted">Cargando...</p>
      ) : (
        <>
          {stats && <StatsRow stats={stats} />}

          <div className="flex flex-wrap gap-3">
            <Link
              to="/escanear"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
            >
              Escanear remitos
            </Link>
            <Link
              to="/remitos"
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface-raised"
            >
              Ver todos los remitos
            </Link>
            {pendingReview > 0 && (
              <Link
                to="/revision"
                className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-2 text-sm font-medium text-warning transition hover:bg-warning-soft/70"
              >
                Revisar {pendingReview} remito{pendingReview === 1 ? "" : "s"}
              </Link>
            )}
          </div>

          <section className="rounded-lg border border-border bg-surface shadow-sm">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-ink">
              Últimos remitos
            </h2>
            {remitos.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-muted">
                Todavía no hay remitos cargados.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {remitos.map((remito) => (
                  <li key={remito.id}>
                    <Link
                      to={`/remitos/${remito.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 transition hover:bg-surface-raised"
                    >
                      <span className="font-medium text-ink">
                        {remito.numero_remito ?? "Sin número"}
                      </span>
                      <span className="text-sm text-ink-muted">{remito.cliente ?? "—"}</span>
                      <span className="text-sm text-ink-muted">
                        {formatFechaHora(remito.fecha_hora)}
                      </span>
                      <StatusBadge status={remito.status} />
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
