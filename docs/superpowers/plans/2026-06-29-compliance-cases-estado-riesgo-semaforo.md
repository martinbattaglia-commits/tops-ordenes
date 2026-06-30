# Compliance · Casos regulatorios (Estado / Riesgo / Semáforo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el semáforo de Compliance refleje el estado regulatorio real (no sólo la fecha), incorporando casos regulatorios (`compliance_cases`) alimentados por una planilla central, con Estado/Riesgo/Semáforo separados y confianza por origen.

**Architecture:** Entidad nueva `compliance_cases` (estado administrativo + nivel de riesgo + origen/confianza) alimentada por el cron desde una Google Sheet (`00_ESTADO_COMPLIANCE`). El **color** se computa con una función pura `computeSemaforo(temporal, estado)` (el riesgo NO interviene en el color). La anticipación del aviso 🟡 es parametrizable (override de ítem → config por frecuencia → default). Diccionario de normalización por datos. Evidencia secundaria (docs/correos) sólo genera alertas de revisión, nunca muta estado.

**Tech Stack:** Next.js (App Router) · TypeScript · Supabase (Postgres + RLS) · Google Drive (service account) · vitest. Spec: [docs/superpowers/specs/2026-06-29-compliance-cases-estado-riesgo-semaforo-design.md](../specs/2026-06-29-compliance-cases-estado-riesgo-semaforo-design.md).

## Global Constraints

- **NO aplicar migraciones · NO mergear · NO pushear · NO deploy.** Todo queda en el worktree/rama `worktree-feat+compliance-cases-semaforo` hasta revisión final de Dirección.
- **Test runner:** `npx vitest run <archivo>` (config del repo: `npm test` = `vitest run`). Tests co-locados `*.test.ts`.
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`) debe pasar tras cada tarea que toque TS.
- **Migración:** archivo `supabase/migrations/0141_compliance_cases.sql` (renumerada `0125→0139→0141`; prod ya aplicó Knowledge `0125-0140`). **Re-verificar el número con `list_migrations` y usar max+1 al aplicar** (la cadena Knowledge crece en paralelo). Depende de `0081` (crea `compliance_alerts`).
- **El campo `ComplianceItem.riesgo` (Verde/Amarillo/Naranja/Rojo) ES el semáforo (color)** y lo consumen ~25 sitios (scoring/KPIs/timeline/UI). NO se renombra: lo computa la cascada nueva. El "nivel de riesgo" (bajo/medio/alto/critico) es un campo NUEVO y SEPARADO (`nivelRiesgo`), usado sólo para prioridad/orden/filtros.
- **Zona horaria AR** para fechas: reutilizar `todayAr()` / `diffDays()` existentes en `data.ts`.
- **Commits frecuentes**, uno por tarea, en español, sin co-author de máquinas externas. Formato sugerido: `feat(compliance): <tarea>`.
- **Batería de regresión permanente del motor** (`src/lib/compliance/derive.regression.test.ts`, Task 6R): matriz de 12 escenarios de negocio que `deriveComplianceStatus` DEBE satisfacer siempre. Es un gate obligatorio: ninguna tarea posterior avanza si no está 100% verde, y toda modificación futura del algoritmo debe seguir pasándola.

---

## File Structure

**Nuevos:**
- `supabase/migrations/0141_compliance_cases.sql` — tablas `compliance_cases`, `compliance_anticipacion_config` (+seed), `compliance_normalizacion` (+seed), **`compliance_evidence`** (D12); `compliance_items.anticipacion_dias`; alters de `compliance_alerts`.
- `src/lib/compliance/cases/types.ts` — enums y tipos del caso (`EstadoAdministrativo`, `Etapa`, `NivelRiesgo`, `Semaforo`, `Origen`, `Confianza`, `Temporal`, `ComplianceCase`, `ComplianceCaseLite`).
- `src/lib/compliance/cases/normalize.ts` (+ `.test.ts`) — diccionario por defecto + `normalizar(texto, dimension, dict?)`.
- `src/lib/compliance/cases/transitions.ts` (+ `.test.ts`) — **máquina de estados** (D11): `TRANSICIONES`, `canTransition(from, to)`.
- `src/lib/compliance/semaforo.ts` (+ `.test.ts`) — `temporalOf`, `resolveAnticipacion`, `computeSemaforo`, `alertSeverity`.
- `src/lib/compliance/cases/sheet.ts` (+ `.test.ts`) — `parseCsv`, `parseEstadoSheet(csv, dict, anticConfig)` → `{ rows, errors }`.
- `src/lib/compliance/cases/sync.ts` (+ `.test.ts`) — `syncCasesFromSheet(db, deps)`: lee Sheet, normaliza, **valida transición (D11)** y registra **evidencia (D12)** por cada cambio de estado aplicado.

**Modificados:**
- `src/lib/compliance/data.ts` — tipo `Semaforo`, extensión de `ComplianceItem` (campos del caso), refactor `deriveComplianceStatus`, `RISK_LABEL`, `executiveKpis`.
- `src/lib/compliance/source.ts` — join del caso activo por ítem.
- `src/lib/compliance/sync/engine.ts` — Paso 0 (planilla) + `rebuildAlerts` con cascada nueva + alertas `review`.
- `src/lib/env.ts` — `compliance.estadoSheetFileId`.
- `src/components/compliance/ui.tsx` + `src/app/(app)/anmat/page.tsx` — etiqueta 🟠, KPIs, panel del caso, solapa "Revisión".

---

## Task 1: Migración `0141_compliance_cases.sql`

**Files:**
- Create: `supabase/migrations/0141_compliance_cases.sql`

**Interfaces:**
- Produces (DB): tablas `compliance_cases`, `compliance_anticipacion_config`, `compliance_normalizacion`, `compliance_evidence`; columna `compliance_items.anticipacion_dias`; columnas `compliance_alerts.origen/confianza/case_id` + `kind='review'`.

- [ ] **Step 1: Escribir la migración completa**

Crear `supabase/migrations/0141_compliance_cases.sql`:

```sql
-- 0141_compliance_cases.sql
-- Casos regulatorios: estado administrativo + nivel de riesgo + origen/confianza.
-- Semáforo (color) = computado en runtime (no se almacena como verdad).
-- DEPENDE de 0081 (compliance_alerts/compliance_documents).
-- GATING: aplicación manual por Dirección. NO ejecutar automáticamente.

-- 1) Casos regulatorios -------------------------------------------------------
create table if not exists compliance_cases (
  id                     uuid primary key default gen_random_uuid(),
  item_id                text references compliance_items(id) on delete set null,
  sede                   text check (sede in ('MAGALDI','LUJAN')),
  tipo_certificado       text,
  expediente_nro         text,
  organismo              text,
  estado_administrativo  text not null default 'sin_iniciar'
                           check (estado_administrativo in
                           ('sin_iniciar','vigente','en_tramite','observado',
                            'pendiente_emision','aprobado','rechazado')),
  etapa                  text check (etapa in
                           ('iniciado','pronto_despacho','esperando_resolucion','subsanando')),
  nivel_riesgo           text check (nivel_riesgo in ('bajo','medio','alto','critico')),
  fecha_inicio           date,
  fecha_pronto_despacho  date,
  ultima_actuacion       text,
  ultima_actuacion_fecha date,
  proxima_accion         text,
  proxima_accion_fecha   date,
  observaciones          text,
  origen                 text not null default 'sheet'
                           check (origen in ('manual','sheet','documento','correo','ia','nombre_archivo')),
  confianza              text not null default 'confirmada'
                           check (confianza in ('confirmada','alta','media','baja')),
  confianza_score        numeric(4,3),
  activo                 boolean not null default true,
  row_hash               text,
  last_synced_at         timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists compliance_cases_item_idx   on compliance_cases(item_id);
create index if not exists compliance_cases_activo_idx  on compliance_cases(item_id) where activo;
create index if not exists compliance_cases_estado_idx  on compliance_cases(estado_administrativo);
create index if not exists compliance_cases_riesgo_idx  on compliance_cases(nivel_riesgo);

alter table compliance_cases enable row level security;
drop policy if exists compliance_cases_select on compliance_cases;
create policy compliance_cases_select on compliance_cases
  for select to authenticated using (true);
-- Escritura sólo service_role (el cron) / admin: sin policy de insert/update/delete
-- para roles autenticados ⇒ denegado por RLS; service_role bypassa RLS.

-- 2) Config de anticipación (parametrizable, sin código) -----------------------
create table if not exists compliance_anticipacion_config (
  frecuencia        text primary key,
  anticipacion_dias int not null,
  descripcion       text,
  updated_at        timestamptz not null default now()
);
insert into compliance_anticipacion_config (frecuencia, anticipacion_dias, descripcion) values
  ('Mensual',     7,   'Aviso 7 días antes'),
  ('Trimestral',  15,  'Aviso 15 días antes'),
  ('Semestral',   30,  'Aviso 30 días antes'),
  ('Anual',       60,  'Aviso 60 días antes'),
  ('Bienal',      90,  'Aviso 90 días antes'),
  ('Trienal',     120, 'Aviso 120 días antes'),
  ('Cuatrienal',  180, 'Aviso 180 días antes'),
  ('__default__', 60,  'Default del sistema cuando la frecuencia no matchea')
on conflict (frecuencia) do nothing;

alter table compliance_anticipacion_config enable row level security;
drop policy if exists compliance_antic_select on compliance_anticipacion_config;
create policy compliance_antic_select on compliance_anticipacion_config
  for select to authenticated using (true);

-- 3) Diccionario de normalización (extensible por filas) -----------------------
create table if not exists compliance_normalizacion (
  id             bigserial primary key,
  dimension      text not null check (dimension in ('estado','etapa','riesgo')),
  sinonimo       text not null,
  valor_canonico text not null,
  unique (dimension, sinonimo)
);
insert into compliance_normalizacion (dimension, sinonimo, valor_canonico) values
  ('estado','en elaboracion','en_tramite'),
  ('estado','en analisis','en_tramite'),
  ('estado','en estudio','en_tramite'),
  ('estado','en proceso','en_tramite'),
  ('estado','en tramite','en_tramite'),
  ('estado','pendiente de resolucion','en_tramite'),
  ('estado','iniciado','en_tramite'),
  ('estado','abierto','en_tramite'),
  ('estado','en gestion','en_tramite'),
  ('estado','expediente abierto','en_tramite'),
  ('estado','pendiente de emision','pendiente_emision'),
  ('estado','pendiente emision','pendiente_emision'),
  ('estado','aprobado sin emitir','pendiente_emision'),
  ('estado','resolucion emitida sin certificado','pendiente_emision'),
  ('estado','a la firma','pendiente_emision'),
  ('estado','aprobado','aprobado'),
  ('estado','resuelto','aprobado'),
  ('estado','emitido','aprobado'),
  ('estado','finalizado','aprobado'),
  ('estado','otorgado','aprobado'),
  ('estado','favorable','aprobado'),
  ('estado','observado','observado'),
  ('estado','requerido','observado'),
  ('estado','con observaciones','observado'),
  ('estado','intimado','observado'),
  ('estado','a subsanar','observado'),
  ('estado','rechazado','rechazado'),
  ('estado','denegado','rechazado'),
  ('estado','desestimado','rechazado'),
  ('estado','archivado','rechazado'),
  ('estado','caducado','rechazado'),
  ('estado','vigente','vigente'),
  ('estado','en vigencia','vigente'),
  ('estado','al dia','vigente'),
  ('estado','sin iniciar','sin_iniciar'),
  ('estado','pendiente de inicio','sin_iniciar'),
  ('etapa','pronto despacho','pronto_despacho'),
  ('etapa','pronto despacho presentado','pronto_despacho'),
  ('etapa','esperando resolucion','esperando_resolucion'),
  ('etapa','elaboracion del proyecto de disposicion','esperando_resolucion'),
  ('etapa','presentado','iniciado'),
  ('etapa','subsanando','subsanando'),
  ('etapa','respondiendo observaciones','subsanando'),
  ('riesgo','bajo','bajo'),
  ('riesgo','medio','medio'),
  ('riesgo','alto','alto'),
  ('riesgo','critico','critico')
on conflict (dimension, sinonimo) do nothing;

