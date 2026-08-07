import type { Client, DeliveryNote, DeliveryNotePatch } from "../types";

const API_BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }

  return response.json() as Promise<T>;
}

export function listRemitos(status?: string): Promise<DeliveryNote[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<DeliveryNote[]>(`/remitos${query}`);
}

export function searchRemitos(query: string): Promise<DeliveryNote[]> {
  return request<DeliveryNote[]>(`/remitos/search?q=${encodeURIComponent(query)}`);
}

export function getRemito(id: string): Promise<DeliveryNote> {
  return request<DeliveryNote>(`/remitos/${id}`);
}

export function patchRemito(id: string, payload: DeliveryNotePatch): Promise<DeliveryNote> {
  return request<DeliveryNote>(`/remitos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function approveRemito(id: string): Promise<DeliveryNote> {
  return request<DeliveryNote>(`/remitos/${id}/approve`, { method: "POST" });
}

export function reprocessRemito(id: string): Promise<DeliveryNote> {
  return request<DeliveryNote>(`/remitos/${id}/reprocess`, { method: "POST" });
}

export function listClients(): Promise<Client[]> {
  return request<Client[]>("/clients");
}
