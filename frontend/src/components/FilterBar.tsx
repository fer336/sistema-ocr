interface FilterBarProps {
  fechaDesde: string;
  fechaHasta: string;
  onFechaDesdeChange: (value: string) => void;
  onFechaHastaChange: (value: string) => void;
  onClear: () => void;
}

/**
 * Filtro de rango de fechas que acompaña al `SearchBar` (que ya busca por
 * cliente entre otros campos -- no hace falta un input de cliente aparte acá).
 *
 * Las fechas son dos `<input type="date">` nativos a propósito — el valor que
 * entregan (`YYYY-MM-DD`) es estable en todos los navegadores y no justifica
 * sumar una librería de date-picker. El debounce lo aplica `RemitosList`, igual
 * que para la búsqueda libre.
 */
const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary";

export function FilterBar({
  fechaDesde,
  fechaHasta,
  onFechaDesdeChange,
  onFechaHastaChange,
  onClear,
}: FilterBarProps) {
  const hasFilters = fechaDesde !== "" || fechaHasta !== "";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex w-[calc(50%-0.375rem)] flex-col gap-1 sm:w-40">
        <span className="text-xs font-medium text-ink-muted">Desde</span>
        <input
          type="date"
          value={fechaDesde}
          max={fechaHasta || undefined}
          onChange={(event) => onFechaDesdeChange(event.target.value)}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex w-[calc(50%-0.375rem)] flex-col gap-1 sm:w-40">
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
          className="text-sm font-medium text-ink-muted transition hover:text-ink hover:underline sm:py-2.5"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
