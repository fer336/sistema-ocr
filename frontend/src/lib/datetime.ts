/**
 * `fecha_hora` viaja como `TIMESTAMPTZ` (ISO-8601 en UTC) pero el negocio la
 * lee siempre en hora local argentina. Argentina no aplica DST desde 2009, así
 * que el offset fijo -03:00 es suficiente y determinístico.
 */
export const AR_TIME_ZONE = "America/Argentina/Buenos_Aires";
const AR_UTC_OFFSET = "-03:00";

const AR_PARTS = new Intl.DateTimeFormat("es-AR", {
  timeZone: AR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

interface DateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

function partsInBuenosAires(iso: string): DateParts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const parts: Record<string, string> = {};
  for (const part of AR_PARTS.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  if (!parts.year || !parts.month || !parts.day) return null;

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // `hour12: false` puede devolver "24" para medianoche en algunos runtimes.
    hour: parts.hour === "24" ? "00" : (parts.hour ?? "00"),
    minute: parts.minute ?? "00",
  };
}

/** `DD/MM/YYYY HH:mm` — el formato canónico de PRD §4. */
export function formatFechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parts = partsInBuenosAires(iso);
  if (!parts) return iso;
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export function formatFecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parts = partsInBuenosAires(iso);
  if (!parts) return iso;
  return `${parts.day}/${parts.month}/${parts.year}`;
}

/** Valor para `<input type="datetime-local">`: `YYYY-MM-DDTHH:mm` en hora AR. */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const parts = partsInBuenosAires(iso);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * `<input type="date">` siempre entrega `YYYY-MM-DD` (independiente del locale
 * del navegador); el backend espera `DD/MM/YYYY` para `fecha_desde`/`fecha_hasta`.
 * Devuelve `undefined` si el input está vacío o incompleto, para que el filtro
 * simplemente no se mande.
 */
export function dateInputToDdMmYyyy(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/**
 * Inverso del anterior. Devuelve un ISO-8601 con offset explícito para que el
 * backend no tenga que adivinar la zona del valor editado a mano.
 */
export function fromDatetimeLocalValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(trimmed);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00${AR_UTC_OFFSET}`;
}
