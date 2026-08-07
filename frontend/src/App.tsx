import { useEffect, useState } from "react";
import { StatsRow } from "./components/StatsRow";
import { SearchBar } from "./components/SearchBar";
import { RemitosTable } from "./components/RemitosTable";
import { RemitoDetail } from "./components/RemitoDetail";
import { cn } from "./lib/cn";
import { listRemitos, searchRemitos } from "./lib/api";
import { REMITO_STATUS, type DeliveryNote } from "./types";

const STATUS_FILTERS = [
  { label: "Todos", value: "" },
  { label: "Procesados", value: REMITO_STATUS.PROCESSED },
  { label: "En revisión", value: REMITO_STATUS.REQUIRES_REVIEW },
  { label: "Duplicados", value: REMITO_STATUS.DUPLICATE },
];

function App() {
  const [remitos, setRemitos] = useState<DeliveryNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRemito, setSelectedRemito] = useState<DeliveryNote | null>(null);

  useEffect(() => {
    const trimmedQuery = searchQuery.trim();
    const timeoutId = setTimeout(() => {
      setLoading(true);
      setError(null);

      const fetchPromise = trimmedQuery ? searchRemitos(trimmedQuery) : listRemitos(statusFilter || undefined);

      fetchPromise
        .then(setRemitos)
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, statusFilter]);

  function handleUpdated(updated: DeliveryNote) {
    setRemitos((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setSelectedRemito(updated);
  }

  return (
    <div className="min-h-screen bg-canvas pb-16">
      <header className="border-b border-slate-200 bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <h1 className="text-xl font-semibold text-ink">Remitos</h1>
          <p className="text-sm text-ink-muted">Digitalización y búsqueda de remitos</p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <StatsRow remitos={remitos} />

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
          <div className="flex gap-2">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setStatusFilter(filter.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  statusFilter === filter.value
                    ? "bg-primary text-white"
                    : "border border-slate-300 bg-surface text-ink hover:bg-slate-100"
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Error al cargar remitos: {error}
          </p>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-ink-muted">Cargando...</p>
        ) : (
          <RemitosTable remitos={remitos} onSelect={setSelectedRemito} />
        )}
      </main>

      {selectedRemito && (
        <RemitoDetail
          remito={selectedRemito}
          onClose={() => setSelectedRemito(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}

export default App;