alter table compliance_normalizacion enable row level security;
drop policy if exists compliance_norm_select on compliance_normalizacion;
create policy compliance_norm_select on compliance_normalizacion
  for select to authenticated using (true);

-- 4) Anticipación override por ítem -------------------------------------------
alter table compliance_items add column if not exists anticipacion_dias int;

-- 5) Alertas: origen/confianza/case_id + kind 'review' ------------------------
alter table compliance_alerts add column if not exists origen text
  check (origen in ('manual','sheet','documento','correo','ia','nombre_archivo'));
alter table compliance_alerts add column if not exists confianza text
  check (confianza in ('confirmada','alta','media','baja'));
alter table compliance_alerts add column if not exists case_id uuid
  references compliance_cases(id) on delete set null;

-- Extender el CHECK de kind (nombre-agnóstico: introspección).
do $$
declare cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'compliance_alerts'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%kind%';
  if cname is not null then
    execute format('alter table compliance_alerts drop constraint %I', cname);
  end if;
  alter table compliance_alerts add constraint compliance_alerts_kind_chk
    check (kind in ('expiration','missing_doc','audit_observation','regulatory_update','review'));
end $$;

-- 6) Evidencias: respaldo de cada cambio de estado (D12) ----------------------
create table if not exists compliance_evidence (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid references compliance_cases(id) on delete cascade,
  item_id            text references compliance_items(id) on delete set null,
  from_estado        text,
  to_estado          text not null,
  origen             text not null check (origen in ('manual','sheet','documento','correo','ia','nombre_archivo')),
  nivel_verificacion text not null check (nivel_verificacion in ('confirmada','alta','media','baja')),
  fecha_evidencia    date,
  document_id        uuid references compliance_documents(id) on delete set null,
  drive_file_id      text,
  url                text,
  titulo             text,
  descripcion        text,
  created_at         timestamptz not null default now()
);
create index if not exists compliance_evidence_case_idx on compliance_evidence(case_id);
create index if not exists compliance_evidence_item_idx on compliance_evidence(item_id);

alter table compliance_evidence enable row level security;
drop policy if exists compliance_evidence_select on compliance_evidence;
create policy compliance_evidence_select on compliance_evidence
  for select to authenticated using (true);
```

- [ ] **Step 2: Verificar (sin aplicar)**

Run: `grep -c "create table if not exists" supabase/migrations/0141_compliance_cases.sql`
Expected: `4` (compliance_cases, compliance_anticipacion_config, compliance_normalizacion, compliance_evidence).

> **No aplicar.** La migración es gateada. Validación profunda = revisión humana contra spec §3 y `0081`. (Si en el futuro hay `supabase db lint` disponible y un proyecto local, correrlo; hoy no está.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0141_compliance_cases.sql
git commit -m "feat(compliance): migración 0141 — casos, config anticipación, diccionario y evidencias"
```

---

## Task 2: Tipos del caso (`cases/types.ts`)

**Files:**
- Create: `src/lib/compliance/cases/types.ts`
- Test: `src/lib/compliance/cases/types.test.ts`

**Interfaces:**
- Produces: tipos `EstadoAdministrativo`, `Etapa`, `NivelRiesgo`, `Semaforo`, `Origen`, `Confianza`, `Temporal`, `ComplianceCase`, `ComplianceCaseLite`, y las const arrays `ESTADOS`, `NIVELES_RIESGO`.

- [ ] **Step 1: Escribir el test (falla)**

Crear `src/lib/compliance/cases/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ESTADOS, NIVELES_RIESGO, SEMAFOROS } from "./types";

describe("compliance cases · types", () => {
  it("incluye el estado transitorio pendiente_emision", () => {
    expect(ESTADOS).toContain("pendiente_emision");
  });
  it("niveles de riesgo son 4 (no son colores)", () => {
    expect(NIVELES_RIESGO).toEqual(["bajo", "medio", "alto", "critico"]);
  });
  it("semáforo tiene exactamente los 4 colores", () => {
    expect(SEMAFOROS).toEqual(["Verde", "Amarillo", "Naranja", "Rojo"]);
  });
});
```

- [ ] **Step 2: Correr el test (verificar que falla)**

Run: `npx vitest run src/lib/compliance/cases/types.test.ts`
Expected: FAIL ("Cannot find module './types'").

- [ ] **Step 3: Escribir los tipos**

Crear `src/lib/compliance/cases/types.ts`:

```ts
/**
 * Tipos del modelo de casos regulatorios.
 * Estado administrativo y Nivel de riesgo son dimensiones INDEPENDIENTES.
 * El Semáforo (color) se computa (ver ../semaforo.ts); el riesgo NO lo determina.
 */
import type { Riesgo } from "../data";

export const ESTADOS = [
  "sin_iniciar", "vigente", "en_tramite", "observado",
  "pendiente_emision", "aprobado", "rechazado",
] as const;
export type EstadoAdministrativo = (typeof ESTADOS)[number];

export const ETAPAS = ["iniciado", "pronto_despacho", "esperando_resolucion", "subsanando"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const NIVELES_RIESGO = ["bajo", "medio", "alto", "critico"] as const;
export type NivelRiesgo = (typeof NIVELES_RIESGO)[number];

/** El semáforo (color) coincide con el tipo Riesgo existente del cockpit. */
export const SEMAFOROS = ["Verde", "Amarillo", "Naranja", "Rojo"] as const;
export type Semaforo = Riesgo;

export const ORIGENES = ["manual", "sheet", "documento", "correo", "ia", "nombre_archivo"] as const;
export type Origen = (typeof ORIGENES)[number];

export const CONFIANZAS = ["confirmada", "alta", "media", "baja"] as const;
export type Confianza = (typeof CONFIANZAS)[number];

/** Eje temporal derivado de las fechas (independiente del estado). */
export type Temporal = "vigente" | "proximo" | "vencido" | "sin_fecha" | "falta";

export interface ComplianceCase {
  id: string;
  itemId: string | null;
  sede: string | null;
  tipoCertificado: string | null;
  expedienteNro: string | null;
  organismo: string | null;
  estadoAdministrativo: EstadoAdministrativo;
  etapa: Etapa | null;
  nivelRiesgo: NivelRiesgo | null;
  fechaInicio: string | null;
  fechaProntoDespacho: string | null;
  ultimaActuacion: string | null;
  proximaAccion: string | null;
  observaciones: string | null;
  origen: Origen;
  confianza: Confianza;
  activo: boolean;
}

/** Vista mínima del caso activo que consume deriveComplianceStatus. */
export interface ComplianceCaseLite {
  estadoAdministrativo: EstadoAdministrativo;
  etapa: Etapa | null;
  nivelRiesgo: NivelRiesgo | null;
  origen: Origen;
  confianza: Confianza;
}
```

- [ ] **Step 4: Correr el test (pasa)**

Run: `npx vitest run src/lib/compliance/cases/types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance/cases/types.ts src/lib/compliance/cases/types.test.ts
git commit -m "feat(compliance): tipos de casos regulatorios (estado/riesgo/semáforo separados)"
```

---

## Task 3: Diccionario de normalización (`cases/normalize.ts`)

**Files:**
- Create: `src/lib/compliance/cases/normalize.ts`
- Test: `src/lib/compliance/cases/normalize.test.ts`

**Interfaces:**
- Consumes: `EstadoAdministrativo`, `Etapa`, `NivelRiesgo` (Task 2).
- Produces:
  - `stripKey(s: string): string` — normaliza a clave (minúsculas, sin acentos, espacios colapsados).
  - `DEFAULT_DICT: NormRow[]` (fallback en código, espejo del seed DB).
  - `normalizar(texto, dimension, dict?): string | null`.
  - tipos `NormDimension = "estado"|"etapa"|"riesgo"`, `NormRow = { dimension, sinonimo, valorCanonico }`.

- [ ] **Step 1: Escribir el test (falla)**

Crear `src/lib/compliance/cases/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizar, stripKey, DEFAULT_DICT } from "./normalize";

describe("normalizar · estado", () => {
  it("variantes de trámite → en_tramite (sin acentos / mayúsculas)", () => {
    for (const t of ["En elaboración", "EN ANÁLISIS", "  en proceso ", "Pendiente de resolución"]) {
      expect(normalizar(t, "estado")).toBe("en_tramite");
    }
  });
  it("aprobado/resuelto/emitido/finalizado → aprobado", () => {
    for (const t of ["Aprobado", "Resuelto", "Emitido", "Finalizado"]) {
      expect(normalizar(t, "estado")).toBe("aprobado");
    }
  });
  it("pendiente de emisión → pendiente_emision", () => {
    expect(normalizar("Pendiente de emisión", "estado")).toBe("pendiente_emision");
  });
  it("archivado/caducado/rechazado → rechazado", () => {
    for (const t of ["Archivado", "Caducado", "Rechazado"]) {
      expect(normalizar(t, "estado")).toBe("rechazado");
    }
  });
  it("texto desconocido → null (degradación segura, no inventa)", () => {
    expect(normalizar("bla bla", "estado")).toBeNull();
    expect(normalizar("", "estado")).toBeNull();
  });
  it("extensible: un dict adicional agrega sinónimos sin tocar el motor", () => {
    const extra = [...DEFAULT_DICT, { dimension: "estado" as const, sinonimo: stripKey("en cola"), valorCanonico: "en_tramite" }];
    expect(normalizar("En cola", "estado", extra)).toBe("en_tramite");
  });
});

describe("normalizar · riesgo", () => {
  it("crítico → critico", () => {
    expect(normalizar("Crítico", "riesgo")).toBe("critico");
  });
});
```

- [ ] **Step 2: Correr (falla)**

Run: `npx vitest run src/lib/compliance/cases/normalize.test.ts`
Expected: FAIL ("Cannot find module './normalize'").

- [ ] **Step 3: Implementar**

Crear `src/lib/compliance/cases/normalize.ts`:

```ts
/**
 * Diccionario de normalización (sinónimo → valor canónico).
 * Extensible POR DATOS: el motor recibe filas (DB) o usa DEFAULT_DICT como fallback.
 * Agregar términos = filas nuevas (tabla compliance_normalizacion), sin tocar este código.
 */
export type NormDimension = "estado" | "etapa" | "riesgo";
export interface NormRow { dimension: NormDimension; sinonimo: string; valorCanonico: string; }

/** Clave de comparación: minúsculas, sin acentos, espacios colapsados, trim. */
export function stripKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Fallback en código (espejo del seed de 0141). `sinonimo` ya viene normalizado con stripKey. */
const RAW: Array<[NormDimension, string, string]> = [
  ["estado", "en elaboracion", "en_tramite"],
  ["estado", "en analisis", "en_tramite"],
  ["estado", "en estudio", "en_tramite"],
  ["estado", "en proceso", "en_tramite"],
  ["estado", "en tramite", "en_tramite"],
  ["estado", "pendiente de resolucion", "en_tramite"],
  ["estado", "iniciado", "en_tramite"],
  ["estado", "abierto", "en_tramite"],
  ["estado", "en gestion", "en_tramite"],
  ["estado", "expediente abierto", "en_tramite"],
  ["estado", "pendiente de emision", "pendiente_emision"],
  ["estado", "pendiente emision", "pendiente_emision"],
  ["estado", "aprobado sin emitir", "pendiente_emision"],
  ["estado", "resolucion emitida sin certificado", "pendiente_emision"],
  ["estado", "a la firma", "pendiente_emision"],
  ["estado", "aprobado", "aprobado"],
  ["estado", "resuelto", "aprobado"],
  ["estado", "emitido", "aprobado"],
  ["estado", "finalizado", "aprobado"],
  ["estado", "otorgado", "aprobado"],
  ["estado", "favorable", "aprobado"],
  ["estado", "observado", "observado"],
  ["estado", "requerido", "observado"],
  ["estado", "con observaciones", "observado"],
  ["estado", "intimado", "observado"],
  ["estado", "a subsanar", "observado"],
  ["estado", "rechazado", "rechazado"],
  ["estado", "denegado", "rechazado"],
  ["estado", "desestimado", "rechazado"],
  ["estado", "archivado", "rechazado"],
  ["estado", "caducado", "rechazado"],
  ["estado", "vigente", "vigente"],
  ["estado", "en vigencia", "vigente"],
  ["estado", "al dia", "vigente"],
  ["estado", "sin iniciar", "sin_iniciar"],
  ["estado", "pendiente de inicio", "sin_iniciar"],
  ["etapa", "pronto despacho", "pronto_despacho"],
  ["etapa", "pronto despacho presentado", "pronto_despacho"],
  ["etapa", "esperando resolucion", "esperando_resolucion"],
  ["etapa", "elaboracion del proyecto de disposicion", "esperando_resolucion"],
  ["etapa", "presentado", "iniciado"],
  ["etapa", "subsanando", "subsanando"],
  ["etapa", "respondiendo observaciones", "subsanando"],
  ["riesgo", "bajo", "bajo"],
  ["riesgo", "medio", "medio"],
  ["riesgo", "alto", "alto"],
  ["riesgo", "critico", "critico"],
];
export const DEFAULT_DICT: NormRow[] = RAW.map(([dimension, sinonimo, valorCanonico]) => ({ dimension, sinonimo, valorCanonico }));

/**
 * Normaliza `texto` para la dimensión dada usando el diccionario.
 * Estrategia: match exacto por clave; si no, match por "contiene sinónimo".
 * Devuelve el valor canónico o null (degradación segura: el caller decide caer a fecha).
 */
export function normalizar(
  texto: string | null | undefined,
  dimension: NormDimension,
  dict: NormRow[] = DEFAULT_DICT,
): string | null {
  if (!texto) return null;
  const key = stripKey(texto);
  if (!key) return null;
  const rows = dict.filter((r) => r.dimension === dimension);
  // 1) match exacto
  const exact = rows.find((r) => r.sinonimo === key);
  if (exact) return exact.valorCanonico;
  // 2) match por inclusión (sinónimo más largo primero para evitar falsos positivos)
  const byLen = [...rows].sort((a, b) => b.sinonimo.length - a.sinonimo.length);
  const inc = byLen.find((r) => key.includes(r.sinonimo));
  return inc ? inc.valorCanonico : null;
}
```

