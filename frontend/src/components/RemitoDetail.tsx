import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { approveRemito, patchRemito, reprocessRemito } from "../lib/api";
import { drivePreviewUrl } from "../lib/drive";
import type { DeliveryNote, DeliveryNotePatch } from "../types";

interface RemitoDetailProps {
  remito: DeliveryNote;
  onClose: () => void;
  onUpdated: (remito: DeliveryNote) => void;
}

export function RemitoDetail({ remito, onClose, onUpdated }: RemitoDetailProps) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<DeliveryNotePatch>({
    document_number: remito.document_number ?? "",
    document_date: remito.document_date ?? "",
    client_name: remito.client_name ?? "",
  });
  const [busy, setBusy] = useState(false);
  const previewUrl = drivePreviewUrl(remito.drive_file_link);

  async function handleSave() {
    setBusy(true);
    try {
      const updated = await patchRemito(remito.id, form);
      onUpdated(updated);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    setBusy(true);
    try {
      const updated = await approveRemito(remito.id);
      onUpdated(updated);
    } finally {
      setBusy(false);
    }
  }

  async function handleReprocess() {
    setBusy(true);
    try {
      const updated = await reprocessRemito(remito.id);
      onUpdated(updated);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/45">
      <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-surface">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              Remito {remito.document_number ?? "sin número"}
            </h2>
            <StatusBadge status={remito.status} />
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-surface px-2 py-1 text-ink-muted transition hover:bg-slate-50 hover:text-ink"
          >
            Cerrar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {previewUrl ? (
            <iframe
              src={previewUrl}
              title="Vista previa del remito"
              className="mb-4 h-72 w-full rounded-lg border border-slate-200 bg-surface"
            />
          ) : (
            <p className="mb-4 text-sm text-ink-muted">Sin vista previa disponible.</p>
          )}

          {remito.drive_file_link && (
            <a
              href={remito.drive_file_link}
              target="_blank"
              rel="noreferrer"
              className="mb-4 inline-block text-sm font-medium text-primary hover:underline"
            >
              Abrir en Google Drive
            </a>
          )}

          {editing ? (
            <div className="space-y-3">
              <Field
                label="Número de remito"
                value={form.document_number ?? ""}
                onChange={(v) => setForm({ ...form, document_number: v })}
              />
              <Field
                label="Fecha"
                type="date"
                value={form.document_date ?? ""}
                onChange={(v) => setForm({ ...form, document_date: v })}
              />
              <Field
                label="Cliente"
                value={form.client_name ?? ""}
                onChange={(v) => setForm({ ...form, client_name: v })}
              />
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <DetailField label="N.° cliente" value={remito.client_number} />
              <DetailField label="Cliente" value={remito.client_name} />
              <DetailField label="Número de remito" value={remito.document_number} />
              <DetailField label="Fecha y hora" value={formatDateTime(remito.document_date, remito.document_time)} />
              <DetailField label="Confianza" value={remito.confidence ?? "—"} />
            </dl>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-200 px-6 py-4">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={busy}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
              >
                Guardar
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={busy}
                className="rounded-lg border border-slate-300 bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="rounded-lg border border-slate-300 bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-slate-50"
              >
                Editar
              </button>
              <button
                onClick={handleApprove}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                Aprobar
              </button>
              <button
                onClick={handleReprocess}
                disabled={busy}
                className="rounded-lg border border-slate-300 bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-slate-50 disabled:opacity-50"
              >
                Reprocesar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}

function Field({ label, value, onChange, type = "text" }: FieldProps) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-ink placeholder:text-ink-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </label>
  );
}

interface DetailFieldProps {
  label: string;
  value: string | null;
}

function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink">{value ?? "—"}</dd>
    </div>
  );
}

function formatDateTime(date: string | null, time: string | null): string | null {
  if (!date && !time) return null;
  const formattedDate = date
    ? new Date(date).toLocaleDateString("es-AR", { timeZone: "UTC" })
    : "";
  return [formattedDate, time].filter(Boolean).join(" ");
}
