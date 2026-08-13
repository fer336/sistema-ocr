import { apiRequest } from "./api";

interface FileUrlResponse {
  url: string;
}

/**
 * Las URLs prefirmadas de MinIO expiran (PRD §23,
 * `MINIO_PRESIGNED_EXPIRES_SECONDS=900`). Cacheamos con un TTL bien por debajo
 * de eso para no pedir una URL nueva por cada render, pero sin servir una
 * vencida.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

/**
 * URL temporal del documento original del remito.
 * Se resuelve on-demand (detalle / revisión / hover en la tabla), nunca de
 * forma eager por cada fila del listado.
 */
export function getFileUrl(remitoId: string): Promise<string> {
  const cached = cache.get(remitoId);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.url);
  }

  const pending = inFlight.get(remitoId);
  if (pending) return pending;

  const request = apiRequest<FileUrlResponse>(`/remitos/${remitoId}/file-url`)
    .then((payload) => {
      if (!payload?.url) {
        throw new Error("El backend no devolvió una URL de archivo.");
      }
      cache.set(remitoId, { url: payload.url, expiresAt: Date.now() + CACHE_TTL_MS });
      return payload.url;
    })
    .finally(() => {
      inFlight.delete(remitoId);
    });

  inFlight.set(remitoId, request);
  return request;
}

/** Calienta el cache sin propagar errores (hover/focus en la tabla). */
export function prefetchFileUrl(remitoId: string): void {
  void getFileUrl(remitoId).catch(() => undefined);
}

/** Heurística para decidir entre `<img>` e `<iframe>` en el preview. */
export function looksLikePdf(url: string, filename?: string | null): boolean {
  if (filename?.toLowerCase().endsWith(".pdf")) return true;
  try {
    return new URL(url, window.location.origin).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return url.toLowerCase().includes(".pdf");
  }
}
