# PILOT READINESS PACKAGE — CONCILIACIÓN BANCARIA IA

**Clasificación:** READY FOR PILOT (condicionado)
**Fecha:** 2026-06-14
**Piloto:** Natalia · Banco Santander · Cuenta 500-003293/1 · CSV
**Worktree:** `vigilant-williamson-776080` · rama `claude/vigilant-williamson-776080`
**Gate E2E:** APPROVED (Sprints 1–4 PASS)

---

## NUMERACIÓN DEFINITIVA DE MIGRACIONES

| Nro | Archivo | Estado en prod |
|---|---|---|
| 0076 | `0076_crm_contracts.sql` | ✅ APLICADA |
| 0077 | `0077_contracts_drive_sync.sql` | ✅ APLICADA |
| **0078** | **`0078_bank_reconciliation_core.sql`** | ⏳ PENDIENTE |
| **0079** | **`0079_bank_reconciliation_rbac.sql`** | ⏳ PENDIENTE |
| **0080** | **`0080_bank_reconciliation_storage.sql`** | ⏳ PENDIENTE |

La numeración 0076/0077 está cerrada por el módulo Contratos ya aplicado a producción. Las migraciones de Conciliación Bancaria son definitivamente **0078/0079/0080**.

---

## ESTADO CONSOLIDADO

| Componente | Estado |
|---|---|
| Data Layer (Sprint 1) | PASS |
| Actions / RPC adapters (Sprint 2) | PASS |
| Ingesta CSV Santander (Sprint 3) | PASS |
| Página viva + aprobación humana (Sprint 4) | PASS |
| RBAC (Sprint 4) | PASS |
| Storage (Sprint 4) | PASS |
| PDF (Sprint 4) | PASS |
| QA E2E | PASS |
| **Infraestructura aplicada** | **PENDIENTE** |

**Condición única para PILOT GO:** aplicar 0078 → 0079 → 0080 en ese orden.

---

## FASE 1 · CHECKLIST DE MIGRACIONES

### 0078 · CORE — tablas + índices + vista + ALTER

**Origen:** `docs/conciliacion-bancaria/migrations-design.sql` (sección `0078 · CORE`)
**Destino al materializar:** `supabase/migrations/0078_bank_reconciliation_core.sql`

**Qué crea:**
- Tablas: `bank_statements`, `bank_statement_lines`, `bank_reconciliation_matches`, `bank_reconciliation_match_movements`
- Vista: `bank_reconciliation_summary` (security_invoker, derivada)
- 7 índices (ix_tm_concilia, ix_tm_importe, ix_bsl_*, ix_brm_*, ix_brmm_movement)
- Enums: `bank_source_t`, `recon_line_status_t`, `recon_match_status_t`, `recon_method_t`
- ALTER sobre `treasury_movements`: agrega `reconciled_at` (timestamptz nullable) y `reconciled_statement_line_id` (uuid nullable, FK)

**Riesgo:** BAJO. Columnas nullable → no rompe ningún consumidor existente (D1/D5 intactos, OB4). Solo DDL aditivo.

**Dependencias:** `treasury_movements` (0053), `bank_accounts` (0053), `treasury_direction_t` (0053). Todas aplicadas.

**Orden:** PRIMERO. Base para 0079 y 0080.

**Rollback (solo si aún sin datos de producción):**
```sql
alter table public.treasury_movements drop column if exists reconciled_at;
alter table public.treasury_movements drop column if exists reconciled_statement_line_id;
drop table if exists public.bank_reconciliation_match_movements cascade;
drop table if exists public.bank_reconciliation_matches cascade;
drop table if exists public.bank_statement_lines cascade;
drop table if exists public.bank_statements cascade;
drop view  if exists public.bank_reconciliation_summary;
drop type  if exists public.bank_source_t;
drop type  if exists public.recon_line_status_t;
drop type  if exists public.recon_match_status_t;
drop type  if exists public.recon_method_t;
```

---

### 0079 · RBAC + RLS + RPC (write-path)

**Origen:** `docs/conciliacion-bancaria/migrations-design.sql` (sección `0079 · RBAC`)
**Destino al materializar:** `supabase/migrations/0079_bank_reconciliation_rbac.sql`

**Qué crea:**
- 3 permisos en `public.permissions`: `tesoreria.conciliacion.view`, `tesoreria.conciliacion.upload`, `tesoreria.conciliacion.approve`
- RLS habilitado en las 4 tablas de 0078 (SELECT requiere `view`; INSERT/UPDATE solo vía RPC)
- 4 políticas SELECT (una por tabla)
- 3 RPCs `security definer`:
  - `tesoreria_recon_ingest(p_bank_account_id, p_file_path, p_saldo_ok, p_payload)` → persiste el resultado completo del pipeline
  - `tesoreria_recon_accept(p_match_id)` → aprobación humana 1:1 + LOCK anti-doble conciliación (OB7)
  - `tesoreria_recon_reject(p_match_id)` → rechazo de sugerencia
