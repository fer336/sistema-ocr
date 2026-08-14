/**
 * Estados de un remito (`delivery_notes.status`).
 *
 * Es un subconjunto de los estados de PRD §11: una fila de `delivery_notes`
 * solo existe después del OCR, por lo que nunca pasa por
 * `uploaded`/`pending`/`processing`/`error` — ese es el ciclo de vida del
 * `source_file` padre (ver `SOURCE_FILE_STATUS`).
 */
export const REMITO_STATUS = {
  PROCESSED: "processed",
  REQUIRES_REVIEW: "requires_review",
  PARTIAL: "partial",
  DUPLICATE: "duplicate",
} as const;

export type RemitoStatus = (typeof REMITO_STATUS)[keyof typeof REMITO_STATUS];

/** Estados de `source_files.status` — set completo de PRD §11. */
export const SOURCE_FILE_STATUS = {
  UPLOADED: "uploaded",
  PENDING: "pending",
  PROCESSING: "processing",
  PROCESSED: "processed",
  REQUIRES_REVIEW: "requires_review",
  PARTIAL: "partial",
  ERROR: "error",
  DUPLICATE: "duplicate",
} as const;

export type SourceFileStatus = (typeof SOURCE_FILE_STATUS)[keyof typeof SOURCE_FILE_STATUS];

/** Estados terminales: el worker ya no va a mover el archivo de acá. */
export const TERMINAL_SOURCE_FILE_STATUS: readonly string[] = [
  SOURCE_FILE_STATUS.PROCESSED,
  SOURCE_FILE_STATUS.REQUIRES_REVIEW,
  SOURCE_FILE_STATUS.PARTIAL,
  SOURCE_FILE_STATUS.ERROR,
  SOURCE_FILE_STATUS.DUPLICATE,
];

/** Los 5 campos que extrae el OCR (PRD §4). */
export interface DeliveryNote {
  id: string;
  source_file_id: string;
  cliente: string | null;
  numero_cliente: string | null;
  /** ISO-8601 con offset (`TIMESTAMPTZ`). Se muestra en hora de Buenos Aires. */
  fecha_hora: string | null;
  numero_remito: string | null;
  comentarios: string | null;
  status: string;
  page_number: number | null;
  detection_index: number | null;
  manually_reviewed: boolean;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** Body de `PATCH /api/v1/remitos/{id}` — parcial sobre los 5 campos. */
export interface DeliveryNotePatch {
  cliente?: string | null;
  numero_cliente?: string | null;
  fecha_hora?: string | null;
  numero_remito?: string | null;
  comentarios?: string | null;
}

/** Archivo subido (`source_files`), tal como lo devuelve `GET /api/v1/uploads/{id}`. */
export interface SourceFile {
  id: string;
  original_filename: string;
  mime_type?: string | null;
  original_size_bytes?: number | null;
  optimized_size_bytes?: number | null;
  status: string;
  detected_remitos?: number | null;
  attempts?: number | null;
  error_message: string | null;
  created_at?: string | null;
  processed_at?: string | null;
}

/** Item de la respuesta inicial de `POST /api/v1/uploads` (PRD §17). */
export interface UploadedFile {
  id: string;
  filename: string;
  status: string;
  /** Dedup nivel 1: id del `source_file` que ya tenía este sha256 (PRD §14). */
  duplicate_of?: string | null;
  error?: string | null;
}

export interface UploadResponse {
  files: UploadedFile[];
}

/** `GET /api/v1/remitos/stats` — counts del Dashboard. */
export interface RemitoStats {
  total: number;
  remitos_by_status: Record<string, number>;
  source_files_by_status: Record<string, number>;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  last_login_at?: string | null;
}

export interface RemitosQuery {
  status?: string;
  q?: string;
  /** Filtro dedicado por cliente (`ILIKE`). Se combina con AND, no reemplaza a `q`. */
  cliente?: string;
  /** `DD/MM/YYYY` — el backend lo interpreta en hora de Buenos Aires. */
  fecha_desde?: string;
  /** `DD/MM/YYYY` — inclusivo. */
  fecha_hasta?: string;
  limit?: number;
  offset?: number;
}

/**
 * Item de `POST /api/v1/remitos/share-links`.
 *
 * `url` es un link corto y permanente (`{PUBLIC_BASE_URL}/s/{code}`): nunca
 * vence, y cada click redirige a una URL prefirmada de MinIO fresca, generada
 * al momento (la firma dura segundos, no el link).
 */
export interface RemitoShareLink {
  id: string;
  cliente: string | null;
  numero_remito: string | null;
  fecha_hora: string | null;
  url: string;
}
