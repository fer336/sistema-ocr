import { useEffect } from "react";
import { DocumentPreview } from "./DocumentPreview";
import type { DeliveryNote } from "../types";

interface DocumentPreviewModalProps {
  remito: DeliveryNote;
  onClose: () => void;
}

/**
 * Ver el archivo desde la tabla sin salir de la app. Evitamos `window.open`
 * después de un `await` porque los bloqueadores de popups lo cancelan.
 */
export function DocumentPreviewModal({ remito, onClose }: DocumentPreviewModalProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">
            {remito.numero_remito ?? "Remito sin número"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-ink-muted transition hover:bg-surface-raised hover:text-ink"
          >
            Cerrar
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          <DocumentPreview remitoId={remito.id} className="max-h-[70vh]" />
        </div>
      </div>
    </div>
  );
}