- [ ] **Step 4: Correr (pasa)**

Run: `npx vitest run src/lib/compliance/cases/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance/cases/normalize.ts src/lib/compliance/cases/normalize.test.ts
git commit -m "feat(compliance): diccionario de normalización extensible (estado/etapa/riesgo)"
```

---

## Task 4: Motor de semáforo (`semaforo.ts`)

**Files:**
- Create: `src/lib/compliance/semaforo.ts`
- Test: `src/lib/compliance/semaforo.test.ts`

**Interfaces:**
- Consumes: `Semaforo`, `EstadoAdministrativo`, `Temporal`, `NivelRiesgo` (Task 2).
- Produces:
  - `resolveAnticipacion(args: { itemOverride: number|null; frecuencia: string|null; config: Record<string, number> }): number`
  - `temporalOf(args: { vencimiento: string|null; dias: number|null; baseFalta: boolean }): Temporal`
  - `computeSemaforo(temporal: Temporal, estado: EstadoAdministrativo): Semaforo` — **no recibe riesgo**.
  - `alertSeverity(nivel: NivelRiesgo|null, semaforo: Semaforo): "critical"|"warning"|"info"`

- [ ] **Step 1: Escribir el test (falla)**

Crear `src/lib/compliance/semaforo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeSemaforo, resolveAnticipacion, temporalOf, alertSeverity } from "./semaforo";

const CFG = { Mensual: 7, Anual: 60, Cuatrienal: 180, __default__: 60 };

describe("resolveAnticipacion · jerarquía override → config → default", () => {
  it("override del ítem manda", () => {
    expect(resolveAnticipacion({ itemOverride: 5, frecuencia: "Anual", config: CFG })).toBe(5);
  });
  it("config por frecuencia si no hay override", () => {
    expect(resolveAnticipacion({ itemOverride: null, frecuencia: "Cuatrienal", config: CFG })).toBe(180);
  });
  it("default del sistema si la frecuencia no matchea", () => {
    expect(resolveAnticipacion({ itemOverride: null, frecuencia: "Rara", config: CFG })).toBe(60);
  });
});

describe("temporalOf", () => {
  it("sin vencimiento y base no faltante → sin_fecha", () => {
    expect(temporalOf({ vencimiento: null, dias: null, baseFalta: false })).toBe("sin_fecha");
  });
  it("sin vencimiento pero base faltante → falta", () => {
    expect(temporalOf({ vencimiento: null, dias: null, baseFalta: true })).toBe("falta");
  });
  it("dias negativos → vencido", () => {
    expect(temporalOf({ vencimiento: "2020-01-01", dias: -10, baseFalta: false })).toBe("vencido");
  });
});

describe("computeSemaforo · cascada (riesgo NO interviene)", () => {
  it("vigente → Verde", () => {
    expect(computeSemaforo("vigente", "vigente")).toBe("Verde");
    expect(computeSemaforo("vigente", "aprobado")).toBe("Verde");
  });
  it("vigente con observado → Amarillo", () => {
    expect(computeSemaforo("vigente", "observado")).toBe("Amarillo");
  });
  it("proximo → Amarillo", () => {
    expect(computeSemaforo("proximo", "en_tramite")).toBe("Amarillo");
  });
  it("CASO MAG-04: vencido + en_tramite → Naranja (NO Rojo)", () => {
    expect(computeSemaforo("vencido", "en_tramite")).toBe("Naranja");
  });
  it("vencido + pendiente_emision/aprobado → Amarillo (falta incorporar cert)", () => {
    expect(computeSemaforo("vencido", "pendiente_emision")).toBe("Amarillo");
    expect(computeSemaforo("vencido", "aprobado")).toBe("Amarillo");
  });
  it("vencido sin caso / rechazado → Rojo", () => {
    expect(computeSemaforo("vencido", "sin_iniciar")).toBe("Rojo");
    expect(computeSemaforo("vencido", "rechazado")).toBe("Rojo");
  });
  it("falta de doc + en_tramite → Naranja; sin caso → Rojo", () => {
    expect(computeSemaforo("falta", "en_tramite")).toBe("Naranja");
    expect(computeSemaforo("falta", "sin_iniciar")).toBe("Rojo");
  });
  it("permanente (sin_fecha): en_tramite → Naranja, vigente → Verde", () => {
    expect(computeSemaforo("sin_fecha", "en_tramite")).toBe("Naranja");
    expect(computeSemaforo("sin_fecha", "vigente")).toBe("Verde");
  });
});

describe("alertSeverity · riesgo = prioridad (no color)", () => {
  it("verde nunca alerta", () => {
    expect(alertSeverity("critico", "Verde")).toBe("info");
  });
  it("critico en no-verde → critical", () => {
    expect(alertSeverity("critico", "Naranja")).toBe("critical");
  });
  it("alto en no-verde → warning", () => {
    expect(alertSeverity("alto", "Amarillo")).toBe("warning");
  });
});
```

- [ ] **Step 2: Correr (falla)**

Run: `npx vitest run src/lib/compliance/semaforo.test.ts`
Expected: FAIL ("Cannot find module './semaforo'").

- [ ] **Step 3: Implementar**

Crear `src/lib/compliance/semaforo.ts`:

```ts
/**
 * Motor de semáforo de Compliance.
 * REGLA CLAVE (D7): el color surge SÓLO de (temporal + estado administrativo).
 * El nivel de riesgo NO interviene en el color: se usa para prioridad (alertSeverity).
 */
import type { Semaforo, EstadoAdministrativo, Temporal, NivelRiesgo } from "./cases/types";

/** Jerarquía D6: override del ítem → config por frecuencia → default del sistema. */
export function resolveAnticipacion(args: {
  itemOverride: number | null;
  frecuencia: string | null;
  config: Record<string, number>;
}): number {
  if (args.itemOverride != null) return args.itemOverride;
  const f = (args.frecuencia ?? "").trim();
  if (f && args.config[f] != null) return args.config[f];
  return args.config["__default__"] ?? 60;
}

export function temporalOf(args: {
  vencimiento: string | null;
  dias: number | null;
  baseFalta: boolean;
  anticipacion?: number;
}): Temporal {
  if (!args.vencimiento || args.dias == null) return args.baseFalta ? "falta" : "sin_fecha";
  if (args.dias < 0) return "vencido";
  const antic = args.anticipacion ?? 60;
  return args.dias <= antic ? "proximo" : "vigente";
}

/** Cascada de color (spec §5.2). NO recibe riesgo. */
export function computeSemaforo(temporal: Temporal, estado: EstadoAdministrativo): Semaforo {
  if (temporal === "vigente") {
    if (estado === "rechazado") return "Rojo";
    if (estado === "observado" || estado === "pendiente_emision") return "Amarillo";
    return "Verde";
  }
  if (temporal === "proximo") {
    if (estado === "rechazado") return "Rojo";
    return "Amarillo";
  }
  if (temporal === "vencido" || temporal === "falta") {
    if (estado === "en_tramite" || estado === "observado") return "Naranja";
    if (estado === "pendiente_emision" || estado === "aprobado") return "Amarillo";
    if (estado === "rechazado") return "Rojo";
    return "Rojo";
  }
  // sin_fecha (permanente)
  if (estado === "en_tramite") return "Naranja";
  if (estado === "observado" || estado === "pendiente_emision" || estado === "aprobado") return "Amarillo";
  if (estado === "rechazado") return "Rojo";
  return "Verde";
}

/** Severidad de alerta a partir del riesgo (prioridad) y el color. */
export function alertSeverity(nivel: NivelRiesgo | null, semaforo: Semaforo): "critical" | "warning" | "info" {
  if (semaforo === "Verde") return "info";
  if (nivel === "critico") return "critical";
  if (semaforo === "Rojo") return "critical";
  if (nivel === "alto") return "warning";
  return "warning";
}
```

- [ ] **Step 4: Correr (pasa)**

Run: `npx vitest run src/lib/compliance/semaforo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance/semaforo.ts src/lib/compliance/semaforo.test.ts
git commit -m "feat(compliance): motor de semáforo (estado→color, riesgo→prioridad)"
```

---

## Task 4B: Máquina de estados (`cases/transitions.ts`) — D11

**Files:**
- Create: `src/lib/compliance/cases/transitions.ts`
- Test: `src/lib/compliance/cases/transitions.test.ts`

**Interfaces:**
- Consumes: `EstadoAdministrativo` (Task 2).
- Produces: `TRANSICIONES: Record<EstadoAdministrativo, EstadoAdministrativo[]>`, `canTransition(from, to): boolean`.

- [ ] **Step 1: Escribir el test (falla)**

Crear `src/lib/compliance/cases/transitions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canTransition, TRANSICIONES } from "./transitions";

describe("canTransition · máquina de estados (D11)", () => {
  it("auto-transición siempre válida (idempotencia del re-sync)", () => {
    expect(canTransition("en_tramite", "en_tramite")).toBe(true);
  });
  it("sin_iniciar → cualquiera (creación inicial)", () => {
    expect(canTransition("sin_iniciar", "vigente")).toBe(true);
    expect(canTransition("sin_iniciar", "rechazado")).toBe(true);
  });
  it("en_tramite → pendiente_emision / aprobado / rechazado permitido", () => {
    expect(canTransition("en_tramite", "pendiente_emision")).toBe(true);
    expect(canTransition("en_tramite", "rechazado")).toBe(true);
  });
  it("pendiente_emision → vigente permitido (se incorporó el cert)", () => {
    expect(canTransition("pendiente_emision", "vigente")).toBe(true);
  });
  it("rechazado → vigente NO permitido (debe reabrir trámite)", () => {
    expect(canTransition("rechazado", "vigente")).toBe(false);
  });
  it("vigente → pendiente_emision NO permitido (no salta el trámite)", () => {
    expect(canTransition("vigente", "pendiente_emision")).toBe(false);
  });
  it("todo destino declarado es un estado válido del enum", () => {
    const all = Object.keys(TRANSICIONES);
    for (const tos of Object.values(TRANSICIONES)) for (const t of tos) expect(all).toContain(t);
  });
});
```

- [ ] **Step 2: Correr (falla)**

Run: `npx vitest run src/lib/compliance/cases/transitions.test.ts`
Expected: FAIL ("Cannot find module './transitions'").

- [ ] **Step 3: Implementar**

Crear `src/lib/compliance/cases/transitions.ts`:

