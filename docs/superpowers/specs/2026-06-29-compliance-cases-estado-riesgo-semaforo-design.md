# Compliance · Estado administrativo, Riesgo y Semáforo (modelo de casos regulatorios)

- **Fecha**: 2026-06-29
- **Autor**: Martín Battaglia (Dirección) + Claude
- **Estado**: Diseño **aprobado** (enfoque ①, con 3 ajustes de arquitectura + confidence en 2 dimensiones + 4 puntos cerrados). Próximo paso: plan de implementación (`writing-plans`). **No implementar / no migrar / no mergear hasta revisión final.**
- **Repo**: `tops-ordenes` (TOPS NEXUS · Next.js + Supabase · deploy manual Netlify)
- **Worktree/rama**: `.claude/worktrees/feat+compliance-cases-semaforo` · base `origin/main` (limpia, sin commits fiscales)
- **Módulo afectado**: `src/lib/compliance/*`, `src/components/compliance/*`, `src/app/(app)/anmat/*`, `src/app/api/compliance/sync/*`, `supabase/migrations/`

---

## 1. Problema y objetivo

Hoy el estado de cada certificado del Cockpit de Compliance se calcula **exclusivamente por fecha de vencimiento** en `deriveComplianceStatus()` ([src/lib/compliance/data.ts:132](../../../src/lib/compliance/data.ts)):

| Condición | Color actual | Etiqueta actual |
|---|---|---|
| `dias < 0` | 🔴 Rojo | Vencido |
| `0 ≤ dias ≤ 30` | 🟠 Naranja | Vencimiento inminente |
| `31 ≤ dias ≤ 60` | 🟡 Amarillo | Alerta preventiva |
| `dias > 60` | 🟢 Verde | Vigente |
| `vencimiento = null` | (preserva base) | (preserva base) |

Esto produce **falsos rojos**: un certificado vencido cuyo trámite de renovación está activo ante el organismo aparece como 🔴, cuando **no es un incumplimiento crítico**. El número de trámite hoy vive como texto suelto en `nota`, sin modelo.

**Caso real (ya en los datos)**: `MAG-04 — CAA Nación / Generador de Residuos Peligrosos`, hoy 🔴 (vencido hace ~976 días), nota *"EN TRÁMITE (EX-2023-116887453)"*; el organismo informó *"el trámite se encuentra en la elaboración del proyecto de Disposición y Certificado"* y hay pronto despacho presentado. **Debe verse 🟠 "En trámite administrativo".**

### Objetivo

Que el semáforo refleje el **verdadero estado regulatorio** del trámite y no sólo el vencimiento cronológico, mediante:

1. Un modelo de **casos regulatorios** (`compliance_cases`) — genérico (no atado a "expediente formal").
2. Una **planilla central `00_ESTADO_COMPLIANCE`** como fuente **primaria** de verdad, leída por el cron **antes** de evaluar fechas.
3. **Separación estricta de tres conceptos**: **Estado** → determina el **color**; **Riesgo** → determina la **prioridad**; **Semáforo** = resultado computado (color), nunca mezclado con riesgo.
4. **Confianza en 2 dimensiones**: `origen` + `confianza`, para saber *cuánto* confiamos y *por qué*.
5. **Parametrización sin código**: anticipación y diccionario de normalización viven en tablas de configuración editables.
6. Diseño **escalable a cualquier obligación regulatoria futura**.

---

## 2. Decisiones cerradas

