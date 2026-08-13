import { SOURCE_FILE_STATUS } from "../types";

/**
 * Un único mapa estado → etiqueta/estilo para los 8 estados de PRD §11.
 * Cubre tanto `delivery_notes.status` (subconjunto) como `source_files.status`.
 */
export const STATUS_LABELS: Record<string, string> = {
  [SOURCE_FILE_STATUS.UPLOADED]: "Subido",
  [SOURCE_FILE_STATUS.PENDING]: "Pendiente",
  [SOURCE_FILE_STATUS.PROCESSING]: "Procesando",
  [SOURCE_FILE_STATUS.PROCESSED]: "Procesado",
  [SOURCE_FILE_STATUS.REQUIRES_REVIEW]: "Requiere revisión",
  [SOURCE_FILE_STATUS.PARTIAL]: "Parcial",
  [SOURCE_FILE_STATUS.ERROR]: "Error",
  [SOURCE_FILE_STATUS.DUPLICATE]: "Posible duplicado",
};

export const STATUS_STYLES: Record<string, string> = {
  [SOURCE_FILE_STATUS.UPLOADED]: "bg-surface-raised text-ink-muted",
  [SOURCE_FILE_STATUS.PENDING]: "bg-info-soft text-info",
  [SOURCE_FILE_STATUS.PROCESSING]: "bg-primary-soft text-primary",
  [SOURCE_FILE_STATUS.PROCESSED]: "bg-success-soft text-success",
  [SOURCE_FILE_STATUS.REQUIRES_REVIEW]: "bg-warning-soft text-warning",
  [SOURCE_FILE_STATUS.PARTIAL]: "bg-warning-soft text-warning",
  [SOURCE_FILE_STATUS.ERROR]: "bg-error-soft text-error",
  [SOURCE_FILE_STATUS.DUPLICATE]: "bg-info-soft text-info",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