```ts
/**
 * Máquina de estados administrativos (D11): impide cambios inconsistentes.
 * `from → [destinos permitidos]`. Auto-transición (X→X) siempre válida.
 * `sin_iniciar` como origen = creación: permite cualquier estado inicial.
 * Tuneable (constante en código; promovible a tabla en una iteración futura).
 */
import type { EstadoAdministrativo } from "./types";

export const TRANSICIONES: Record<EstadoAdministrativo, EstadoAdministrativo[]> = {
  sin_iniciar:       ["vigente", "en_tramite", "observado", "pendiente_emision", "aprobado", "rechazado"],
  en_tramite:        ["observado", "pendiente_emision", "aprobado", "rechazado", "vigente"],
  observado:         ["en_tramite", "pendiente_emision", "aprobado", "rechazado"],
  pendiente_emision: ["vigente", "aprobado", "rechazado"],
  aprobado:          ["vigente", "pendiente_emision"],
  vigente:           ["en_tramite", "observado", "rechazado"],
  rechazado:         ["en_tramite", "sin_iniciar"],
};

/** ¿Se permite la transición from→to? La auto-transición siempre es válida. */
export function canTransition(from: EstadoAdministrativo, to: EstadoAdministrativo): boolean {
  if (from === to) return true;
  return TRANSICIONES[from]?.includes(to) ?? false;
}
```

- [ ] **Step 4: Correr (pasa)**

Run: `npx vitest run src/lib/compliance/cases/transitions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance/cases/transitions.ts src/lib/compliance/cases/transitions.test.ts
git commit -m "feat(compliance): máquina de estados con transiciones permitidas (D11)"
```

---

## Task 5: Parser de la planilla (`cases/sheet.ts`)

**Files:**
- Create: `src/lib/compliance/cases/sheet.ts`
- Test: `src/lib/compliance/cases/sheet.test.ts`

**Interfaces:**
- Consumes: `normalizar` (Task 3), tipos del caso (Task 2).
- Produces:
  - `parseCsv(text: string): string[][]` — CSV con comillas dobles y comas embebidas.
  - `SheetCaseRow` = forma parseada lista para upsert (item_id, estado_administrativo, etapa, nivel_riesgo, fechas, textos, etc.).
  - `parseEstadoSheet(csv: string, dict?: NormRow[]): { rows: SheetCaseRow[]; errors: string[] }`.

- [ ] **Step 1: Escribir el test (falla)**

Crear `src/lib/compliance/cases/sheet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv, parseEstadoSheet } from "./sheet";

const HEADER =
  "Item ID,Sede,Tipo de certificado,Expediente,Organismo,Estado administrativo,Fecha de inicio,Fecha del pronto despacho,Última actuación,Próxima acción,Nivel de riesgo,Observaciones";

describe("parseCsv", () => {
  it("respeta comas embebidas dentro de comillas", () => {
    const rows = parseCsv(`a,"b,c",d\n1,2,3`);
    expect(rows[0]).toEqual(["a", "b,c", "d"]);
    expect(rows[1]).toEqual(["1", "2", "3"]);
  });
  it("comillas dobles escapadas", () => {
    expect(parseCsv(`"He dijo ""hola""",x`)[0]).toEqual(['He dijo "hola"', "x"]);
  });
});

describe("parseEstadoSheet", () => {
  it("CASO MAG-04: mapea y normaliza estado/etapa", () => {
    const csv = [
      HEADER,
      `MAG-04,MAGALDI,CAA Nación R. Peligrosos,EX-2023-116887453,Min. Ambiente,En elaboración,2023-09-01,2025-02-01,Pronto despacho presentado,Esperar disposición,alto,Trámite avanzado`,
    ].join("\n");
    const { rows, errors } = parseEstadoSheet(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].item_id).toBe("MAG-04");
    expect(rows[0].estado_administrativo).toBe("en_tramite");
    expect(rows[0].etapa).toBe("pronto_despacho"); // inferida por fecha_pronto_despacho presente
    expect(rows[0].nivel_riesgo).toBe("alto");
    expect(rows[0].fecha_pronto_despacho).toBe("2025-02-01");
  });
  it("fila sin Item ID → error y NO se incluye (degradación segura)", () => {
    const csv = [HEADER, `,MAGALDI,X,,Org,Vigente,,,,,,`].join("\n");
    const { rows, errors } = parseEstadoSheet(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toMatch(/Item ID/i);
  });
  it("estado no normalizable → error y fila descartada", () => {
    const csv = [HEADER, `MAG-99,MAGALDI,X,,Org,blabla,,,,,,`].join("\n");
    const { rows, errors } = parseEstadoSheet(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toMatch(/MAG-99/);
  });
});
```

- [ ] **Step 2: Correr (falla)**

Run: `npx vitest run src/lib/compliance/cases/sheet.test.ts`
Expected: FAIL ("Cannot find module './sheet'").

- [ ] **Step 3: Implementar**

Crear `src/lib/compliance/cases/sheet.ts`:

```ts
/**
 * Parser de la planilla central 00_ESTADO_COMPLIANCE (Google Sheet → CSV).
 * Determinístico (sin IA). Toda fila válida queda origen='sheet', confianza='confirmada'.
 */
import { normalizar, type NormRow } from "./normalize";
import type { EstadoAdministrativo, Etapa, NivelRiesgo } from "./types";

export interface SheetCaseRow {
  item_id: string;
  sede: string | null;
  tipo_certificado: string | null;
  expediente_nro: string | null;
  organismo: string | null;
  estado_administrativo: EstadoAdministrativo;
  etapa: Etapa | null;
  nivel_riesgo: NivelRiesgo | null;
  fecha_inicio: string | null;
  fecha_pronto_despacho: string | null;
  ultima_actuacion: string | null;
  proxima_accion: string | null;
  observaciones: string | null;
}

/** CSV mínimo robusto: comillas dobles, comas/saltos embebidos, "" como comilla escapada. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const HEADERS: Record<string, keyof SheetCaseRow | "estado_raw" | "etapa_raw" | "riesgo_raw"> = {
  "item id": "item_id",
  "sede": "sede",
  "tipo de certificado": "tipo_certificado",
  "expediente": "expediente_nro",
  "organismo": "organismo",
  "estado administrativo": "estado_raw",
  "fecha de inicio": "fecha_inicio",
  "fecha del pronto despacho": "fecha_pronto_despacho",
  "ultima actuacion": "ultima_actuacion",
  "proxima accion": "proxima_accion",
  "nivel de riesgo": "riesgo_raw",
  "observaciones": "observaciones",
};

const hkey = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const blank = (s: string | undefined): string | null => (s && s.trim() !== "" ? s.trim() : null);

export function parseEstadoSheet(csv: string, dict?: NormRow[]): { rows: SheetCaseRow[]; errors: string[] } {
  const grid = parseCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
  const errors: string[] = [];
  if (grid.length === 0) return { rows: [], errors: ["Planilla vacía"] };

  const header = grid[0].map(hkey);
  const idx = (logical: string) => header.findIndex((h) => HEADERS[h] === logical);
  const colItem = idx("item_id");
  const colEstado = idx("estado_raw");
  if (colItem < 0 || colEstado < 0) {
    return { rows: [], errors: ["Faltan columnas obligatorias 'Item ID' y/o 'Estado administrativo'"] };
  }

  const get = (cells: string[], logical: string): string | null => {
    const c = idx(logical);
    return c >= 0 ? blank(cells[c]) : null;
  };

  const rows: SheetCaseRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    const itemId = blank(cells[colItem]);
    if (!itemId) { errors.push(`Fila ${i + 1}: falta 'Item ID' — descartada`); continue; }

    const estadoRaw = blank(cells[colEstado]);
    const estado = normalizar(estadoRaw, "estado", dict) as EstadoAdministrativo | null;
    if (!estado) { errors.push(`Fila ${i + 1} (${itemId}): estado no reconocido ("${estadoRaw ?? ""}") — descartada`); continue; }

    const fechaPD = get(cells, "fecha_pronto_despacho");
    let etapa = normalizar(estadoRaw, "etapa", dict) as Etapa | null;
    if (!etapa && fechaPD) etapa = "pronto_despacho"; // inferencia: si hay fecha de pronto despacho

    const nivel = normalizar(get(cells, "riesgo_raw"), "riesgo", dict) as NivelRiesgo | null;

    rows.push({
      item_id: itemId,
      sede: get(cells, "sede"),
      tipo_certificado: get(cells, "tipo_certificado"),
      expediente_nro: get(cells, "expediente_nro"),
      organismo: get(cells, "organismo"),
      estado_administrativo: estado,
      etapa,
      nivel_riesgo: nivel,
      fecha_inicio: get(cells, "fecha_inicio"),
      fecha_pronto_despacho: fechaPD,
      ultima_actuacion: get(cells, "ultima_actuacion"),
      proxima_accion: get(cells, "proxima_accion"),
      observaciones: get(cells, "observaciones"),
    });
  }
  return { rows, errors };
}
```

- [ ] **Step 4: Correr (pasa)**

Run: `npx vitest run src/lib/compliance/cases/sheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance/cases/sheet.ts src/lib/compliance/cases/sheet.test.ts
git commit -m "feat(compliance): parser determinístico de la planilla 00_ESTADO_COMPLIANCE"
```

---

## Task 6: Extender `ComplianceItem` + refactor `deriveComplianceStatus`

**Files:**
- Modify: `src/lib/compliance/data.ts` (tipo + función, ~líneas 13-34, 53-60, 131-151)
- Test: `src/lib/compliance/derive.test.ts` (nuevo)

**Interfaces:**
- Consumes: `computeSemaforo`, `temporalOf`, `resolveAnticipacion` (Task 4); `ComplianceCaseLite` (Task 2).
- Produces: `ComplianceItem` con campos opcionales del caso (`activeCase`, `estadoAdministrativo`, `nivelRiesgo`, `etapa`); `deriveComplianceStatus(item, today?, anticConfig?)` que computa `riesgo` (=semáforo) vía cascada usando `item.activeCase`.

- [ ] **Step 1: Escribir el test (falla)**

Crear `src/lib/compliance/derive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveComplianceStatus, type ComplianceItem } from "./data";

const base: ComplianceItem = {
  id: "T", sede: "MAGALDI", categoria: "Residuos", documento: "X", organismo: "O", tipo: "T",
  emision: "2022-10-06", vencimiento: "2023-10-06", frecuencia: "Anual", estado: "Vencido",
  riesgo: "Rojo", fuente: "Leído", nota: "", docs: 0, dias: null, venc_fmt: "", emi_fmt: "",
};

describe("deriveComplianceStatus · cascada con caso activo", () => {
  it("vencido SIN caso → Rojo (comportamiento heredado)", () => {
    const out = deriveComplianceStatus({ ...base }, "2026-06-29");
    expect(out.riesgo).toBe("Rojo");
  });
  it("CASO MAG-04: vencido CON caso en_tramite → Naranja", () => {
    const out = deriveComplianceStatus(
      { ...base, activeCase: { estadoAdministrativo: "en_tramite", etapa: "pronto_despacho", nivelRiesgo: "alto", origen: "sheet", confianza: "confirmada" } },
      "2026-06-29",
    );
    expect(out.riesgo).toBe("Naranja");
    expect(out.estadoAdministrativo).toBe("en_tramite");
    expect(out.nivelRiesgo).toBe("alto");
  });
  it("pendiente_emision vencido → Amarillo", () => {
    const out = deriveComplianceStatus(
      { ...base, activeCase: { estadoAdministrativo: "pendiente_emision", etapa: null, nivelRiesgo: "medio", origen: "sheet", confianza: "confirmada" } },
      "2026-06-29",
    );
    expect(out.riesgo).toBe("Amarillo");
  });
  it("anticipación por frecuencia: Cuatrienal avisa a 180 días", () => {
    const cuatri = { ...base, frecuencia: "Cuatrienal", vencimiento: "2026-09-01" }; // ~64 días al 2026-06-29
    const out = deriveComplianceStatus(cuatri, "2026-06-29", { Cuatrienal: 180, __default__: 60 });
    expect(out.riesgo).toBe("Amarillo"); // dentro de los 180 → próximo
  });
  it("override del ítem manda sobre la config", () => {
    const it = { ...base, frecuencia: "Cuatrienal", vencimiento: "2026-09-01", anticipacion_dias: 10 };
    const out = deriveComplianceStatus(it, "2026-06-29", { Cuatrienal: 180, __default__: 60 });
    expect(out.riesgo).toBe("Verde"); // 64 días > 10 → vigente
  });
});
```