| # | Decisión | Resolución |
|---|---|---|
| D1 | Enfoque general | **① Entidad dedicada** `compliance_cases` + cascada refactorizada. |
| D2 | Formato `00_ESTADO_COMPLIANCE` | **Planilla Google Sheets central**, una fila por caso; el cron la lee por `fileId`, exporta a CSV (`exportGoogleFile`) y parsea determinísticamente (sin IA). |
| D3 | Nombre de la entidad | **`compliance_cases`** (genérico; `expediente_nro` opcional). |
| D4 | Fuente de verdad | Planilla **primaria pero no única**: el cron sigue inspeccionando docs/PDFs/correos/nombres de archivo para detectar evidencia nueva y **generar alertas de revisión, sin modificar el estado**. |
| D5 | Separación de conceptos | **Estado**, **Riesgo** y **Semáforo** independientes. |
| **D6** | **Anticipación (umbral 🟡)** | **Parametrizable, sin hardcode.** Jerarquía: **override del ítem → config del tipo de obligación → default del sistema** (§3.4, §5.1). |
| **D7** | **Riesgo** | **NUNCA modifica el color.** El color surge **sólo** del estado regulatorio. El riesgo se usa para: priorizar alertas, ordenar dashboards, filtros, reportes, notificaciones y escalado operativo (§5.3). |
| **D8** | **Estado "Aprobado"** | No vuelve a 🟢 automáticamente. Se agrega estado transitorio **`pendiente_emision`** (aprobado/resolución emitida sin certificado nuevo) → 🟡. Pasa a `vigente`/🟢 sólo al incorporar el nuevo certificado y actualizar `vencimiento` (§5.2). |
| **D9** | **Vocabulario** | **Diccionario de normalización** (tabla `compliance_normalizacion`): sinónimos → valor canónico. Extensible por datos, **sin tocar el motor** (§3.5, §4.2). |
| **D10** | **Confianza** | Dos dimensiones independientes: **`origen`** ∈ {manual, sheet, documento, correo, ia, nombre_archivo} y **`confianza`** ∈ {confirmada, alta, media, baja}. Sólo `confianza='confirmada'` escribe estado (§3.1, §6). |
| **D11** | **Máquina de estados** | El `estado_administrativo` se gobierna con una **máquina de estados de transiciones permitidas** (§5.4). Un cambio que no respete una transición válida **no se aplica**: se conserva el estado previo y se emite alerta de revisión. Impide cambios inconsistentes. |
| **D12** | **Evidencias** | Entidad **`compliance_evidence`** (§3.6): registra qué documento/correo/archivo respaldó **cada cambio de estado** (transición `from→to`), con `origen`, `fecha`, **nivel de verificación** y **referencia al documento**. Trazabilidad/auditoría completa. |
| **D13** | **Alcance iteración 1** | **Sheets + Drive + Compliance** únicamente. Correos/Gmail quedan fuera (pipeline preparado, fuente diferida). |

---

## 3. Modelo de datos

### 3.1 Nueva tabla `compliance_cases`

Un caso = un proceso regulatorio asociado a un ítem. Un ítem puede tener N casos (historial); como máximo uno `activo = true`.

```sql
create table compliance_cases (
  id                    uuid primary key default gen_random_uuid(),
  item_id               text references compliance_items(id) on delete set null,
  sede                  text check (sede in ('MAGALDI','LUJAN')),       -- fallback de enlace
  tipo_certificado      text,
  expediente_nro        text,                                            -- OPCIONAL (no todo proceso tiene expediente)
  organismo             text,

  -- Dimensión 1: ESTADO ADMINISTRATIVO (determina el color)
  estado_administrativo text not null default 'sin_iniciar'
                          check (estado_administrativo in
                          ('sin_iniciar','vigente','en_tramite','observado',
                           'pendiente_emision','aprobado','rechazado')),
  etapa                 text check (etapa in
                          ('iniciado','pronto_despacho','esperando_resolucion','subsanando')),

  -- Dimensión 2: NIVEL DE RIESGO (determina la prioridad — NUNCA el color)
  nivel_riesgo          text check (nivel_riesgo in ('bajo','medio','alto','critico')),

  -- Fechas y actuaciones
  fecha_inicio          date,
  fecha_pronto_despacho date,
  ultima_actuacion      text,
  ultima_actuacion_fecha date,
  proxima_accion        text,
  proxima_accion_fecha  date,
  observaciones         text,

  -- Procedencia / confianza (2 dimensiones — D10)
  origen                text not null default 'sheet'
                          check (origen in ('manual','sheet','documento','correo','ia','nombre_archivo')),
  confianza             text not null default 'confirmada'
                          check (confianza in ('confirmada','alta','media','baja')),
  confianza_score       numeric(4,3),                                    -- opcional 0..1 (p.ej. origen IA)

  activo                boolean not null default true,
  row_hash              text,
  last_synced_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index compliance_cases_item_idx    on compliance_cases(item_id);
create index compliance_cases_activo_idx   on compliance_cases(item_id) where activo;
create index compliance_cases_estado_idx   on compliance_cases(estado_administrativo);
create index compliance_cases_riesgo_idx   on compliance_cases(nivel_riesgo);
```

