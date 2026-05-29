-- =========================================================================
-- TOPS NEXUS — Centro Documental con OCR
-- =========================================================================

do $$ begin
  create type document_type_t as enum (
    'factura',
    'remito',
    'contrato',
    'habilitacion',
    'certificado',
    'auditoria',
    'presupuesto',
    'orden_compra',
    'orden_servicio',
    'constancia_afip',
    'otro'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  /** Tipo clasificado por IA. */
  type document_type_t not null default 'otro',
  /** Título o número identificador del doc. */
  title text not null,
  /** Resumen ejecutivo generado por IA. */
  summary text,
  /** Fecha emisión. */
  doc_date date,
  /** Fecha de vencimiento (si aplica). */
  expires_at date,
  /** Vendor / cliente vinculado (opcional). */
  vendor_id uuid references public.vendors(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  /** Path en Storage (bucket attachments o po-pdfs). */
  storage_bucket text not null default 'attachments',
  storage_path text not null,
  /** Tipo MIME del archivo. */
  mime_type text not null,
  file_size bigint not null default 0,
  /** Hash SHA-256 del archivo para detectar duplicados. */
  file_hash text,
  /** Extracción estructurada por IA (JSON con shape ExtractedDocument). */
  extract jsonb,
  /** Texto bruto para full-text search. */
  raw_text text,
  /** Tags manuales o sugeridos. */
  tags text[] not null default '{}',
  /** Origen: upload, oc_pdf, sync_drive, scanner_mobile. */
  source text not null default 'upload',
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references auth.users(id) on delete set null,
  /** Tokens consumidos por OpenAI para extracción. */
  ai_tokens_used int default 0,
  ai_model text,
  unique (storage_bucket, storage_path)
);

create index if not exists documents_type_idx on public.documents(type);
create index if not exists documents_date_idx on public.documents(doc_date desc);
create index if not exists documents_vendor_idx on public.documents(vendor_id);
create index if not exists documents_client_idx on public.documents(client_id);
create index if not exists documents_expires_idx on public.documents(expires_at) where expires_at is not null;
create index if not exists documents_tags_idx on public.documents using gin(tags);
-- Full-text search index sobre raw_text + title + summary
create index if not exists documents_fts_idx on public.documents using gin(
  to_tsvector('spanish', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(raw_text,''))
);

-- RLS
alter table public.documents enable row level security;

drop policy if exists "docs read auth" on public.documents;
create policy "docs read auth"
  on public.documents for select
  using (auth.role() = 'authenticated');

drop policy if exists "docs insert auth" on public.documents;
create policy "docs insert auth"
  on public.documents for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "docs update internal" on public.documents;
create policy "docs update internal"
  on public.documents for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "docs delete admin" on public.documents;
create policy "docs delete admin"
  on public.documents for delete
  using (public.current_role() = 'admin');

-- Bucket público para documentos (URL firmadas opcional en F3)
insert into storage.buckets (id, name, public) values ('documents', 'documents', true)
on conflict (id) do nothing;

drop policy if exists "documents bucket internal write" on storage.objects;
create policy "documents bucket internal write"
  on storage.objects for all
  using (
    bucket_id = 'documents'
    and auth.role() = 'authenticated'
  )
  with check (
    bucket_id = 'documents'
    and auth.role() = 'authenticated'
  );

notify pgrst, 'reload schema';