- [ ] **Step 2: Correr (falla)**

Run: `npx vitest run src/lib/compliance/derive.test.ts`
Expected: FAIL (campos `activeCase`/`anticipacion_dias`/`estadoAdministrativo` no existen; firma no acepta config).

- [ ] **Step 3: Editar `data.ts` — extender el tipo**

Reemplazar el bloque `export interface ComplianceItem { ... }` (líneas 16-34) por:

```ts
import type { ComplianceCaseLite, EstadoAdministrativo, Etapa, NivelRiesgo } from "./cases/types";

export interface ComplianceItem {
  id: string;
  sede: Sede;
  categoria: string;
  documento: string;
  organismo: string;
  tipo: string;
  emision: string | null;
  vencimiento: string | null;
  frecuencia: string;
  estado: string;
  /** Semáforo (color). Lo computa deriveComplianceStatus; los consumidores lo leen como color. */
  riesgo: Riesgo;
  fuente: string;
  nota: string;
  docs: number;
  dias: number | null;
  venc_fmt: string;
  emi_fmt: string;
  /** Override de anticipación 🟡 (nivel más alto de la jerarquía D6). */
  anticipacion_dias?: number | null;
  /** Caso regulatorio activo asociado (si lo hay). Lo adjunta source.ts. */
  activeCase?: ComplianceCaseLite | null;
  /** Proyecciones del caso para la UI (las setea deriveComplianceStatus). */
  estadoAdministrativo?: EstadoAdministrativo | null;
  etapa?: Etapa | null;
  nivelRiesgo?: NivelRiesgo | null;
}
```

> Nota: el `import type` va al tope del archivo junto a los demás imports. `Semaforo` no se importa: el color sigue siendo `Riesgo`.

- [ ] **Step 4: Editar `data.ts` — `RISK_LABEL` (nuevo significado de 🟠 y 🟡)**

Reemplazar (líneas 58-60):

```ts
export const RISK_LABEL: Record<Riesgo, string> = {
  Verde: "Vigente", Amarillo: "Próximo a vencer", Naranja: "En trámite administrativo", Rojo: "Vencido / Falta",
};
```

- [ ] **Step 5: Editar `data.ts` — refactor `deriveComplianceStatus`**

Reemplazar la función completa (líneas 131-151) por:

```ts
import { computeSemaforo, temporalOf, resolveAnticipacion } from "./semaforo";
import type { Temporal } from "./cases/types";

/** Default de anticipación cuando no se inyecta config (espejo del seed 0141). */
export const ANTICIPACION_DEFAULT: Record<string, number> = {
  Mensual: 7, Trimestral: 15, Semestral: 30, Anual: 60, Bienal: 90, Trienal: 120, Cuatrienal: 180, __default__: 60,
};

/**
 * Recalcula dias + semáforo (riesgo) + estado contra la fecha actual y el caso activo.
 * El color sale de (temporal + estado administrativo); el riesgo (prioridad) viaja aparte.
 */
export function deriveComplianceStatus(
  item: ComplianceItem,
  today: string = todayAr(),
  anticConfig: Record<string, number> = ANTICIPACION_DEFAULT,
): ComplianceItem {
  const caso = item.activeCase ?? null;
  const estadoAdm = caso?.estadoAdministrativo ?? null;
  // "falta": base documental indica faltante/proyecto (Rojo sin vencimiento en el snapshot).
  const baseFalta = !item.vencimiento && item.riesgo === "Rojo";

  const dias = item.vencimiento ? diffDays(item.vencimiento, today) : null;
  const anticipacion = resolveAnticipacion({
    itemOverride: item.anticipacion_dias ?? null,
    frecuencia: item.frecuencia || null,
    config: anticConfig,
  });
  const temporal: Temporal = temporalOf({ vencimiento: item.vencimiento, dias, baseFalta, anticipacion });

  // Estado efectivo para la cascada: el del caso, o uno inferido del eje temporal.
  const estadoEfectivo = estadoAdm ?? (temporal === "vigente" ? "vigente" : temporal === "falta" ? "sin_iniciar" : "sin_iniciar");

  // Si NO hay caso y NO hay vencimiento NI falta (permanente vigente del snapshot) → conservar base.
  if (!caso && !item.vencimiento && !baseFalta) {
    return { ...item, dias, estadoAdministrativo: estadoAdm, etapa: caso?.etapa ?? null, nivelRiesgo: caso?.nivelRiesgo ?? null };
  }

  const semaforo = computeSemaforo(temporal, estadoEfectivo as EstadoAdministrativo);
  const estadoTxt =
    semaforo === "Verde" ? "Vigente"
    : semaforo === "Amarillo" ? (estadoAdm === "pendiente_emision" ? "Pendiente de emisión" : "Próximo a vencer")
    : semaforo === "Naranja" ? "En trámite administrativo"
    : "Vencido / Falta";

  return {
    ...item,
    dias,
    riesgo: semaforo,
    estado: estadoTxt,
    estadoAdministrativo: estadoAdm,
    etapa: caso?.etapa ?? null,
    nivelRiesgo: caso?.nivelRiesgo ?? null,
  };
}
```

> Mover los `import` nuevos al bloque de imports del tope del archivo. Borrar el `import type` duplicado si ya quedó arriba.

- [ ] **Step 6: Correr el test (pasa) + typecheck**

Run: `npx vitest run src/lib/compliance/derive.test.ts && npm run typecheck`
Expected: PASS (5 tests) y typecheck OK. Si `tsc` marca usos de `RISK_LABEL.Naranja`/`Amarillo` con copy viejo, son sólo strings: no rompe tipos.

- [ ] **Step 7: Commit**

```bash
git add src/lib/compliance/data.ts src/lib/compliance/derive.test.ts
git commit -m "feat(compliance): deriveComplianceStatus usa caso activo + anticipación parametrizable"
```

---

## Task 6R: Batería de regresión permanente del motor (GATE obligatorio)

**Files:**
- Create: `src/lib/compliance/derive.regression.test.ts`

**Interfaces:**
- Consumes: `deriveComplianceStatus`, `ComplianceItem` (Task 6); `ComplianceCaseLite` (Task 2).

**Por qué:** `deriveComplianceStatus` es el punto central del motor. Esta matriz de 12 escenarios de negocio queda como test PERMANENTE; toda modificación futura del algoritmo debe pasarla. **Gate: no se avanza a Task 7+ hasta que esté 100% verde.**

- [ ] **Step 1: Escribir la suite de regresión completa**

Crear `src/lib/compliance/derive.regression.test.ts`:

```ts
/**
 * BATERÍA DE REGRESIÓN PERMANENTE — motor de Compliance (deriveComplianceStatus).
 * Matriz de escenarios de negocio. Cualquier cambio futuro del algoritmo DEBE pasar
 * estos 12 casos. No relajar ni borrar sin aprobación de Dirección.
 */
import { describe, it, expect } from "vitest";
import { deriveComplianceStatus, type ComplianceItem } from "./data";
import type { ComplianceCaseLite } from "./cases/types";

const TODAY = "2026-06-29";
const CFG = { Anual: 60, Cuatrienal: 180, __default__: 60 };

function item(over: Partial<ComplianceItem> = {}): ComplianceItem {
  return {
    id: "T", sede: "MAGALDI", categoria: "Residuos", documento: "Cert", organismo: "Org", tipo: "Certificado",
    emision: "2022-10-06", vencimiento: "2023-10-06", frecuencia: "Anual", estado: "", riesgo: "Rojo",
    fuente: "Leído", nota: "", docs: 0, dias: null, venc_fmt: "", emi_fmt: "", ...over,
  };
}
function caso(over: Partial<ComplianceCaseLite> = {}): ComplianceCaseLite {
  return { estadoAdministrativo: "en_tramite", etapa: null, nivelRiesgo: "medio", origen: "sheet", confianza: "confirmada", ...over };
}
const color = (it: ComplianceItem) => deriveComplianceStatus(it, TODAY, CFG).riesgo;

describe("REGRESIÓN · matriz de escenarios de negocio (motor de Compliance)", () => {
  it("1. Certificado vigente → Verde", () => {
    expect(color(item({ vencimiento: "2027-06-29", frecuencia: "Anual" }))).toBe("Verde");
  });
  it("2. Próximo a vencer según anticipación parametrizada (Cuatrienal 180d) → Amarillo", () => {
    expect(color(item({ vencimiento: "2026-09-01", frecuencia: "Cuatrienal" }))).toBe("Amarillo");
  });
  it("3. Vencido sin caso regulatorio → Rojo", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: null }))).toBe("Rojo");
  });
  it("4. Vencido con caso EN_TRAMITE → Naranja", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite" }) }))).toBe("Naranja");
  });
  it("5. Vencido con PRONTO_DESPACHO (en_tramite + etapa) → Naranja", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite", etapa: "pronto_despacho" }) }))).toBe("Naranja");
  });
  it("6. Vencido con PENDIENTE_EMISION → Amarillo", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "pendiente_emision" }) }))).toBe("Amarillo");
  });
  it("7. Vencido con RECHAZADO → Rojo", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "rechazado" }) }))).toBe("Rojo");
  });
  it("8. Riesgo ALTO no modifica el color (vencido+en_tramite sigue Naranja)", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite", nivelRiesgo: "alto" }) }))).toBe("Naranja");
  });
  it("9. Riesgo CRÍTICO no modifica el color (vencido+en_tramite sigue Naranja)", () => {
    expect(color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite", nivelRiesgo: "critico" }) }))).toBe("Naranja");
  });
  it("10. Cambiar SÓLO el riesgo → semáforo idéntico", () => {
    const medio = color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite", nivelRiesgo: "medio" }) }));
    const critico = color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite", nivelRiesgo: "critico" }) }));
    expect(medio).toBe(critico);
  });
  it("11. Cambiar SÓLO el estado administrativo → semáforo cambia", () => {
    const tramite = color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "en_tramite" }) }));
    const rechazado = color(item({ vencimiento: "2023-10-06", activeCase: caso({ estadoAdministrativo: "rechazado" }) }));
    expect(tramite).toBe("Naranja");
    expect(rechazado).toBe("Rojo");
    expect(tramite).not.toBe(rechazado);
  });
  it("12. Caso real MAG-04 (EX-2023-116887453) → Naranja 'En trámite administrativo'", () => {
    const mag04 = item({
      id: "MAG-04",
      documento: "Certificado Ambiental Anual (CAA) – Nación – Generador R. Peligrosos",
      vencimiento: "2023-10-06", frecuencia: "Anual",
      activeCase: caso({ estadoAdministrativo: "en_tramite", etapa: "pronto_despacho", nivelRiesgo: "alto" }),
    });
    const out = deriveComplianceStatus(mag04, TODAY, CFG);
    expect(out.riesgo).toBe("Naranja");
    expect(out.estado).toBe("En trámite administrativo");
  });
});
```

- [ ] **Step 2: Correr la batería — DEBE quedar 100% verde**

Run: `npx vitest run src/lib/compliance/derive.regression.test.ts`
Expected: 12/12 PASS. Si algún escenario falla, NO es un test mal escrito: es un bug del motor (Task 6) → corregir el motor, no el test (salvo error de fixture evidente).

- [ ] **Step 3: Suite completa + typecheck**

Run: `npx vitest run src/lib/compliance && npm run typecheck`
Expected: todo verde.

- [ ] **Step 4: Commit**

```bash
git add src/lib/compliance/derive.regression.test.ts
git commit -m "test(compliance): batería de regresión permanente del motor (12 escenarios de negocio)"
```

---

## Task 7: KPIs ejecutivos (nuevo significado de 🟠/🟡 + estados)

**Files:**
- Modify: `src/lib/compliance/data.ts` → `executiveKpis()` (líneas 251-266)
- Test: `src/lib/compliance/kpis.test.ts` (nuevo)

**Interfaces:**
- Consumes: `ComplianceItem[]` ya derivados.
- Produces: `executiveKpis()` con KPI "En trámite administrativo" (cuenta 🟠) y "Próximos a vencer" = cuenta 🟡.