- RBAC seed: asigna los 3 permisos a roles `admin` y `supervisor`

**Riesgo:** BAJO. Permisos y RPCs nuevos, no toca tablas fiscales ni columnas existentes.

**Dependencias:** `has_permission()` (0009), `permissions` / `role_permissions` (0009), tablas de 0078.

**Orden:** SEGUNDO (requiere 0078).

**Acción manual adicional antes del piloto:**
Verificar que Natalia tiene rol `admin` o `supervisor`. Si tiene un rol diferente, asignar manualmente:
```sql
-- Reemplazar 'nombre_rol' con el rol real de Natalia
insert into public.role_permissions (role, slug) values
  ('nombre_rol', 'tesoreria.conciliacion.view'),
  ('nombre_rol', 'tesoreria.conciliacion.upload'),
  ('nombre_rol', 'tesoreria.conciliacion.approve')
on conflict do nothing;
```

**Rollback:**
```sql
drop function if exists public.tesoreria_recon_ingest(uuid, text, boolean, jsonb);
drop function if exists public.tesoreria_recon_accept(uuid);
drop function if exists public.tesoreria_recon_reject(uuid);
drop policy if exists bs_sel   on public.bank_statements;
drop policy if exists bsl_sel  on public.bank_statement_lines;
drop policy if exists brm_sel  on public.bank_reconciliation_matches;
drop policy if exists brmm_sel on public.bank_reconciliation_match_movements;
delete from public.role_permissions where slug like 'tesoreria.conciliacion.%';
delete from public.permissions      where slug like 'tesoreria.conciliacion.%';
```

---

### 0080 · STORAGE — bucket privado

**Origen:** `docs/conciliacion-bancaria/migrations-design.sql` (sección `0080 · STORAGE`)
**Destino al materializar:** `supabase/migrations/0080_bank_reconciliation_storage.sql`

**Qué crea:**
- Bucket `bank-statements` — privado, 20 MB máx, MIME: CSV / PDF / XLS / plain
- Sin política de lectura directa → acceso exclusivo por `createSignedUrl` server-side (TTL 120 s)

**Riesgo:** MUY BAJO. `ON CONFLICT (id) DO NOTHING` — idempotente si ya existiera.

**Dependencias:** extensión Supabase Storage (activa).

**Orden:** TERCERO (puede aplicarse independientemente de 0079, pero por convención al final).

**Rollback (solo si el bucket está vacío):**
```sql
delete from storage.buckets where id = 'bank-statements';
```

---

### ORDEN DEFINITIVO Y TIEMPO ESTIMADO

```
1. 0078_bank_reconciliation_core.sql      ← tablas + ALTER + índices + vista
2. 0079_bank_reconciliation_rbac.sql      ← RLS + 3 RPCs + permisos
3. 0080_bank_reconciliation_storage.sql   ← bucket privado
```

Tiempo estimado: **< 90 segundos** (DDL puro, sin migración de datos).
Ventana recomendada: fuera de horario hábil (antes de las 8 AM o después de las 22 PM ART).

---

## FASE 2 · VARIABLES DE ENTORNO

### Evaluación: NO se requieren variables nuevas para el piloto.

El motor de matching es Jaccard determinístico (sin LLM). Las RPCs usan el cliente de sesión y el admin client existentes.

| Variable | Estado en Netlify | Requerida |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Cargada (arsksytgdnzukbmfgkju) | Sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cargada | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Cargada | Sí (storage admin client) |
| `OPENAI_API_KEY` | Cargada | No (OCR no se usa en conciliación) |
| API key LLM adicional | — | No (capa IA no activada en piloto) |

**Verificaciones post-migración en Supabase Dashboard:**
- Storage → Buckets → `bank-statements` visible como **privado** (sin "Public")
- Database → Functions → presentes `tesoreria_recon_ingest`, `tesoreria_recon_accept`, `tesoreria_recon_reject`
- Database → RLS → las 4 tablas `bank_*` con RLS habilitado

---

## FASE 3 · CHECKLIST DEL PILOTO

**Piloto:** Natalia | Banco: Santander | Cuenta: 500-003293/1 | Formato: CSV

### Prerequisitos antes de la primera carga

