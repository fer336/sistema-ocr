import { useEffect, useState } from "react";
import { deleteUpload, listUploads, reprocessUpload } from "../lib/api";
import { formatFechaHora } from "../lib/datetime";
import { SOURCE_FILE_STATUS, type SourceFile } from "../types";

/**
 * Archivos que fallaron el OCR por completo (PRD §11: `source_files.status
 * = "error"`). No existen como remito: si el OCR nunca extrajo nada, nunca
 * se creó un `DeliveryNote`, así que `GET /remitos` jamás los devuelve por
 * más filtro que se use. El Dashboard cuenta este estado; esta pantalla es
 * lo único que permite verlos y reprocesarlos.
 */
export function Errores() {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listUploads({ status: SOURCE_FILE_STATUS.ERROR })
      .then((data) => {
        if (active) setFiles(data);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleReprocess(file: SourceFile) {
    setReprocessingId(file.id);
    try {
      await reprocessUpload(file.id);
      // Reprocesar pone el archivo en "pending" -- ya no es un error, sale
      // de esta lista. El worker lo va a tomar solo en su próximo poll.
      setFiles((current) => current.filter((f) => f.id !== file.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reencolar el archivo");
    } finally {
      setReprocessingId(null);
    }
  }

  async function handleDelete(file: SourceFile) {
    if (!window.confirm(`¿Eliminar "${file.original_filename}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    setDeletingId(file.id);
    try {
      await deleteUpload(file.id);
      setFiles((current) => current.filter((f) => f.id !== file.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el archivo");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Archivos con error</h2>
        <p className="text-sm text-ink-muted">
          Archivos que fallaron el OCR por completo y nunca llegaron a generar un remito.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-error/30 bg-error-soft px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-ink-muted">Cargando...</p>
      ) : files.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface py-8 text-center text-sm text-ink-muted shadow-sm">
          No hay archivos con error.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-sm">
          {files.map((file) => (
            <li key={file.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{file.original_filename}</p>
                <p className="text-sm text-error">{file.error_message ?? "Sin detalle del error"}</p>
                <p className="text-xs text-ink-muted">
                  Subido {formatFechaHora(file.created_at ?? null)} · intento{" "}
                  {file.attempts ?? 0}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void handleReprocess(file)}
                  disabled={reprocessingId === file.id || deletingId === file.id}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-surface-raised disabled:opacity-40"
                >
                  {reprocessingId === file.id ? "Reencolando..." : "Reprocesar"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(file)}
                  disabled={reprocessingId === file.id || deletingId === file.id}
                  className="rounded-lg border border-error/40 bg-surface px-3 py-1.5 text-sm font-medium text-error transition hover:bg-error-soft disabled:opacity-40"
                >
                  {deletingId === file.id ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
