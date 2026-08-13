interface FilterBarProps {
  cliente: string;
  fechaDesde: string;
  fechaHasta: string;
  onClienteChange: (value: string) => void;
  onFechaDesdeChange: (value: string) => void;
  onFechaHastaChange: (value: string) => void;
  onClear: () => void;
}

/**
 * Filtros dedicados que acompañan al `SearchBar`: cliente + rango de fechas.
 *
 * Las fechas son dos `<input type="date">` nativos a propósito — el valor que
 * entregan (`YYYY-MM-DD`) es estable en todos los navegadores y no justifica
 * sumar una librería de date-picker. El debounce lo aplica `RemitosList`, igual
 * que para la búsqueda libre.
 */
const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary";

export function FilterBar({
  cliente,
  fechaDesde,
  fechaHasta,
  onClienteChange,
  onFechaDesdeChange,
  onFechaHastaChange,
  onClear,
}: FilterBarProps) {
  const hasFilters = cliente !== "" || fechaDesde !== "" || fechaHasta !== "";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <label className="flex w-full flex-col gap-1 sm:w-56">
        <span className="text-xs font-medium text-ink-muted">Cliente</span>
        <input
          type="text"
          value={cliente}
          onChange={(event) => onClienteChange(event.target.value)}
          placeholder="Nombre del cliente"
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex w-full flex-col gap-1 sm:w-44">
        <span className="text-xs font-medium text-ink-muted">Desde</span>
        <input
          type="date"
          value={fechaDesde}
          max={fechaHasta || undefined}
          onChange={(event) => onFechaDesdeChange(event.target.value)}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex w-full flex-col gap-1 sm:w-44">
        <span className="text-xs font-medium text-ink-muted">Hasta</span>
        <input
          type="date"
          value={fechaHasta}
          min={fechaDesde || undefined}
          onChange={(event) => onFechaHastaChange(event.target.value)}
          className={FIELD_CLASS}
        />
      </label>

      {hasFilters && (
        <button
          type="button"
          onClick={onClear}
          className="self-start text-sm font-medium text-ink-muted transition hover:text-ink hover:underline sm:self-auto sm:py-2.5"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