**Regla de escritura (D10)**: sólo registros con `confianza='confirmada'` (típicamente `origen` = `sheet` o `manual`) escriben `estado_administrativo`/`nivel_riesgo`. Información de menor confianza (`documento`/`correo`/`nombre_archivo`/`ia`) **no** muta el estado: sólo genera alertas de revisión (§6).

**RLS**: `SELECT` para `authenticated`; escritura sólo `service_role`/`admin`.

### 3.2 Cambios en `compliance_items`

```sql
alter table compliance_items
  add column anticipacion_dias int;   -- override del umbral 🟡 (nivel más alto de la jerarquía D6). NULL ⇒ se resuelve por config.
```

`compliance_items.riesgo` (color del snapshot auditado) se mantiene como **semilla/base**; deja de ser la fuente de verdad del color en runtime. El semáforo vivo se **computa** (§5) y se expone como `ComplianceItem.semaforo`. Ver §7.1 (compatibilidad).

### 3.3 Cambios en `compliance_alerts` (de migración 0081)

```sql
alter table compliance_alerts
  add column origen     text check (origen in ('manual','sheet','documento','correo','ia','nombre_archivo')),
  add column confianza  text check (confianza in ('confirmada','alta','media','baja')),
  add column case_id    uuid references compliance_cases(id) on delete set null;
-- Extender CHECK de 'kind' para incluir 'review':
--   kind ∈ ('expiration','missing_doc','audit_observation','regulatory_update','review')
```

### 3.4 Nueva tabla `compliance_anticipacion_config` (D6 — parametrizable)

```sql
create table compliance_anticipacion_config (
  frecuencia       text primary key,   -- 'Mensual','Trimestral',...,'__default__'
  anticipacion_dias int not null,
  descripcion      text,
  updated_at       timestamptz not null default now()
);
-- Seed inicial (editable sin código):
--  Mensual=7, Trimestral=15, Semestral=30, Anual=60, Bienal=90, Trienal=120, Cuatrienal=180, __default__=60
```

**RLS**: `SELECT` autenticado; escritura sólo `admin`.

### 3.5 Nueva tabla `compliance_normalizacion` (D9 — diccionario extensible)

```sql
create table compliance_normalizacion (
  id              bigserial primary key,
  dimension       text not null check (dimension in ('estado','etapa','riesgo')),
  sinonimo        text not null,         -- texto normalizado (sin acentos, minúsculas, trim)
  valor_canonico  text not null,         -- p.ej. 'en_tramite'
  unique (dimension, sinonimo)
);
```

El motor resuelve `normalizar(texto, dimension)` consultando esta tabla (cacheada por corrida). Agregar un sinónimo = `INSERT`, **sin tocar el motor**. Seed inicial en §4.2.

### 3.6 Nueva tabla `compliance_evidence` (D12 — trazabilidad de cambios de estado)

Registra **qué respaldó cada cambio de estado** de un caso (transición `from_estado → to_estado`), con su origen, nivel de verificación y referencia al documento.

```sql
create table compliance_evidence (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid references compliance_cases(id) on delete cascade,
  item_id            text references compliance_items(id) on delete set null,
  from_estado        text,                 -- estado anterior (null = creación del caso)
  to_estado          text not null,        -- estado resultante del cambio
  origen             text not null check (origen in ('manual','sheet','documento','correo','ia','nombre_archivo')),
  nivel_verificacion text not null check (nivel_verificacion in ('confirmada','alta','media','baja')),
  fecha_evidencia    date,                 -- fecha del respaldo (p.ej. fecha de la actuación/documento)
  document_id        uuid references compliance_documents(id) on delete set null,  -- doc de Drive si aplica
  drive_file_id      text,                 -- referencia directa al archivo de Drive
  url                text,                 -- webViewLink del documento
  titulo             text,                 -- nombre/descripción del respaldo
  descripcion        text,
  created_at         timestamptz not null default now()
);
create index if not exists compliance_evidence_case_idx on compliance_evidence(case_id);
create index if not exists compliance_evidence_item_idx on compliance_evidence(item_id);
```