- [ ] Migraciones 0078 / 0079 / 0080 aplicadas sin error
- [ ] Bucket `bank-statements` visible en Supabase Storage (privado)
- [ ] 3 RPCs presentes en Database → Functions
- [ ] Natalia tiene permiso `tesoreria.conciliacion.approve` (verificar en `role_permissions`)
- [ ] Cuenta 500-003293/1 (Santander) existe en `bank_accounts` con al menos 1 `treasury_movement` en estado `confirmado` para el período a conciliar
- [ ] Deploy del build en Netlify completo (rama mergeada, build verde)

### Paso 1 · Descargar el extracto

1. Santander Online → cuenta 500-003293/1 → Movimientos → Descargar
2. Formato: **CSV** (no XLS, no PDF en el piloto V1)
3. Período: el mes más reciente completo (mínimo un mes)
4. Verificar que el archivo tiene extensión `.csv` y que se abre con separador `;`

**Estructura esperada:**
```
Fecha;Suc. Origen;Desc. Sucursal;Cod. Operativo;Referencia;Concepto;Importe;Saldo
```
Los importes usan formato AR: miles con `.`, decimales con `,`, negativos entre paréntesis `(374,22)`.

### Paso 2 · Carga en Nexus

1. Nexus → Tesorería → Conciliación bancaria
2. Seleccionar cuenta Santander 500-003293/1 en el selector
3. Subir el archivo CSV (drag-and-drop o file picker)
4. Esperar respuesta del pipeline (~3–10 s según tamaño del extracto)

**Respuesta esperada:**
```json
{ "ok": true, "statementId": "<uuid>", "saldoOk": true, "deltaCents": 0,
  "resumen": { "conciliados": N, "posibles": M, "noConciliados": K, "sistemicos": S } }
```

**Señal de alerta no bloqueante:** `saldoOk: false` → ruptura en la continuidad de saldo del extracto (puede ser operación intradía). El statement queda en estado `revisar`. Registrar `deltaCents`.

### Paso 3 · Dashboard de conciliación

El dashboard agrupa las líneas del extracto por estado:

| Estado | Criterio | Acción |
|---|---|---|
| **sistémico** | IVA, Ley 25413, SIRCREB, comisiones — score 100, regla determinística | Aprobar lote |
| **conciliado** | Match exacto/aproximado contra `treasury_movements` | Confirmar individualmente |
| **posible** | Score 60–99 (aprox/Jaccard) — requiere revisión humana | Aceptar o rechazar |
| **no_conciliado** | Sin contraparte en Nexus | Diferir o crear ajuste |

### Paso 4 · Aprobación humana

Para cada match `sugerido`:
1. Revisar descripción del extracto vs. movimiento sugerido en Nexus
2. Verificar importe y score
3. **Aceptar** → RPC `tesoreria_recon_accept` (LOCK: no se puede re-conciliar el mismo movimiento)
4. o **Rechazar** → RPC `tesoreria_recon_reject`

Para sistémicos: botón "Aceptar lote" → un único ajuste por lote (D7: el sistema nunca registra solo).

### Paso 5 · PDF e informe

1. Hacer clic en "Generar informe"
2. Verificar en el PDF:
   - Banco, cuenta, período, fecha de conciliación
   - Tabla de matches aceptados con importe y movimiento Nexus vinculado
   - Resumen numérico: conciliados / posibles / sistémicos / no conciliados
   - Δ saldo: ARS 0,00 (cruce duro)

### Paso 6 · Verificación del Δ saldo

En el dashboard, tarjeta de saldo:
- **Saldo Santander (cierre):** reportado por el extracto
- **Saldo Nexus:** derivado de `treasury_bank_balances` para la cuenta
- **Δ:** debe ser **0,00** para dar la conciliación por cerrada

Δ ≠ 0 post-aprobación: hay líneas sin conciliar que no alcanzan contraparte en Nexus (puede haber movimientos en tránsito). No es FAIL del piloto pero debe documentarse.

---

## FASE 4 · CRITERIOS PASS / FAIL DEL PILOTO

### PASS — todos deben cumplirse

| # | Criterio | Verificación |
|---|---|---|
| P1 | Pipeline retorna `ok: true` y `statementId` válido | Respuesta JSON del API |
| P2 | `saldoOk: true` — `deltaCents: 0` en el extracto | Campo en respuesta JSON |
| P3 | Dashboard carga y muestra líneas del extracto | Visual en UI |
| P4 | Al menos 1 match aceptado sin error de RPC | Click Aceptar → sin toast de error |
| P5 | Sin permiso `view` → `AccesoRestringido` visible | Probar con usuario sin rol |
| P6 | Archivo subido al bucket `bank-statements` | Supabase Dashboard → Storage |
| P7 | PDF generado con Δ saldo legible | Descarga y revisión visual |
| P8 | Sin errores 500 en Netlify Function Logs | Netlify → Logs durante el flujo |