- [ ] **Step 1: Escribir el test (falla)**

Crear `src/lib/compliance/kpis.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { executiveKpis, type ComplianceItem } from "./data";

function it_(riesgo: ComplianceItem["riesgo"], sede: ComplianceItem["sede"] = "MAGALDI"): ComplianceItem {
  return { id: "x"+Math.random(), sede, categoria: "Residuos", documento: "d", organismo: "", tipo: "", emision: null, vencimiento: null, frecuencia: "", estado: "", riesgo, fuente: "", nota: "", docs: 0, dias: null, venc_fmt: "", emi_fmt: "" };
}

describe("executiveKpis", () => {
  const items = [it_("Verde"), it_("Amarillo"), it_("Naranja"), it_("Naranja"), it_("Rojo")];
  const byKey = (k: string) => executiveKpis(items).find((x) => x.key === k)!;
  it("'proximos' cuenta Amarillo (próximo a vencer)", () => {
    expect(byKey("proximos").value).toBe(1);
  });
  it("'en_tramite' cuenta Naranja (en trámite administrativo)", () => {
    expect(byKey("en_tramite").value).toBe(2);
  });
  it("'vencidos' cuenta Rojo", () => {
    expect(byKey("vencidos").value).toBe(1);
  });
});
```

- [ ] **Step 2: Correr (falla)**

Run: `npx vitest run src/lib/compliance/kpis.test.ts`
Expected: FAIL (`en_tramite` no existe; `proximos` cuenta Naranja).

- [ ] **Step 3: Editar `executiveKpis` en `data.ts`**

Reemplazar los items `proximos`/`vencidos` y agregar `en_tramite` (dentro del `return [...]`, líneas ~258-260):

```ts
    { key: "proximos", label: "Próximos a vencer", value: items.filter((i) => i.riesgo === "Amarillo").length, tone: "Amarillo" as const, href: "#timeline", suffix: "" },
    { key: "en_tramite", label: "En trámite administrativo", value: items.filter((i) => i.riesgo === "Naranja").length, tone: "Naranja" as const, href: "#alertas", suffix: "" },
    { key: "vencidos", label: "Vencidos / Faltantes", value: items.filter((i) => i.riesgo === "Rojo").length, tone: "Rojo" as const, href: "#alertas", suffix: "" },
```

- [ ] **Step 4: Correr (pasa)**

Run: `npx vitest run src/lib/compliance/kpis.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance/data.ts src/lib/compliance/kpis.test.ts
git commit -m "feat(compliance): KPI 'En trámite administrativo' y 'Próximos a vencer'=Amarillo"
```

---

## Task 8: env — `compliance.estadoSheetFileId`

**Files:**
- Modify: `src/lib/env.ts` (bloque `compliance:` ~línea 202)
- Modify: `.env.example` (documentar la variable)

**Interfaces:**
- Produces: `env.compliance.estadoSheetFileId: string`.

- [ ] **Step 1: Editar `env.ts`**

Dentro del objeto `compliance: { ... }` (tras `driveSubpath`), agregar:

```ts
    /**
     * Planilla central 00_ESTADO_COMPLIANCE (Google Sheet) — fuente primaria del
     * estado administrativo. El cron la lee por fileId y la exporta a CSV.
     * Si está vacía, el Paso 0 del cron se saltea (degradación: cálculo por fecha).
     */
    estadoSheetFileId: process.env.COMPLIANCE_ESTADO_SHEET_FILE_ID?.trim() ?? "",
```

- [ ] **Step 2: Documentar en `.env.example`**

Agregar la línea (en la sección de Compliance/Drive):

```
COMPLIANCE_ESTADO_SHEET_FILE_ID=   # fileId de la Google Sheet "00_ESTADO_COMPLIANCE" (estado administrativo)
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
Expected: OK.

```bash
git add src/lib/env.ts .env.example
git commit -m "feat(compliance): env COMPLIANCE_ESTADO_SHEET_FILE_ID (planilla de estado)"
```

---

## Task 9: Sync de casos desde la planilla (`cases/sync.ts`)

**Files:**
- Create: `src/lib/compliance/cases/sync.ts`
- Test: `src/lib/compliance/cases/sync.test.ts`

**Interfaces:**
- Consumes: `parseEstadoSheet`/`SheetCaseRow` (Task 5), `canTransition` (Task 4B), `exportGoogleFile` (drive), `EstadoAdministrativo` (Task 2).
- Produces (puras, testeables sin DB):
  - `mapSheetRowToCaseRecord(r, now?) → CaseRecord` (origen='sheet', confianza='confirmada', activo=true, row_hash).
  - `planCaseChanges(rows, prior): { apply: SheetCaseRow[]; blocked: { item_id, from, to }[] }` — valida transición vs estado activo previo (D11).
  - `evidenceFor(args) → EvidenceRecord` (origen='sheet', nivel_verificacion='confirmada', from/to, fecha, referencia).
- Produces (orquestación): `syncCasesFromSheet(db, deps): Promise<{ upserted: number; closed: number; evidence: number; blocked: number; errors: string[]; skipped?: string }>` con `deps = { fileId, readCsv?, dict? }`. Por cada cambio aplicado: cierra el caso previo, inserta el nuevo (devuelve id) e inserta `compliance_evidence`. Por cada bloqueado: alerta `review` + error.

- [ ] **Step 1: Escribir el test (falla)** — sólo funciones puras (sin red ni DB).

Crear `src/lib/compliance/cases/sync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapSheetRowToCaseRecord, planCaseChanges, evidenceFor } from "./sync";
import type { SheetCaseRow } from "./sheet";

const row = (over: Partial<SheetCaseRow> = {}): SheetCaseRow => ({
  item_id: "MAG-04", sede: "MAGALDI", tipo_certificado: "CAA", expediente_nro: "EX-1",
  organismo: "MAD", estado_administrativo: "en_tramite", etapa: "pronto_despacho",
  nivel_riesgo: "alto", fecha_inicio: "2023-09-01", fecha_pronto_despacho: "2025-02-01",
  ultima_actuacion: "X", proxima_accion: "Y", observaciones: "Z", ...over,
});

describe("mapSheetRowToCaseRecord", () => {
  it("marca origen=sheet, confianza=confirmada, activo=true, con row_hash", () => {
    const rec = mapSheetRowToCaseRecord(row());
    expect(rec.origen).toBe("sheet");
    expect(rec.confianza).toBe("confirmada");
    expect(rec.activo).toBe(true);
    expect(rec.estado_administrativo).toBe("en_tramite");
    expect(typeof rec.row_hash).toBe("string");
    expect(rec.row_hash.length).toBeGreaterThan(0);
  });
});

describe("planCaseChanges · valida transición vs estado activo previo (D11)", () => {
  it("creación (sin caso previo) siempre se aplica", () => {
    const { apply, blocked } = planCaseChanges([row()], new Map());
    expect(apply).toHaveLength(1);
    expect(blocked).toHaveLength(0);
  });
  it("transición permitida (en_tramite→pendiente_emision) se aplica", () => {
    const prior = new Map([["MAG-04", "en_tramite" as const]]);
    const { apply, blocked } = planCaseChanges([row({ estado_administrativo: "pendiente_emision" })], prior);
    expect(apply).toHaveLength(1);
    expect(blocked).toHaveLength(0);
  });
  it("transición prohibida (rechazado→vigente) se bloquea y NO se aplica", () => {
    const prior = new Map([["MAG-04", "rechazado" as const]]);
    const { apply, blocked } = planCaseChanges([row({ estado_administrativo: "vigente" })], prior);
    expect(apply).toHaveLength(0);
    expect(blocked).toEqual([{ item_id: "MAG-04", from: "rechazado", to: "vigente" }]);
  });
});

describe("evidenceFor", () => {
  it("registra origen=sheet, nivel_verificacion=confirmada y la transición", () => {
    const ev = evidenceFor({ caseId: "c1", itemId: "MAG-04", from: "en_tramite", to: "pendiente_emision", fecha: "2025-02-01" });
    expect(ev.origen).toBe("sheet");
    expect(ev.nivel_verificacion).toBe("confirmada");
    expect(ev.from_estado).toBe("en_tramite");
    expect(ev.to_estado).toBe("pendiente_emision");
    expect(ev.case_id).toBe("c1");
  });
});
```

- [ ] **Step 2: Correr (falla)**

Run: `npx vitest run src/lib/compliance/cases/sync.test.ts`
Expected: FAIL ("Cannot find module './sync'").

- [ ] **Step 3: Implementar**

Crear `src/lib/compliance/cases/sync.ts`:

```ts
/**
 * Paso 0 del cron: leer la planilla 00_ESTADO_COMPLIANCE (Google Sheet → CSV),
 * normalizar y upsert idempotente en compliance_cases (origen='sheet', confianza='confirmada').
 * No muta nada fuera de compliance_cases.
 */
import { createHash } from "crypto";
import { exportGoogleFile } from "@/lib/drive/client";
import { parseEstadoSheet, type SheetCaseRow } from "./sheet";
import { canTransition } from "./transitions";
import type { EstadoAdministrativo } from "./types";
import type { NormRow } from "./normalize";

export interface CaseRecord {
  item_id: string;
  sede: string | null;
  tipo_certificado: string | null;
  expediente_nro: string | null;
  organismo: string | null;
  estado_administrativo: string;
  etapa: string | null;
  nivel_riesgo: string | null;
  fecha_inicio: string | null;
  fecha_pronto_despacho: string | null;
  ultima_actuacion: string | null;
  proxima_accion: string | null;
  observaciones: string | null;
  origen: "sheet";
  confianza: "confirmada";
  activo: true;
  row_hash: string;
  last_synced_at: string;
}

export function mapSheetRowToCaseRecord(r: SheetCaseRow, now: string = new Date().toISOString()): CaseRecord {
  const hash = createHash("sha1").update(JSON.stringify(r)).digest("hex");
  return {
    item_id: r.item_id,
    sede: r.sede,
    tipo_certificado: r.tipo_certificado,
    expediente_nro: r.expediente_nro,
    organismo: r.organismo,
    estado_administrativo: r.estado_administrativo,
    etapa: r.etapa,
    nivel_riesgo: r.nivel_riesgo,
    fecha_inicio: r.fecha_inicio,
    fecha_pronto_despacho: r.fecha_pronto_despacho,
    ultima_actuacion: r.ultima_actuacion,
    proxima_accion: r.proxima_accion,
    observaciones: r.observaciones,
    origen: "sheet",
    confianza: "confirmada",
    activo: true,
    row_hash: hash,
    last_synced_at: now,
  };
}

export interface EvidenceRecord {
  case_id: string | null;
  item_id: string | null;
  from_estado: string | null;
  to_estado: string;
  origen: "sheet";
  nivel_verificacion: "confirmada";
  fecha_evidencia: string | null;
  drive_file_id: string | null;
  url: string | null;
  titulo: string | null;
  descripcion: string | null;
}

/** Construye la evidencia de un cambio de estado (D12). En iteración 1 el respaldo es la planilla. */
export function evidenceFor(args: {
  caseId: string | null;
  itemId: string | null;
  from: EstadoAdministrativo | null;
  to: EstadoAdministrativo;
  fecha: string | null;
  titulo?: string | null;
}): EvidenceRecord {
  return {
    case_id: args.caseId,
    item_id: args.itemId,
    from_estado: args.from,
    to_estado: args.to,
    origen: "sheet",
    nivel_verificacion: "confirmada",
    fecha_evidencia: args.fecha,
    drive_file_id: null,
    url: null,
    titulo: args.titulo ?? "Planilla 00_ESTADO_COMPLIANCE",
    descripcion: `Cambio de estado ${args.from ?? "—"} → ${args.to} confirmado en la planilla.`,
  };
}

/** Decide qué filas se aplican y cuáles se bloquean por transición inválida (D11). PURA. */
export function planCaseChanges(
  rows: SheetCaseRow[],
  prior: Map<string, EstadoAdministrativo>,
): { apply: SheetCaseRow[]; blocked: { item_id: string; from: EstadoAdministrativo; to: EstadoAdministrativo }[] } {
  const apply: SheetCaseRow[] = [];
  const blocked: { item_id: string; from: EstadoAdministrativo; to: EstadoAdministrativo }[] = [];
  for (const r of rows) {
    const from = prior.get(r.item_id) ?? "sin_iniciar";
    const to = r.estado_administrativo;
    if (canTransition(from, to)) apply.push(r);
    else blocked.push({ item_id: r.item_id, from, to });
  }
  return { apply, blocked };
}