**RLS**: `SELECT` autenticado; escritura sólo `service_role`/`admin`.

**Cuándo se escribe**: en cada **cambio de estado aplicado** dentro del cron (creación de caso o transición válida). En iteración 1 el respaldo típico es `origen='sheet'`, `nivel_verificacion='confirmada'` (la propia planilla), con referencia opcional a un documento de Drive si la fila lo menciona. La evidencia es **append-only** (no se borra): es el historial auditable. Las señales de evidencia secundaria que NO cambian estado (alertas `review`) no generan filas de evidencia.

---

## 4. La planilla `00_ESTADO_COMPLIANCE`

- Una única Google Sheet, leída por `COMPLIANCE_ESTADO_SHEET_FILE_ID` (patrón Caja Chica). Se exporta el tab a CSV con `exportGoogleFile()` ([src/lib/drive/client.ts](../../../src/lib/drive/client.ts)) y se parsea por encabezado.
- Una fila por caso. Enlace por columna **`Item ID`** (determinístico, ej. `MAG-04`); fallback `Sede` + `Tipo de certificado`.
- Toda fila ingestada ⇒ `origen='sheet'`, `confianza='confirmada'`.

### 4.1 Columnas

| Encabezado | Mapea a | Obligatoria |
|---|---|---|
| `Item ID` | `item_id` | Sí |
| `Sede` | `sede` | — |
| `Tipo de certificado` | `tipo_certificado` | Sí |
| `Expediente` | `expediente_nro` | No |
| `Organismo` | `organismo` | Sí |
| `Estado administrativo` | `estado_administrativo` (+`etapa`) | Sí |
| `Fecha de inicio` | `fecha_inicio` | — |
| `Fecha del pronto despacho` | `fecha_pronto_despacho` | — |
| `Última actuación` | `ultima_actuacion` (+ fecha) | — |
| `Próxima acción` | `proxima_accion` (+ fecha) | — |
| `Nivel de riesgo` | `nivel_riesgo` | — |
| `Observaciones` | `observaciones` | — |

**Degradación segura**: fila sin `Item ID` o con estado no normalizable ⇒ se loguea error de parseo y ese ítem cae al cálculo por fecha. No se aborta la corrida.

### 4.2 Seed del diccionario de normalización (D9)

Normalización previa: minúsculas, sin acentos, trim. Luego lookup en `compliance_normalizacion`.

**`estado`**
- `en_tramite` ← "en elaboración", "en análisis", "en estudio", "en proceso", "en trámite", "pendiente de resolución", "iniciado", "abierto", "en gestión", "expediente abierto"
- `pendiente_emision` ← "pendiente de emisión", "pendiente emisión", "aprobado sin emitir", "resolución emitida sin certificado", "a la firma"
- `aprobado` ← "aprobado", "resuelto", "emitido", "finalizado", "otorgado", "favorable"
- `observado` ← "observado", "requerido", "con observaciones", "intimado", "a subsanar"
- `rechazado` ← "rechazado", "denegado", "desestimado", "archivado", "caducado"
- `vigente` ← "vigente", "en vigencia", "al día"
- `sin_iniciar` ← "" / "sin iniciar" / "pendiente de inicio"

**`etapa`** (granularidad de `en_tramite`/`observado`, sólo auditoría)
- `pronto_despacho` ← "pronto despacho", "pronto despacho presentado"
- `esperando_resolucion` ← "esperando resolución", "en análisis", "elaboración del proyecto de disposición"
- `iniciado` ← "iniciado", "presentado"
- `subsanando` ← "subsanando", "respondiendo observaciones"

