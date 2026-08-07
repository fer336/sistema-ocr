import { StatusBadge } from "./StatusBadge";
import type { DeliveryNote } from "../types";

interface RemitosTableProps {
  remitos: DeliveryNote[];
  onSelect: (remito: DeliveryNote) => void;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-AR", { timeZone: "UTC" });
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
}

export function RemitosTable({ remitos, onSelect }: RemitosTableProps) {
  if (remitos.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-muted">No se encontraron remitos.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-surface">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-slate-500">Estado</th>
            <th className="px-4 py-2 text-left font-medium text-slate-500">Fecha</th>
            <th className="px-4 py-2 text-left font-medium text-slate-500">Remito</th>
            <th className="px-4 py-2 text-left font-medium text-slate-500">N.° cliente</th>
            <th className="px-4 py-2 text-left font-medium text-slate-500">Cliente</th>
            <th className="px-4 py-2 text-left font-medium text-slate-500">Hora</th>
            <th className="px-4 py-2 text-left font-medium text-slate-500">Archivo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {remitos.map((remito) => (
            <tr
              key={remito.id}
              className="cursor-pointer transition-colors hover:bg-slate-50"
              onClick={() => onSelect(remito)}
            >
              <td className="px-4 py-2">
                <StatusBadge status={remito.status} />
              </td>
              <td className="px-4 py-2 text-ink">{formatDate(remito.document_date)}</td>
              <td className="px-4 py-2 text-ink">{remito.document_number ?? "—"}</td>
              <td className="px-4 py-2 text-ink">{remito.client_number ?? "—"}</td>
              <td className="px-4 py-2 text-ink">{remito.client_name ?? "—"}</td>
              <td className="px-4 py-2 text-ink">{formatTime(remito.document_time)}</td>
              <td className="px-4 py-2">
                {remito.drive_file_link ? (
                  <a
                    href={remito.drive_file_link}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="font-medium text-primary hover:underline"
                  >
                    Ver
                  </a>
                ) : (
                  <span className="text-ink-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}