// AdminDb laxo para no acoplar al tipo de Supabase en este módulo.
type DbLike = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export interface SyncCasesDeps {
  fileId: string;
  /** Lector de CSV (inyectable para test). Default: exportGoogleFile como CSV. */
  readCsv?: (fileId: string) => Promise<string>;
  /** Diccionario adicional (DB). Default: DEFAULT_DICT del parser. */
  dict?: NormRow[];
}

export async function syncCasesFromSheet(
  db: DbLike,
  deps: SyncCasesDeps,
): Promise<{ upserted: number; closed: number; evidence: number; blocked: number; errors: string[]; skipped?: string }> {
  if (!deps.fileId) return { upserted: 0, closed: 0, evidence: 0, blocked: 0, errors: [], skipped: "COMPLIANCE_ESTADO_SHEET_FILE_ID ausente" };
  const read = deps.readCsv ?? ((id: string) => exportGoogleFile(id, "text/csv"));

  let csv: string;
  try {
    csv = await read(deps.fileId);
  } catch (e) {
    return { upserted: 0, closed: 0, evidence: 0, blocked: 0, errors: [`No se pudo leer la planilla: ${e instanceof Error ? e.message : String(e)}`] };
  }

  const { rows, errors } = parseEstadoSheet(csv, deps.dict);
  const now = new Date().toISOString();

  // Estado activo previo por ítem (para validar transición, D11).
  const prior = new Map<string, EstadoAdministrativo>();
  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  if (itemIds.length) {
    const { data, error } = await db
      .from("compliance_cases")
      .select("item_id,estado_administrativo")
      .in("item_id", itemIds)
      .eq("activo", true);
    if (error) errors.push(`Lectura de casos activos: ${error.message}`);
    for (const c of (data ?? []) as Array<{ item_id: string; estado_administrativo: EstadoAdministrativo }>) {
      prior.set(c.item_id, c.estado_administrativo);
    }
  }

  const { apply, blocked } = planCaseChanges(rows, prior);

  // Transiciones inválidas → NO se aplican: alerta de revisión + error de corrida (D11).
  for (const b of blocked) errors.push(`Transición no permitida ${b.from}→${b.to} para ${b.item_id}: cambio no aplicado.`);
  if (blocked.length) {
    const reviewRows = blocked.map((b) => ({
      item_id: b.item_id, nivel: "warning", kind: "review",
      titulo: `${b.item_id} — transición de estado no permitida`,
      detalle: `La planilla pide ${b.from}→${b.to}, transición inválida. Estado conservado. Revisar.`,
      estado: "abierta", origen: "sheet", confianza: "confirmada",
    }));
    const { error } = await db.from("compliance_alerts").insert(reviewRows);
    if (error) errors.push(`Alertas de revisión (transiciones): ${error.message}`);
  }

  let closed = 0, upserted = 0, evidence = 0;
  for (const r of apply) {
    const from = prior.get(r.item_id) ?? null;
    if (from === r.estado_administrativo) continue; // idempotencia: sin cambio → sin evidencia

    // 1) Cerrar el caso activo previo (sólo origen sheet).
    const close = await db
      .from("compliance_cases")
      .update({ activo: false, updated_at: now })
      .eq("item_id", r.item_id).eq("activo", true).eq("origen", "sheet");
    if (close.error) { errors.push(`Cierre previo ${r.item_id}: ${close.error.message}`); continue; }
    if (from) closed += 1;

    // 2) Insertar el nuevo caso activo (devuelve id para la evidencia).
    const rec = mapSheetRowToCaseRecord(r, now);
    const ins = await db.from("compliance_cases").insert(rec).select("id").single();
    if (ins.error || !ins.data) { errors.push(`Insert caso ${r.item_id}: ${ins.error?.message ?? "sin id"}`); continue; }
    upserted += 1;
    const caseId = (ins.data as { id: string }).id;

    // 3) Registrar evidencia del cambio de estado (D12).
    const ev = evidenceFor({
      caseId, itemId: r.item_id, from: from as EstadoAdministrativo | null,
      to: r.estado_administrativo, fecha: r.fecha_pronto_despacho ?? r.fecha_inicio ?? null,
    });
    const evIns = await db.from("compliance_evidence").insert(ev);
    if (evIns.error) errors.push(`Evidencia ${r.item_id}: ${evIns.error.message}`);
    else evidence += 1;
  }

  return { upserted, closed, evidence, blocked: blocked.length, errors };
}
```

> Si la planilla se mantiene como `.xlsx` (no Google Sheet nativa), reemplazar `readCsv` por un lector con `downloadFileBuffer` + `exceljs` (patrón `src/lib/tesoreria/caja-chica/sync-drive.ts`). El default asume Google Sheet nativa (export CSV).

- [ ] **Step 4: Correr (pasa) + typecheck**

Run: `npx vitest run src/lib/compliance/cases/sync.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance/cases/sync.ts src/lib/compliance/cases/sync.test.ts
git commit -m "feat(compliance): syncCasesFromSheet — planilla + validación de transiciones (D11) + evidencias (D12)"
```

---

## Task 10: Join del caso activo en el loader (`source.ts`)

**Files:**
- Modify: `src/lib/compliance/source.ts` (`loadComplianceItems`, `loadComplianceItem`)

**Interfaces:**
- Consumes: `ComplianceCaseLite` (Task 2).
- Produces: ítems con `activeCase` adjunto cuando hay caso activo en `compliance_cases`.

- [ ] **Step 1: Agregar el fetch de casos activos**

En `source.ts`, tras los imports, agregar helper:

```ts
import type { ComplianceCaseLite } from "./cases/types";

async function loadActiveCases(
  db: ReturnType<typeof createClient>,
): Promise<Map<string, ComplianceCaseLite>> {
  const map = new Map<string, ComplianceCaseLite>();
  if (!db) return map;
  try {
    const { data, error } = await db
      .from("compliance_cases")
      .select("item_id,estado_administrativo,etapa,nivel_riesgo,origen,confianza,confianza,activo")
      .eq("activo", true);
    if (error || !data) return map; // tabla inexistente (migración no aplicada) → sin casos
    for (const r of data as Array<Record<string, string | null>>) {
      if (!r.item_id) continue;
      map.set(r.item_id, {
        estadoAdministrativo: (r.estado_administrativo ?? "sin_iniciar") as ComplianceCaseLite["estadoAdministrativo"],
        etapa: (r.etapa ?? null) as ComplianceCaseLite["etapa"],
        nivelRiesgo: (r.nivel_riesgo ?? null) as ComplianceCaseLite["nivelRiesgo"],
        origen: (r.origen ?? "sheet") as ComplianceCaseLite["origen"],
        confianza: (r.confianza ?? "confirmada") as ComplianceCaseLite["confianza"],
      });
    }
  } catch { /* sin casos */ }
  return map;
}
```

> Corregir el `.select`: las columnas son `item_id,estado_administrativo,etapa,nivel_riesgo,origen,confianza,activo` (sin duplicar `confianza`).

- [ ] **Step 2: Adjuntar `activeCase` en `loadComplianceItems`**

En el bloque `try` de `loadComplianceItems`, tras `const rows = (data ?? []) as ComplianceRow[];` y el chequeo de vacío, reemplazar el `return` de éxito por:

```ts
    const cases = await loadActiveCases(db);
    const items = rows.map((r) => {
      const it = rowToItem(r);
      const c = cases.get(it.id);
      return c ? { ...it, activeCase: c } : it;
    });
    return { items, origin: "supabase", reason: null };
```

- [ ] **Step 3: Adjuntar en `loadComplianceItem` (ficha por id)**

En `loadComplianceItem`, reemplazar el `return deriveComplianceStatus(rowToItem(data as ComplianceRow));` por:

```ts
    const cases = await loadActiveCases(db);
    const it = rowToItem(data as ComplianceRow);
    const c = cases.get(it.id);
    return deriveComplianceStatus(c ? { ...it, activeCase: c } : it);
```

- [ ] **Step 4: Typecheck + corrida completa de compliance**

Run: `npm run typecheck && npx vitest run src/lib/compliance`
Expected: OK + todos los tests de compliance en verde.

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance/source.ts
git commit -m "feat(compliance): adjuntar caso activo a los ítems en el loader del cockpit"
```

---

## Task 11: Cron — Paso 0 (planilla) + `rebuildAlerts` con cascada + alertas review

**Files:**
- Modify: `src/lib/compliance/sync/engine.ts`

**Interfaces:**
- Consumes: `syncCasesFromSheet` (Task 9), `deriveComplianceStatus` (Task 6), `alertSeverity` (Task 4), `loadActiveCases`-equivalente (acá se arma un mapa local desde `compliance_cases`).
- Produces: corrida que (a) ingesta la planilla primero, (b) recalcula alertas con el color nuevo + severidad por riesgo, (c) emite alertas `kind='review'` para evidencia documental divergente.

- [ ] **Step 1: Importar y ejecutar el Paso 0**

En `engine.ts`, agregar import:

```ts
import { syncCasesFromSheet } from "@/lib/compliance/cases/sync";
```

Tras resolver la carpeta y ANTES del walk (después del bloque que carga `itemRows`, ~línea 150), agregar:

```ts
  // Paso 0: la planilla 00_ESTADO_COMPLIANCE es la fuente primaria del estado administrativo.
  let casesUpserted = 0;
  if (!dryRun) {
    try {
      const res = await syncCasesFromSheet(db, { fileId: env.compliance.estadoSheetFileId });
      casesUpserted = res.upserted;
      if (res.skipped) events.push({ level: "info", category: "item", action: "cases_skipped", detail: res.skipped });
      else events.push({ level: "info", category: "item", action: "cases_synced", detail: `${res.upserted} casos (${res.closed} cerrados).` });
      for (const e of res.errors) events.push({ level: "warn", category: "item", action: "cases_error", detail: e });
    } catch (e) {
      events.push({ level: "warn", category: "item", action: "cases_error", detail: msg(e) });
    }
  }
```

> `casesUpserted` se puede sumar al `report` / log si se desea (opcional). El walk de documentos sigue igual.

- [ ] **Step 2: Cargar mapa de casos activos para el rebuild**

Modificar la firma de `rebuildAlerts` para recibir el mapa, y construirlo antes de llamarla. Reemplazar la llamada (`alertsCreated = await rebuildAlerts(db, itemRows, runId, events);`) por:

```ts
        const activeCases = await loadActiveCasesMap(db);
        alertsCreated = await rebuildAlerts(db, itemRows, activeCases, runId, events);
```

Y agregar el helper (junto a los otros helpers del módulo):

```ts
import type { ComplianceCaseLite } from "@/lib/compliance/cases/types";

async function loadActiveCasesMap(db: AdminDb): Promise<Map<string, ComplianceCaseLite>> {
  const map = new Map<string, ComplianceCaseLite>();
  try {
    const { data, error } = await db
      .from("compliance_cases")
      .select("item_id,estado_administrativo,etapa,nivel_riesgo,origen,confianza,activo")
      .eq("activo", true);
    if (error || !data) return map;
    for (const r of data as Array<Record<string, string | null>>) {
      if (!r.item_id) continue;
      map.set(r.item_id, {
        estadoAdministrativo: (r.estado_administrativo ?? "sin_iniciar") as ComplianceCaseLite["estadoAdministrativo"],
        etapa: (r.etapa ?? null) as ComplianceCaseLite["etapa"],
        nivelRiesgo: (r.nivel_riesgo ?? null) as ComplianceCaseLite["nivelRiesgo"],
        origen: (r.origen ?? "sheet") as ComplianceCaseLite["origen"],
        confianza: (r.confianza ?? "confirmada") as ComplianceCaseLite["confianza"],
      });
    }
  } catch { /* sin casos */ }
  return map;
}
```

- [ ] **Step 3: Reescribir `rebuildAlerts` con cascada + severidad por riesgo**