**`riesgo`** → `bajo` · `medio` · `alto` · `critico` (← "crítico"). Vacío ⇒ default por categoría (§5.3).

> El diccionario es **extensible**: agregar términos = filas nuevas, sin redeploy.

---

## 5. Cascada del semáforo

El semáforo (`verde`/`amarillo`/`naranja`/`rojo`) es **computado**, combinando **sólo** el eje **temporal** (fechas) y el **estado administrativo**. **El nivel de riesgo NO participa del color** (D7).

Eje temporal: `vigente` (`dias > anticipacion`), `proximo` (`0 ≤ dias ≤ anticipacion`), `vencido` (`dias < 0`), `sin_fecha` (`vencimiento = null`), `falta` (sin doc / base indica faltante).

### 5.1 Anticipación (jerarquía D6)

```
anticipacion(item):
  return  item.anticipacion_dias                              # 1) override del ítem
       ?? config[item.frecuencia].anticipacion_dias           # 2) config del tipo de obligación
       ?? config['__default__'].anticipacion_dias             # 3) default del sistema
```

Seed (editable en `compliance_anticipacion_config`): Mensual 7 · Trimestral 15 · Semestral 30 · Anual 60 · Bienal 90 · Trienal 120 · Cuatrienal 180 · `__default__` 60. Permanente ⇒ `sin_fecha`.

### 5.2 Matriz de combinación — función pura `computeSemaforo(temporal, estado)`

```
# 1. Vigente por fecha
if temporal == 'vigente':
    if estado == 'rechazado':           return 🔴      # rechazo manda
    if estado in ('observado','pendiente_emision'): return 🟡
    return 🟢

# 2. Próximo a vencer
if temporal == 'proximo':
    if estado == 'rechazado':           return 🔴
    return 🟡

# 3-4. Vencido o falta de documento
if temporal in ('vencido','falta'):
    if estado in ('en_tramite','observado'):        return 🟠   # EN TRÁMITE ADMINISTRATIVO
    if estado in ('pendiente_emision','aprobado'):  return 🟡   # resolución OK, falta incorporar certificado
    if estado == 'rechazado':                        return 🔴
    return 🔴                                                    # vencido sin caso activo

# 5. Sin fecha (permanente)
if temporal == 'sin_fecha':
    if estado == 'en_tramite':                       return 🟠
    if estado in ('observado','pendiente_emision','aprobado'): return 🟡
    if estado == 'rechazado':                        return 🔴
    return 🟢                                                    # permanente vigente
```

**Transición de `pendiente_emision` (D8)**: aprobado/resolución emitida sin certificado nuevo ⇒ `pendiente_emision` ⇒ 🟡. Al cargar el nuevo certificado y actualizar `vencimiento` (futuro) ⇒ estado `vigente` ⇒ 🟢. No hay salto automático a verde sin certificado vigente.

### 5.3 Riesgo = prioridad (NO color) — D7

`nivel_riesgo` (del caso, o default por categoría) se usa **exclusivamente** para:
- **priorizar alertas** (`compliance_alerts.nivel`: critico⇒critical, alto⇒warning, medio/bajo⇒info/warning);
- **ordenar dashboards** (urgencia dentro de un mismo color);
- **filtros** (por riesgo);
- **reportes** y **notificaciones**;
- **escalado operativo**.

Default por categoría (cuando la planilla no informa riesgo, editable): `ANMAT`, `Residuos`, `Habilitación`, `Impacto Ambiental`, `Incendio` ⇒ `alto`; resto ⇒ `medio`.

### 5.4 Máquina de estados administrativos (D11)

El `estado_administrativo` no cambia libremente: una transición sólo se aplica si está permitida. Esto impide cambios inconsistentes (p. ej. saltar de `rechazado` a `vigente` sin reabrir trámite).

**Transiciones permitidas** (`from → [to...]`; la auto-transición `X→X` siempre es válida por idempotencia; `sin_iniciar` como origen permite cualquier estado inicial = creación):