### FAIL — cualquiera bloquea, requiere hotfix

| # | Criterio de fallo | Diagnóstico |
|---|---|---|
| F1 | Pipeline retorna `ok: false` en la ingesta | Logs del route `/api/tesoreria/conciliacion/ingest` |
| F2 | Error RPC `tesoreria_recon_accept` — "forbidden" o "match inexistente" | Verificar RBAC seed (0079) y estado del match |
| F3 | `SUPABASE_SERVICE_ROLE_KEY` inválida → 401/403 en storage | Netlify env + Supabase project id `arsksytgdnzukbmfgkju` |
| F4 | Tablas `bank_statements` / `bank_statement_lines` no existen | 0078 no aplicada correctamente |
| F5 | Bucket `bank-statements` no existe → error 404 en upload | 0080 no aplicada |
| F6 | `treasury_movements.reconciled_at` no existe como columna | ALTER de 0078 no aplicado |

### Condicional — no bloquea, documentar

| # | Condición | Comentario |
|---|---|---|
| C1 | `saldoOk: false` (Δ ≠ 0 en el extracto) | Posible operación intradía. Registrar Δ y período. |
| C2 | Líneas `no_conciliado` post-aprobación | Movimientos en tránsito o sin contraparte en Nexus. |
| C3 | Score promedio de posibles < 70 | Pocos movimientos cargados en Nexus para el período. No es bug. |
| C4 | Pipeline > 10 s | Aceptable si el CSV tiene > 500 líneas. Registrar tamaño. |

---

## RESTRICCIONES V1 — FUERA DE ALCANCE (no evaluar como fallos)

- **IA semántica (LLM):** motor usa Jaccard determinístico. La capa LLM está documentada en `iaMatch.ts` pero no activada en piloto.
- **Banco Galicia PDF:** parser existe, piloto es exclusivamente Santander CSV.
- **N:M matches complejos:** el modelo de datos soporta N:M; la UI V1 es 1:1.
- **Ajuste de diferencias:** RPC `tesoreria_recon_create_adjustment` existe, UI de ajuste es post-piloto.
- **Historial de extractos:** data layer preparado, UI de historial es post-piloto.

---

## APÉNDICE · UBICACIÓN DEL CÓDIGO

| Componente | Ruta |
|---|---|
| Parser Santander CSV | `src/lib/tesoreria/conciliacion/parsers/santander-csv.ts` |
| Parser Santander XLS | `src/lib/tesoreria/conciliacion/parsers/santander.ts` |
| Parser Galicia PDF | `src/lib/tesoreria/conciliacion/parsers/galicia.ts` |
| Normalizador | `src/lib/tesoreria/conciliacion/normalize.ts` |
| Catálogo sistémicos | `src/lib/tesoreria/conciliacion/systemic.ts` |
| Motor de matching | `src/lib/tesoreria/conciliacion/matching.ts` |
| Adaptador IA / Jaccard | `src/lib/tesoreria/conciliacion/iaMatch.ts` |
| Pipeline principal | `src/lib/tesoreria/conciliacion/ingest.ts` |
| Storage (bucket privado) | `src/lib/tesoreria/conciliacion/storage.ts` |
| Data layer (lectura) | `src/lib/tesoreria/conciliacion/data.ts` |
| Server Actions (RPCs) | `src/lib/tesoreria/conciliacion/actions.ts` |
| Dashboard (métricas) | `src/lib/tesoreria/conciliacion/dashboard.ts` |
| PDF report | `src/lib/tesoreria/conciliacion/report.tsx` |
| Uploader UI | `src/components/tesoreria/conciliacion/ConciliacionUploader.tsx` |
| Dashboard UI | `src/components/tesoreria/conciliacion/ConciliacionDashboard.tsx` |
| Aprobación Island | `src/components/tesoreria/conciliacion/AprobacionIsland.tsx` |
| API Route (ingesta) | `src/app/api/tesoreria/conciliacion/ingest/route.ts` |
| Página principal | `src/app/(app)/tesoreria/conciliacion/page.tsx` |
| Diseño de migraciones | `docs/conciliacion-bancaria/migrations-design.sql` |

---

```
PILOT READINESS PACKAGE
Clasificación: READY FOR PILOT (condicionado)
Numeración definitiva: 0078 / 0079 / 0080
Condición única: aplicar las 3 migraciones en orden.
Una vez aplicadas → PILOT GO.
```
