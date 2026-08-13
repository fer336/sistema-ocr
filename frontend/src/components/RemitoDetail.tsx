import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { DocumentPreview } from "./DocumentPreview";
import { approveRemito, patchRemito, reprocessRemito } from "../lib/api";
import { fromDatetimeLocalValue, formatFechaHora, toDatetimeLocalValue } from "../lib/datetime";
import type { DeliveryNote, DeliveryNotePatch } from "../types";

interface RemitoDetailProps {
  remito: DeliveryNote;
  onUpdated: (remito: DeliveryNote) => void;
  /** La pantalla de revisión entra directo en modo edición. */
  startEditing?: boolean;
  /** Etiqueta del botón de aprobación (Revisión usa "Aprobar y siguiente"). */
  approveLabel?: string;
}

interface FormState {
  cliente: string;
  numero_cliente: string;
  fecha_hora: string;
  numero_remito: string;
  comentarios: string;
}

function toFormState(remito: DeliveryNote): FormState {
  return {
    cliente: remito.cliente ?? "",
    numero_cliente: remito.numero_cliente ?? "",
    fecha_hora: toDatetimeLocalValue(remito.fecha_hora),
    numero_remito: remito.numero_remito ?? "",
    comentarios: remito.comentarios ?? "",
  };
}

function toPatch(form: FormState): DeliveryNotePatch {
  const text = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    cliente: text(form.cliente),
    numero_cliente: text(form.numero_cliente),
    // `numero_remito` se manda tal cual (solo trim): PRD §4 prohíbe reestructurarlo.
    numero_remito: text(form.numero_remito),
    comentarios: text(form.comentarios),
    fecha_hora: fromDatetimeLocalValue(form.fecha_hora),
  };
}

/**
 * Detalle de un remito: documento a la izquierda, los 5 campos a la derecha
 * (PRD §18 pantalla 3). En mobile se apila.
 */
export function RemitoDetail({
  remito,
  onUpdated,
  startEditing = false,
  approveLabel = "Aprobar",
}: RemitoDetailProps) {
  const [editing, setEditing] = useState(startEditing);
  const [form, setForm] = useState<FormState>(() => toFormState(remito));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<DeliveryNote>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      onUpdated(updated);
      return updated;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    const updated = await run(() => patchRemito(remito.id, toPatch(form)));
    if (updated) {
      setForm(toFormState(updated));
      setEditing(false);
    }
  }

  function handleCancel() {
    setForm(toFormState(remito));
    setEditing(false);
    setError(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <DocumentPreview remitoId={remito.id} className="lg:sticky lg:top-6" />

      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-ink-muted">Remito</p>
            <h2 className="text-lg font-semibold text-ink">
              {remito.numero_remito ?? "Sin número"}
            </h2>
          </div>
          <StatusBadge status={remito.status} />
        </div>

        {error && (
          <p className="rounded-lg border border-error/30 bg-error-soft px-4 py-3 text-sm text-error">
            {error}
          </p>
        )}

        {editing ? (
          <div className="space-y-3">
            <Field
              label="Cliente"
              value={form.cliente}
              onChange={(value) => setForm({ ...form, cliente: value })}
            />
            <Field
              label="Número de cliente"
              value={form.numero_cliente}
              onChange={(value) => setForm({ ...form, numero_cliente: value })}
              hint="Conservar los ceros iniciales."
            />
            <Field
              label="Fecha y hora"
              type="datetime-local"
              value={form.fecha_hora}
              onChange={(value) => setForm({ ...form, fecha_hora: value })}
              hint="Hora de Buenos Aires."
            />
            <Field
              label="Número de remito"
              value={form.numero_remito}
              onChange={(value) => setForm({ ...form, numero_remito: value })}
              hint='Identificador completo, por ejemplo "B 5001 00139454".'
            />
            <Field
              label="Comentarios"
              multiline
              value={form.comentarios}
              onChange={(value) => setForm({ ...form, comentarios: value })}
            />
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
            <DetailField label="Cliente" value={remito.cliente} />
            <DetailField label="Número de cliente" value={remito.numero_cliente} />
            <DetailField label="Fecha y hora" value={formatFechaHora(remito.fecha_hora)} />
            <DetailField label="Número de remito" value={remito.numero_remito} />
            <DetailField label="Comentarios" value={remito.comentarios} className="sm:col-span-2" />
            <DetailField
              label="Revisado manualmente"
              value={remito.manually_reviewed ? "Sí" : "No"}
            />
            <DetailField
              label="Página / detección"
              value={`${remito.page_number ?? "—"} / ${remito.detection_index ?? "—"}`}
            />
          </dl>
        )}

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {editing ? (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={busy}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={busy}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface-raised disabled:opacity-50"
              >
                Cancelar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface-raised"
            >
              Editar
            </button>
          )}
          <button
            type="button"
            onClick={() => void run(() => approveRemito(remito.id))}
            disabled={busy}
            className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {approveLabel}
          </button>
          <button
            type="button"
            onClick={() => void run(() => reprocessRemito(remito.id))}
            disabled={busy}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface-raised disabled:opacity-50"
          >
            Reprocesar
          </button>
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
  hint?: string;
  multiline?: boolean;
}

const FIELD_CLASSES =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink placeholder:text-ink-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary";

function Field({ label, value, onChange, type = "text", hint, multiline }: FieldProps) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink">{label}</span>
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD_CLASSES}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD_CLASSES}
        />
      )}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

interface DetailFieldProps {
  label: string;
  value: string | null;
  className?: string;
}

function DetailField({ label, value, className }: DetailFieldProps) {
  return (
    <div className={className}>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium break-words text-ink">{value ?? "—"}</dd>
    </div>
  );
}