| Desde | Hacia permitido |
|---|---|
| `sin_iniciar` | (cualquiera — creación inicial) |
| `en_tramite` | `observado`, `pendiente_emision`, `aprobado`, `rechazado`, `vigente` |
| `observado` | `en_tramite`, `pendiente_emision`, `aprobado`, `rechazado` |
| `pendiente_emision` | `vigente`, `aprobado`, `rechazado` |
| `aprobado` | `vigente`, `pendiente_emision` |
| `vigente` | `en_tramite`, `observado`, `rechazado` |
| `rechazado` | `en_tramite`, `sin_iniciar` |

**Función pura**: `canTransition(from, to): boolean`.

**Aplicación (en el cron, Paso 0)**: para un ítem con caso activo previo en estado `prev`, si la planilla trae `next` y `canTransition(prev, next)` es **false** ⇒ **no se aplica** (se conserva el caso `prev` activo) y se emite alerta `kind='review'` ("transición no permitida `prev`→`next`, revisar planilla") + se loguea como error de corrida. Si es **true** ⇒ se cierra el caso previo, se inserta el nuevo activo y se registra una fila en `compliance_evidence` (§3.6) con la transición. La primera carga de un ítem (sin caso previo) es siempre creación válida.

> El mapa de transiciones es tuneable (constante en código; si se quiere editable por datos, se promueve a tabla en una iteración futura — YAGNI por ahora).

---

## 6. Flujo del cron (`runComplianceSync`)

Sin cambios de schedule ni auth: GitHub Action `0 0 * * *` (21:00 ART) → `POST /api/compliance/sync` con `Bearer ${CRON_SECRET}`.

1. **Paso 0 — Planilla primero (estado autoritativo)**: leer `COMPLIANCE_ESTADO_SHEET_FILE_ID` → CSV → normalizar (diccionario, §4.2). Para cada fila: cargar el caso activo previo del ítem; **validar la transición** `prev→next` con la máquina de estados (§5.4). Si es válida ⇒ cerrar el caso previo, insertar el nuevo `activo` (`origen='sheet'`, `confianza='confirmada'`) y registrar **evidencia** (`compliance_evidence`, §3.6) de la transición. Si es inválida ⇒ conservar el caso previo + alerta `kind='review'` + error de corrida. Idempotente por `row_hash` (si la fila no cambió, no genera transición ni evidencia nueva).
2. **Paso 1..N — Evidencia secundaria (NO muta estado)**: walk de Drive (docs/PDFs/nombres de archivo) y —más adelante— correos generan **alertas `kind='review'`** con su `origen` + `confianza` cuando detectan evidencia nueva/divergente. **Nunca** escriben estado.
3. **Rebuild de alertas**: `rebuildAlerts` usa la cascada (§5) para el **color** y `nivel_riesgo` para la **severidad/prioridad** (§5.3).
4. **Persistencia**: `compliance_sync_log` + contadores (`cases_upserted`, `review_alerts_created`).

**Promoción**: información de menor confianza llega como alerta de revisión → un humano la confirma editando la planilla → la siguiente corrida la promueve a estado confirmado.

### 6.1 Alcance de fuentes por iteración
- **Iteración 1**: planilla (estado) + documentos/nombres de archivo de Drive (alertas de revisión). Detección **agnóstica de fuente** por diseño.
- **Posterior**: correos (Gmail) como fuente adicional de alertas (reusa el pipeline). No bloquea iteración 1.

---

## 7. Dashboard (`/anmat`)

- **Nuevo significado de 🟠**: "En trámite administrativo" (antes "Próximo"). 🟡 = "Próximo a vencer". Ajustar `RISK_LABEL` ([data.ts:53](../../../src/lib/compliance/data.ts)).
- **KPIs**: agregar "En trámite administrativo" y "Pendiente de emisión"; ajustar `executiveKpis()` ([data.ts:251](../../../src/lib/compliance/data.ts)).
- **Panel de detalle del caso**: organismo, estado + etapa, pronto despacho, última actuación, próxima acción, observaciones, y **chips `origen`/`confianza`**.
- **Riesgo como eje separado**: chip de prioridad + orden + filtro (independiente del color, D7).
- **Centro de alertas**: solapa "Revisión" para `kind='review'` (evidencia detectada pendiente de confirmar).
- `RiskBadge` consume el `semaforo` computado.

