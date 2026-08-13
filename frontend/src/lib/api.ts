import type {
  DeliveryNote,
  DeliveryNotePatch,
  RemitoShareLink,
  RemitoStats,
  RemitosQuery,
  SourceFile,
  UploadResponse,
} from "../types";

/**
 * En producción nginx proxea `/api` → `http://backend:8000`, así que la base
 * relativa alcanza. `VITE_API_URL` permite apuntar a otro host en desarrollo.
 */
export const API_BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export const LOGIN_PATH = "/login";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/**
 * El `AuthProvider` registra acá qué hacer cuando la sesión muere. Así el
 * redirect a `/login` lo hace el router (sin recargar la página y sin riesgo de
 * loop si el backend responde 401 en unos endpoints y 200 en otros).
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function handleUnauthorized(): void {
  if (unauthorizedHandler) {
    unauthorizedHandler();
    return;
  }
  // Fallback si todavía no montó el provider.
  if (typeof window === "undefined") return;
  if (window.location.pathname === LOGIN_PATH) return;
  window.location.assign(LOGIN_PATH);
}

/**
 * Wrapper único de `fetch`:
 * - `credentials: "include"` siempre — la sesión vive en una cookie httpOnly.
 * - `Content-Type: application/json` solo cuando el body NO es `FormData`
 *   (si lo forzamos, el browser no puede escribir el boundary del multipart).
 * - 401 fuera de `/auth/*` = sesión caída → redirect a `/login`.
 */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const body = init?.body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  if (body !== undefined && body !== null && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/")) {
      handleUnauthorized();
    }
    const detail = await readErrorDetail(response);
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function readErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown };
    const detail = parsed.detail ?? parsed.message;
    if (typeof detail === "string" && detail) return detail;
  } catch {
    // El body no era JSON: devolvemos el texto crudo.
  }
  return text;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

/* ------------------------------------------------------------------ remitos */

/**
 * `GET /api/v1/remitos` acepta `status`, `q` (busca en los 5 campos), `cliente`,
 * `fecha_desde`/`fecha_hasta` (`DD/MM/YYYY`), `limit` y `offset`, así que un solo
 * endpoint cubre listado + búsqueda + filtros + paginación.
 *
 * Todos los filtros se combinan con AND en el backend: `cliente` y el rango de
 * fechas NO reemplazan a `q`, lo acotan.
 */
export function listRemitos(params: RemitosQuery = {}): Promise<DeliveryNote[]> {
  const query = buildQuery({
    status: params.status,
    q: params.q?.trim(),
    cliente: params.cliente?.trim(),
    fecha_desde: params.fecha_desde,
    fecha_hasta: params.fecha_hasta,
    limit: params.limit,
    offset: params.offset,
  });
  return apiRequest<DeliveryNote[]>(`/remitos${query}`);
}

/**
 * `POST /api/v1/remitos/share-links` — devuelve un link prefirmado por remito
 * para armar el mensaje de WhatsApp. Los links vencen a los 7 días (máximo real
 * de una firma SigV4 de S3/MinIO), y eso se aclara en el texto compartido.
 */
export function createShareLinks(remitoIds: string[]): Promise<RemitoShareLink[]> {
  return apiRequest<RemitoShareLink[]>("/remitos/share-links", {
    method: "POST",
    body: JSON.stringify({ remito_ids: remitoIds }),
  });
}

export function getRemitoStats(): Promise<RemitoStats> {
  return apiRequest<RemitoStats>("/remitos/stats");
}

export function getRemito(id: string): Promise<DeliveryNote> {
  return apiRequest<DeliveryNote>(`/remitos/${id}`);
}

export function patchRemito(id: string, payload: DeliveryNotePatch): Promise<DeliveryNote> {
  return apiRequest<DeliveryNote>(`/remitos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function approveRemito(id: string): Promise<DeliveryNote> {
  return apiRequest<DeliveryNote>(`/remitos/${id}/approve`, { method: "POST" });
}

export function reprocessRemito(id: string): Promise<DeliveryNote> {
  return apiRequest<DeliveryNote>(`/remitos/${id}/reprocess`, { method: "POST" });
}

/**
 * `DELETE /api/v1/remitos/{id}` — 204 sin body. Si era el único remito de su
 * archivo, el backend borra también el archivo (fila + binarios en MinIO);
 * si no, solo borra este remito puntual.
 */
export function deleteRemito(id: string): Promise<void> {
  return apiRequest<void>(`/remitos/${id}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ uploads */

/**
 * `POST /api/v1/uploads` — multipart. El campo se repite una vez por archivo
 * (`files`), y NO seteamos `Content-Type`: lo escribe el browser con boundary.
 */
export function uploadFiles(files: File[]): Promise<UploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }
  return apiRequest<UploadResponse>("/uploads", { method: "POST", body: formData });
}

/**
 * `GET /api/v1/uploads` — lista archivos (`source_files`), no remitos. Existe
 * sobre todo para poder ver los que quedaron en `error`: nunca llegan a tener
 * un remito asociado, así que `listRemitos` jamás los va a devolver.
 */
export function listUploads(params: { status?: string; limit?: number } = {}): Promise<SourceFile[]> {
  const query = buildQuery({ status: params.status, limit: params.limit });
  return apiRequest<SourceFile[]>(`/uploads${query}`);
}

export function getUploadStatus(sourceFileId: string): Promise<SourceFile> {
  return apiRequest<SourceFile>(`/uploads/${sourceFileId}`);
}

export function reprocessUpload(sourceFileId: string): Promise<SourceFile> {
  return apiRequest<SourceFile>(`/uploads/${sourceFileId}/reprocess`, { method: "POST" });
}

/**
 * `DELETE /api/v1/uploads/{id}` — 204 sin body. Para archivos en `error`:
 * nunca tuvieron `DeliveryNote`, así que acá se borra el `SourceFile` directo
 * (a diferencia de `deleteRemito`, no hay nada que desvincular primero).
 */
export function deleteUpload(sourceFileId: string): Promise<void> {
  return apiRequest<void>(`/uploads/${sourceFileId}`, { method: "DELETE" });
}
