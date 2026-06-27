/**
 * Tipos del dominio Clientify v1 — derivados de respuestas reales del API.
 * Fuente: https://api.clientify.net/v1/ (auth: `Authorization: Token <api-key>`).
 *
 * Las propiedades opcionales (?) son aquellas que vimos null/undefined en
 * respuestas reales del tenant Logística TOPS.
 */

export interface ClientifyPaginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ------------------------------------------------------------------
// CONTACTS
// ------------------------------------------------------------------

export interface ClientifyContactEmail {
  id: number;
  type: number;
  email: string;
}

export interface ClientifyContactPhone {
  id: number;
  type: number;
  phone: string;
  unsubscribed: boolean;
}

export interface ClientifyContactAddress {
  id?: number;
  type?: number;
  street?: string;
  city?: string;
  country?: string;
  zip?: string;
}

export interface ClientifyContact {
  url: string;
  id: number;
  owner: string | null;
  owner_name: string | null;
  first_name: string;
  last_name: string;
  status: string;
  title: string;
  company: string | null; // URL al recurso company en la API
  company_name: string | null; // Razón social (viene en el payload del contacto)
  taxpayer_identification_number: string;
  medium: string;
  channel: string;
  contact_source: string | null;
  emails: ClientifyContactEmail[];
  phones: ClientifyContactPhone[];
  addresses: ClientifyContactAddress[];
  picture_url: string | null;
  custom_fields: Array<{ id: number; name: string; value: string | number | null }>;
  tags: string[];
  created?: string;
  modified?: string;
}

// ------------------------------------------------------------------
// COMPANIES
// ------------------------------------------------------------------

export interface ClientifyCompany {
  url: string;
  id: number;
  name: string;
  website?: string;
  taxpayer_identification_number?: string;
  industry?: string;
  size?: string;
  phone?: string;
  email?: string;
  tags?: string[];
  custom_fields?: Array<{ id: number; name: string; value: string | number | null }>;
  created?: string;
  modified?: string;
  owner?: string;
  owner_name?: string;
}

// ------------------------------------------------------------------
// DEALS / PIPELINES / STAGES
// ------------------------------------------------------------------

export interface ClientifyStage {
  url: string;
  id: number;
  pipeline: string;
  pipeline_desc: string;
  name: string;
  position: number;
  probability: number;
}

export interface ClientifyPipeline {
  url: string;
  id: number;
  user_company: string;
  name: string;
  stages: ClientifyStage[];
  is_default: boolean;
  user_default: boolean;
}

export interface ClientifyDeal {
  url: string;
  id: number;
  owner_name: string | null;
  name: string;
  contact: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_medium: string | null;
  contact_source: string | null;
  company: string | null;
  company_name: string | null;
  amount: string; // viene como string con decimales
  amount_user: string | null;
  currency: string;
  status: number; // 1=Open, 2=Won, 3=?, 4=Lost
  status_desc: "Open" | "Won" | "Lost" | string;
  probability: number;
  probability_desc: string;
  pipeline_stage: string;
  pipeline: string;
  pipeline_desc: string;
  pipeline_stage_desc: string;
  tags: string[];
  custom_fields: Array<{ id: number; name: string; value: string | number | null }>;
  created: string;
  modified: string;
  expected_closed_date: string | null;
  actual_closed_date: string | null;
  deal_source: string | null;
  // Solo disponible en GET /deals/{id}/ (endpoint individual, NO en la lista).
  // Nexus lo enriquece haciendo un fetch adicional para cada deal perdido en el sync.
  lost_reason?: string | null;
}

// ------------------------------------------------------------------
// ACTIVITIES (tareas y notas)
// ------------------------------------------------------------------

export interface ClientifyActivity {
  url: string;
  id: number;
  type: "task" | "meeting" | "call" | "email" | "note" | string;
  subject: string;
  description?: string;
  contact?: string;
  deal?: string;
  owner?: string;
  owner_name?: string;
  status?: "pending" | "done" | string;
  due_date?: string;
  completed?: string;
  created: string;
  modified: string;
}