### 7.1 Compatibilidad
- `deriveComplianceStatus(item, caso?, today)` recibe el caso activo y devuelve `{ ...item, semaforo, dias, estadoAdministrativo, nivelRiesgo, etapa }`. Donde el código lee `item.riesgo` (color) se migra a `item.semaforo`; se mantiene `riesgo` como alias temporal (deuda a limpiar). `source.ts` hace el join ítem ↔ caso activo.
- Snapshot estático (`ITEMS`) sigue como fallback; sin casos, semáforo = cascada por fecha (equivalente al actual, salvo la fusión 🟡/🟠 y el reuso de 🟠).

---

## 8. Migración y aplicación

- **Archivo**: `supabase/migrations/0125_compliance_cases.sql` — `compliance_cases`, `compliance_anticipacion_config` (+seed), `compliance_normalizacion` (+seed), `compliance_items.anticipacion_dias`, alters de `compliance_alerts`.
- **Numeración**: la base del worktree (`origin/main`) llega a `0105`, pero el universo integrado incluye prospección `0106/0107`, el rango contendido `0108–0118` (worktrees Knowledge F0.5 / Connect, no mergeados) y fiscal `0120–0124` (prod). **`0125` es el primer slot libre seguro.** Re-verificar con `ls supabase/migrations` al aplicar (prod puede usar timestamps).
- **Dependencia**: requiere `0081` aplicada primero (crea `compliance_alerts`/`compliance_documents`).
- **Gating**: code-complete, **NO se aplica / mergea / pushea / deploya**. Aplicación manual = decisión de Dirección. El cron de la planilla queda inerte hasta configurar `COMPLIANCE_ESTADO_SHEET_FILE_ID`.

---

## 9. Unidades / límites (testeable de forma aislada)

| Unidad | Responsabilidad | Entrada → Salida |
|---|---|---|
| `normalizar(texto, dimension, dict)` | Sinónimo → canónico (diccionario D9) | string → enum \| null |
| `parseEstadoSheet(csv)` | CSV planilla → filas tipadas + errores | csv → `CaseRow[]` |
| `resolveAnticipacion(item, config)` | Jerarquía D6 | item+config → int |
| `computeSemaforo(temporal, estado)` | Color (sin riesgo) | enums → semáforo |
| `alertSeverity(nivel_riesgo, semaforo)` | Prioridad (D7) | enums → nivel alerta |
| `deriveComplianceStatus(item, caso?, today)` | Orquesta temporal + cascada | item+caso → item+semáforo |
| `upsertCasesFromSheet(db, rows)` | Persistir casos (idempotente, sólo confianza=confirmada) | rows → conteos |
| `detectReviewSignals(docs, cases)` | Evidencia secundaria → alertas review | docs+cases → alerts |

Las unidades de cálculo son puras (no tocan DB) ⇒ TDD directo.

---

## 10. Fuera de alcance (YAGNI)
- **Alcance iteración 1 = Sheets + Drive + Compliance** (D13). Correos/Gmail diferidos.
- Correos/Gmail en iteración 1 (pipeline preparado, fuente diferida).
- Mapa de transiciones (§5.4) editable por datos/tabla (iteración 1 = constante en código).
- Interpretación por IA del contenido de PDFs (sólo nombres de archivo; IA ⇒ `confianza` baja/media, nunca escribe estado).
- Editor de la matriz de semáforo por UI (iteración 1 = función pura).
- Override manual del color desde el dashboard.

---

## 11. Puntos abiertos
Ninguno. Anticipación/riesgo/"aprobado"/vocabulario resueltos en D6–D9; confianza en 2 dimensiones (D10); máquina de estados (D11); evidencias (D12); alcance iteración 1 Sheets+Drive (D13). Diseño funcional y arquitectónico **cerrado**; listo para implementación.
