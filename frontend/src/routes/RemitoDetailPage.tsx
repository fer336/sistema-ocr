import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RemitoDetail } from "../components/RemitoDetail";
import { getRemito } from "../lib/api";
import type { DeliveryNote } from "../types";

export function RemitoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [remito, setRemito] = useState<DeliveryNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setError(null);

    getRemito(id)
      .then((data) => {
        if (active) setRemito(data);
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
  }, [id]);

  return (
    <div className="space-y-4">
      <Link to="/remitos" className="text-sm font-medium text-primary hover:underline">
        ← Volver al listado
      </Link>

      {loading && <p className="py-8 text-center text-sm text-ink-muted">Cargando remito...</p>}

      {error && (
        <p className="rounded-lg border border-error/30 bg-error-soft px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      {remito && <RemitoDetail remito={remito} onUpdated={setRemito} />}
    </div>
  );
}
