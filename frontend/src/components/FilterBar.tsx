import { Calendar } from "lucide-react";
import { useRef } from "react";
import { cn } from "../lib/cn";
import { dateInputToDdMmYyyy } from "../lib/datetime";

interface FilterBarProps {
  fechaDesde: string;
  fechaHasta: string;
  onFechaDesdeChange: (value: string) => void;
  onFechaHastaChange: (value: string) => void;
  onClear: () => void;
}

interface DateIconButtonProps {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}

/**
 * Botón que es solo un ícono de calendario -- el `<input type="date">` real
 * sigue ahí (así el navegador aporta su selector nativo y `YYYY-MM-DD`
 * estable), pero visualmente reducido a 1×1px (`sr-only`) y disparado con
 * `showPicker()` en vez de mostrarse como caja de texto. El puntito y el
 * color cambian cuando hay fecha elegida -- sin eso no habría forma de saber
 * que el filtro está activo con el input escondido.
 */
function DateIconButton({ label, value, min, max, onChange }: DateIconButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValue = value !== "";
  const title = hasValue ? `${label}: ${dateInputToDdMmYyyy(value)}` : label;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => inputRef.current?.showPicker?.() ?? inputRef.current?.focus()}
        aria-label={title}
        title={title}
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-lg border transition",
          hasValue
            ? "border-primary bg-primary-soft text-primary"
            : "border-border bg-surface text-ink-muted hover:bg-surface-raised"
        )}
      >
        <Calendar className="h-4 w-4" />
        {hasValue && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
        )}
      </button>
      <input
        ref={inputRef}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
      />
    </div>
  );
}

/**
 * Filtro de rango de fechas que acompaña al `SearchBar` (que ya busca por
 * cliente entre otros campos -- no hace falta un input de cliente aparte acá).
 */
export function FilterBar({
  fechaDesde,
  fechaHasta,
  onFechaDesdeChange,
  onFechaHastaChange,
  onClear,
}: FilterBarProps) {
  const hasFilters = fechaDesde !== "" || fechaHasta !== "";

  return (
    <div className="flex items-center gap-2">
      <DateIconButton
        label="Desde"
        value={fechaDesde}
        max={fechaHasta || undefined}
        onChange={onFechaDesdeChange}
      />
      <DateIconButton
        label="Hasta"
        value={fechaHasta}
        min={fechaDesde || undefined}
        onChange={onFechaHastaChange}
      />

      {hasFilters && (
        <button
          type="button"
          onClick={onClear}
          className="text-sm font-medium text-ink-muted transition hover:text-ink hover:underline"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
