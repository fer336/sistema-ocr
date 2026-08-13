import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { getFileUrl, looksLikePdf } from "../lib/files";

interface DocumentPreviewProps {
  remitoId: string;
  className?: string;
}

/**
 * Resuelve la URL prefirmada de MinIO on-demand (nunca eager por fila de tabla)
 * y muestra el documento embebido: `<img>` para imágenes, `<iframe>` para PDF.
 */
export function DocumentPreview({ remitoId, className }: DocumentPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setUrl(null);

    getFileUrl(remitoId)
      .then((resolved) => {
        if (active) setUrl(resolved);
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
  }, [remitoId]);

  const frameClasses = cn(
    "flex min-h-64 w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-raised",
    className
  );

  if (loading) {
    return (
      <div className={frameClasses}>
        <p className="p-6 text-sm text-ink-muted">Cargando documento...</p>
      </div>
    );
  }

  if (error || !url) {
    return (
      <div className={frameClasses}>
        <p className="p-6 text-center text-sm text-ink-muted">
          No se pudo cargar el documento.
          {error && <span className="mt-1 block text-xs text-error">{error}</span>}
        </p>
      </div>
    );
  }

  return (
    <div className={cn(frameClasses, "flex-col items-stretch")}>
      {looksLikePdf(url) ? (
        <iframe src={url} title="Documento del remito" className="h-full min-h-96 w-full" />
      ) : (
        <img src={url} alt="Documento del remito" className="h-full w-full object-contain" />
      )}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="border-t border-border bg-surface px-3 py-2 text-center text-sm font-medium text-primary hover:underline"
      >
        Abrir en pestaña nueva
      </a>
    </div>
  );
}
