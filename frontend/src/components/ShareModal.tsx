import { useEffect, useState } from "react";
import { createShareLinks } from "../lib/api";
import { formatFechaHora } from "../lib/datetime";
import type { RemitoShareLink } from "../types";

interface ShareModalProps {
  remitoIds: string[];
  onClose: () => void;
  /** Se llama cuando el mensaje ya se armó y abrió: la lista limpia la selección. */
  onShared: () => void;
}

/** WhatsApp normaliza el número; solo hace falta quedarse con los dígitos. */
function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function buildMessage(links: RemitoShareLink[]): string {
  const header =
    links.length === 1 ? "Te comparto este remito:" : `Te comparto ${links.length} remitos:`;

  const items = links.map((link) => {
    const numero = link.numero_remito ? `Remito N.º ${link.numero_remito}` : "Remito sin número";
    const cliente = link.cliente ?? "Sin cliente";
    return `${numero}\n${cliente} · ${formatFechaHora(link.fecha_hora)}\n${link.url}`;
  });

  return [header, ...items].join("\n\n");
}

function buildWhatsappUrl(phoneDigits: string, message: string): string {
  const base = phoneDigits ? `https://wa.me/${phoneDigits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(message)}`;
}

/**
 * Paso final de "Compartir por WhatsApp": pide el teléfono (no se guarda en
 * ningún lado), pide los links al backend y abre WhatsApp con el mensaje ya
 * armado.
 *
 * No se puede adjuntar archivos a un chat desde la web — ninguna API lo
 * permite — así que lo que se comparte es texto con links cortos que
 * redirigen a una URL prefirmada fresca por click (nunca vencen).
 */
export function ShareModal({ remitoIds, onClose, onShared }: ShareModalProps) {
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Fallback: si el bloqueador de popups cancela el `window.open` posterior al
   * `await`, dejamos el link a la vista para que el usuario lo abra con un
   * click propio (mismo problema que documenta `DocumentPreviewModal`).
   */
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleShare() {
    setSending(true);
    setError(null);
    setBlockedUrl(null);

    try {
      const links = await createShareLinks(remitoIds);
      if (links.length === 0) {
        setError("El backend no devolvió links para los remitos seleccionados.");
        return;
      }

      const url = buildWhatsappUrl(normalizePhone(phone), buildMessage(links));
      const opened = window.open(url, "_blank", "noopener,noreferrer");

      if (!opened) {
        setBlockedUrl(url);
        return;
      }

      onShared();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Compartir por WhatsApp</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-ink-muted transition hover:bg-surface-raised hover:text-ink"
          >
            Cerrar
          </button>
        </div>

        <div className="space-y-4 p-4">
          <p className="text-sm text-ink-muted">
            Se va a abrir WhatsApp con un mensaje que incluye{" "}
            {remitoIds.length === 1 ? "1 remito" : `${remitoIds.length} remitos`} y su link de
            descarga. El link no vence.
          </p>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-muted">
              Teléfono del destinatario (con código de país)
            </span>
            <input
              type="tel"
              value={phone}
              autoFocus
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Ej: +54 9 11 5555 5555"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-xs text-ink-muted">
              Si lo dejás vacío, WhatsApp abre y te deja elegir el contacto.
            </span>
          </label>

          {error && (
            <p className="rounded-lg border border-error/30 bg-error-soft px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}

          {blockedUrl && (
            <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
              El navegador bloqueó la ventana nueva.{" "}
              <a
                href={blockedUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onShared}
                className="font-medium underline"
              >
                Abrir WhatsApp
              </a>
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface-raised"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleShare()}
            disabled={sending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
          >
            {sending ? "Generando links..." : "Abrir WhatsApp"}
          </button>
        </div>
      </div>
    </div>
  );
}
