export const REMITO_STATUS = {
  PROCESSED: "processed",
  REQUIRES_REVIEW: "requires_review",
  DUPLICATE: "duplicate",
} as const;

export type RemitoStatus = (typeof REMITO_STATUS)[keyof typeof REMITO_STATUS];

export interface DeliveryNote {
  id: string;
  document_number: string | null;
  document_date: string | null;
  document_time: string | null;
  client_number: string | null;
  client_name: string | null;
  confidence: string | null;
  status: string;
  drive_file_link: string | null;
  created_at: string;
}

export interface Client {
  id: string;
  client_number: string;
  client_name: string;
  drive_folder_id: string | null;
  drive_folder_link: string | null;
  created_at: string;
}

export interface DeliveryNotePatch {
  document_number?: string;
  document_date?: string;
  client_name?: string;
}