Reemplazar el cuerpo de `rebuildAlerts` (la firma nueva + el loop) por:

```ts
import { alertSeverity } from "@/lib/compliance/semaforo";

async function rebuildAlerts(
  db: AdminDb,
  itemRows: ComplianceRow[],
  activeCases: Map<string, ComplianceCaseLite>,
  runId: string | null,
  events: SyncEvent[],
): Promise<number> {
  await db
    .from("compliance_alerts")
    .update({ estado: "resuelta", resolved_at: new Date().toISOString() })
    .eq("estado", "abierta")
    .not("run_id", "is", null);

  const rows: Record<string, unknown>[] = [];
  for (const r of itemRows) {
    const baseItem = rowToItem(r);
    const c = activeCases.get(baseItem.id) ?? null;
    const it = deriveComplianceStatus(c ? { ...baseItem, activeCase: c } : baseItem);
    if (it.riesgo === "Verde") continue;

    const nivel = alertSeverity(it.nivelRiesgo ?? null, it.riesgo);
    let kind: "expiration" | "missing_doc" | "audit_observation";
    let titulo: string;
    let detalle: string;

    if (it.riesgo === "Naranja") {
      kind = "audit_observation";
      titulo = `${it.documento} — En trámite administrativo`;
      detalle = c?.etapa
        ? `Expediente en trámite (${c.etapa}). ${it.nota || ""}`.trim()
        : `Expediente en trámite. ${it.nota || ""}`.trim();
    } else if (it.vencimiento) {
      kind = "expiration";
      titulo = `${it.documento} — ${it.estado}`;
      detalle =
        it.dias !== null && it.dias < 0
          ? `Vencido hace ${Math.abs(it.dias)} días (${it.venc_fmt}).`
          : `Vence en ${it.dias} días (${it.venc_fmt}).`;
    } else if (it.riesgo === "Rojo") {
      kind = "missing_doc";
      titulo = `${it.documento} — faltante / en proyecto`;
      detalle = it.nota || "Documento faltante o brecha regulatoria a cerrar.";
    } else {
      kind = "audit_observation";
      titulo = `${it.documento} — a verificar`;
      detalle = it.nota || "Documentación a verificar.";
    }

    rows.push({
      item_id: it.id,
      nivel,
      kind,
      titulo,
      detalle,
      due_date: it.vencimiento,
      dias: it.dias,
      run_id: runId,
      estado: "abierta",
      origen: c?.origen ?? "sheet",
      confianza: c?.confianza ?? "confirmada",
    });
  }

  if (rows.length) {
    const { error } = await db.from("compliance_alerts").insert(rows);
    if (error) throw new Error(error.message);
    events.push({ level: "info", category: "alert", action: "rebuilt", detail: `${rows.length} alertas vigentes.` });
  }
  return rows.length;
}
```

> Ajustar `countAlertsDryRun` para no romper tipos (sigue usando `deriveComplianceStatus(rowToItem(r))` sin caso; aceptable para el conteo dry-run).

- [ ] **Step 4: Alertas de evidencia secundaria (`review`) — NO mutan estado**

Dentro del loop del walk (donde se arma `docRows`), cuando un documento tenga `vencimiento` extraído POSTERIOR al del ítem asociado y el ítem tenga caso activo, encolar una alerta `review`. Tras el upsert de documentos (después del bloque de `documentsRemoved`, ~línea 288), agregar:

```ts
    // Evidencia secundaria → alertas de revisión (confianza por origen). NUNCA muta estado.
    if (!dryRun && reviewSignals.length) {
      const reviewRows = reviewSignals.map((s) => ({
        item_id: s.itemId,
        nivel: "info",
        kind: "review",
        titulo: `${s.titulo} — revisar y confirmar en la planilla`,
        detalle: s.detalle,
        run_id: runId,
        estado: "abierta",
        origen: "nombre_archivo",
        confianza: "baja",
      }));
      const { error } = await db.from("compliance_alerts").insert(reviewRows);
      if (error) events.push({ level: "warn", category: "alert", action: "review_error", detail: error.message });
    }
```

Y declarar/poblar `reviewSignals` en el loop del walk: junto a `const itemId = itemForCombo(...)`, agregar la captura:

```ts
      // (declarar antes del loop): const reviewSignals: { itemId: string; titulo: string; detalle: string }[] = [];
      if (itemId && vencimiento) {
        reviewSignals.push({
          itemId,
          titulo: file.name,
          detalle: `Documento con vencimiento ${vencimiento} detectado en Drive (confianza baja). Confirmar en 00_ESTADO_COMPLIANCE.`,
        });
      }
```

> Declarar `const reviewSignals: { itemId: string; titulo: string; detalle: string }[] = [];` junto a `seenDriveIds` (~línea 181). Es una señal conservadora de iteración 1 (no filtra por "posterior al del ítem" para no acoplar a fechas del snapshot); el objetivo es avisar "hay un documento nuevo, revisalo", sin tocar estado.

- [ ] **Step 5: Typecheck + corrida de compliance**

Run: `npm run typecheck && npx vitest run src/lib/compliance`
Expected: OK + verde. (No hay test unitario del engine acá; la lógica testeada vive en las unidades puras. Verificación funcional = dry-run en Task 13.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/compliance/sync/engine.ts
git commit -m "feat(compliance): cron lee planilla primero + alertas por cascada/severidad + review signals"
```

---

## Task 12: Dashboard — etiqueta 🟠, panel del caso, solapa Revisión

**Files:**
- Modify: `src/components/compliance/ui.tsx` (badge ya usa `RISK_LABEL`; agregar panel de caso + chips)
- Modify: `src/app/(app)/anmat/page.tsx` (render KPI nuevo + panel del caso + solapa Revisión)

**Interfaces:**
- Consumes: `ComplianceItem` con `estadoAdministrativo`/`etapa`/`nivelRiesgo`/`activeCase` (Task 6), `executiveKpis` (Task 7).

- [ ] **Step 1: Chip de caso/confianza en `ui.tsx`**

Agregar un componente `CaseChips` que renderice estado administrativo, etapa, nivel de riesgo y origen/confianza cuando el ítem tenga `activeCase`:

```tsx
export function CaseChips({ item }: { item: ComplianceItem }) {
  if (!item.activeCase) return null;
  const { estadoAdministrativo, etapa, nivelRiesgo, origen, confianza } = {
    estadoAdministrativo: item.estadoAdministrativo, etapa: item.etapa, nivelRiesgo: item.nivelRiesgo,
    origen: item.activeCase.origen, confianza: item.activeCase.confianza,
  };
  return (
    <div className="flex flex-wrap gap-1 text-[11px]">
      {estadoAdministrativo && <span className="rounded px-1.5 py-0.5 bg-white/5">{estadoAdministrativo}{etapa ? ` · ${etapa}` : ""}</span>}
      {nivelRiesgo && <span className="rounded px-1.5 py-0.5 bg-white/5">riesgo: {nivelRiesgo}</span>}
      <span className="rounded px-1.5 py-0.5 bg-white/5 opacity-70">{origen}/{confianza}</span>
    </div>
  );
}
```

> Ajustar clases al sistema de estilos real del cockpit (revisar `RiskBadge` vecino para tono/tokens). Importar `ComplianceItem` si no está ya.

- [ ] **Step 2: Render del KPI y panel en `page.tsx`**

- Los KPIs ya salen de `executiveKpis()` (Task 7): verificar que la grilla de KPIs renderiza el nuevo `en_tramite` (si la grilla mapea el array, sale solo; si hay claves hardcodeadas, agregar la card de `en_tramite`).
- En la fila/detalle de cada ítem de la matriz, insertar `<CaseChips item={it} />` debajo del `RiskBadge`.
- En el AlertCenter (`#alertas`), agregar una solapa/columna "Revisión" que muestre las alertas `kind='review'` (vienen del loader de alertas si el cockpit ya las lee; si el cockpit aún no lee `compliance_alerts`, mostrar las señales del ítem por `activeCase` es suficiente para iteración 1 — documentar el límite).

- [ ] **Step 3: Verificación en preview (sin red a Supabase real de prod)**

Como el cockpit cae al snapshot (`ITEMS`) sin casos, el cambio visible inmediato es la **nueva etiqueta**: 🟠 = "En trámite administrativo", 🟡 = "Próximo a vencer". Verificar con el flujo de preview:

Run (preview): levantar dev server del worktree (`next dev -p 3030`), abrir `/anmat`, confirmar:
- Los badges 🟠/🟡 muestran las etiquetas nuevas.
- El KPI "En trámite administrativo" aparece.
- No hay errores de consola.

> Sin casos cargados, MAG-04 sigue 🔴 (snapshot sin `activeCase`). El cambio 🔴→🟠 de MAG-04 se valida recién cuando exista la fila en la planilla y el cron corra (post-aplicación de migración, gateado). Documentar esto en el handoff.

- [ ] **Step 4: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
Expected: OK.

```bash
git add src/components/compliance/ui.tsx "src/app/(app)/anmat/page.tsx"
git commit -m "feat(compliance): cockpit muestra estado administrativo, riesgo y origen/confianza"
```

---

## Task 13: Self-review, suite completa y handoff

**Files:** (ninguno nuevo)

- [ ] **Step 1: Suite completa + typecheck + lint**

Run: `npm run typecheck && npm run lint && npx vitest run src/lib/compliance`
Expected: TODO verde.

- [ ] **Step 2: Dry-run del motor (sin escribir)**

Como `runComplianceSync` degrada si Drive/Supabase no están configurados, verificar el camino `skipped`/`dry`:
- Si hay credenciales de DEV disponibles, `GET /api/compliance/sync?dry=1` con `Authorization: Bearer <CRON_SECRET>` debe responder 200 con `dry_run:true` y `cases_skipped` (planilla no configurada) sin tocar datos.
- Si no hay credenciales, documentar que el dry-run se valida en el ambiente de Dirección.

- [ ] **Step 3: Verificación contra spec (checklist)**

Confirmar que el plan cubrió: D6 (anticipación parametrizable, Task 1+4+6), D7 (riesgo≠color, Task 4), D8 (`pendiente_emision`, Task 1+4+6), D9 (diccionario, Task 1+3), D10 (origen+confianza, Task 1+2+9+11), **D11 (máquina de estados, Task 1+4B+9)**, **D12 (evidencias `compliance_evidence`, Task 1+9)**, **D13 (alcance Sheets+Drive, sin correos)**. Cascada §5.2 (Task 4). Máquina §5.4 (Task 4B). Planilla §4 (Task 5+9). Cron §6 (Task 11). Dashboard §7 (Task 12).

- [ ] **Step 4: Resumen de estado para Dirección**

Dejar nota en el commit final / PR-draft: migración `0141` **sin aplicar**; `COMPLIANCE_ESTADO_SHEET_FILE_ID` sin configurar; el cambio 🔴→🟠 de casos reales (ej. MAG-04) requiere (1) aplicar `0081`+`0141`, (2) crear la planilla y cargar `COMPLIANCE_ESTADO_SHEET_FILE_ID`, (3) corrida del cron. Nada mergeado/pusheado/deployado.

- [ ] **Step 5: Commit final (si quedó algo suelto)**

```bash
git add -A && git commit -m "chore(compliance): cierre de plan — suite verde, handoff a Dirección" || echo "nada que commitear"
```

---

## Self-Review del plan (hecho por el autor)

- **Cobertura de spec:** D1–D13 y §§3–8 mapeadas a tareas (ver Task 13 Step 3). Máquina de estados (Task 4B) y evidencias (Task 1+9) incluidas. ✔
- **Placeholders:** sin "TBD/TODO"; todo paso con código real o comando con salida esperada. ✔
- **Consistencia de tipos:** `Semaforo`=`Riesgo` (color); `nivelRiesgo` (prioridad) separado; `ComplianceCaseLite` consumido igual en `data.ts`, `source.ts`, `engine.ts`; `deriveComplianceStatus(item, today?, anticConfig?)` con la misma firma en todos los call-sites. ✔
- **Riesgo conocido:** `compliance_alerts.origen/confianza` y `kind='review'` dependen de `0081` aplicada; el código degrada (los `insert` con esas columnas fallan si la tabla no existe, pero el cron sólo corre con DB configurada y migraciones aplicadas — gateado). Documentado en Global Constraints y Task 13.
