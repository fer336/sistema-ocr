import { REMITO_STATUS, type DeliveryNote } from "../types";

interface StatsRowProps {
  remitos: DeliveryNote[];
}

export function StatsRow({ remitos }: StatsRowProps) {
  const total = remitos.length;
  const requiresReview = remitos.filter((r) => r.status === REMITO_STATUS.REQUIRES_REVIEW).length;
  const duplicates = remitos.filter((r) => r.status === REMITO_STATUS.DUPLICATE).length;
  const processed = remitos.filter((r) => r.status === REMITO_STATUS.PROCESSED).length;

  const stats = [
    { label: "Total de remitos", value: total },
    { label: "Procesados", value: processed },
    { label: "En revisión", value: requiresReview },
    { label: "Posibles duplicados", value: duplicates },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-lg border border-slate-200 bg-surface p-4">
          <p className="text-sm text-ink-muted">{stat.label}</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
