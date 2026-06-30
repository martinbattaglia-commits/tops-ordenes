# Compliance · Auditoría E2E en entorno de Integración — Runbook + Incidente

- **Fecha**: 2026-06-30
- **Estado**: ⛔ **E2E en vivo BLOQUEADA por incidencia de proveedor (Supabase)**. Paquete listo para ejecutar apenas el provisioning se recupere.
- **Prod**: intocable (sólo lecturas read-only para descubrimiento). Worktree/rama: sin cambios de scope.

---

## 0. Incidencia de provisioning (proveedor) — STOP aplicado

Tres provisionamientos de Supabase quedaron estancados en `COMING_UP`, en **dos regiones distintas**, mientras **prod sigue `ACTIVE_HEALTHY`**:

| # | Recurso | Región | Resultado | Tiempo observado |
|---|---|---|---|---|
| 1 | Branch `compliance-e2e` (`frcpzfeacejccerqwnqq`) | sa-east-1 | nunca levantó (eliminado) | >18 min |
| 2 | Proyecto `tops-ordenes-integracion` (`jyiygusacxbdosfkptci`) | sa-east-1 | `COMING_UP` trabado | >24 min |
| 3 | Proyecto `tops-ordenes-integracion-use1` (`bmrtlojmqmkuirhuzhyt`) | us-east-1 | `COMING_UP` trabado | >8 min |

**Diagnóstico**: prod (proyecto antiguo) sano + 2 proyectos nuevos sin provisionar en 2 regiones ⇒ **incidencia a nivel cuenta/plataforma de Supabase** (asignación de compute para proyectos nuevos), **no del proyecto Nexus ni del diseño**. Per directiva de Dirección, se detuvo la ejecución en vivo.

### Línea base de rendimiento (parcial)
- **Provisioning**: NO completó en ninguna región dentro de las ventanas medidas (sa-east-1 >12–24 min, us-east-1 >8 min). Baseline actual = *provisioning no funcional para la org en este momento*. Re-medir cuando la plataforma normalice (objetivo esperado: 2–5 min).
- Migración / seed / Playwright: **no medibles aún** (sin DB). Quedan instrumentados en este runbook para capturarse en la primera corrida exitosa.

### 🔴 Acciones de limpieza requeridas (Dirección, vía dashboard Supabase)
La MCP **no expone borrado de proyectos** y **no permite pausar** proyectos en `COMING_UP`. Para evitar facturación de recursos inservibles:
1. Borrar `jyiygusacxbdosfkptci` (tops-ordenes-integracion, sa-east-1) desde el dashboard.
2. Decidir sobre `bmrtlojmqmkuirhuzhyt` (us-east-1): si levanta, queda como entorno de Integración; si sigue trabado, borrarlo y recrear cuando la plataforma normalice.
3. Verificar en el dashboard si hay un **límite de proyectos del plan** o un aviso de incidente que explique el estancamiento.

---

## 1. Entorno de Integración — especificación (objetivo)

| Campo | Valor |
|---|---|
| Nombre | `tops-ordenes-integracion-use1` (canónico tras borrar el de sa-east-1) |
| Project ID / ref | `bmrtlojmqmkuirhuzhyt` |
| Región | `us-east-1` |
| Org | `bzpogcxjwsfvtlebijuy` |
| PostgreSQL | objetivo 17.x (prod = 17.6.1.127) — confirmar con `select version()` al levantar |
| Costo | USD 10/mes (permanente, autorizado) |
| Datos de prod | **NO se copian** (sólo seed de prueba) |

### Variables de entorno (para apuntar el dev server al branch de Integración)
`.env.local` (NO commitear; usar valores del proyecto de Integración, NO de prod):
```
NEXT_PUBLIC_SUPABASE_URL=https://bmrtlojmqmkuirhuzhyt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<get_publishable_keys del proyecto Integración>
SUPABASE_URL=https://bmrtlojmqmkuirhuzhyt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<dashboard → Project Settings → API (la MCP no lo expone)>
CRON_SECRET=<cualquier valor de prueba>
COMPLIANCE_ESTADO_SHEET_FILE_ID=         # vacío en iter 1 (cron Paso 0 → skipped)
NEXT_PUBLIC_APP_DEMO_MODE=false
```
> El cockpit `/anmat` lee con cliente autenticado (anon + sesión) sujeto a RLS `to authenticated`. El `service_role` sólo lo usa el cron; para el E2E de UI alcanza anon + sesión.

---

## 2. Fase 1 — Validación read-only del entorno (ANTES de 0141)

Tras aplicar `0001 → 0065 → 0081` (ver §3), correr y exigir ✅:

```sql
-- Tablas base de compliance (esperado: las 5)
select table_name from information_schema.tables
where table_schema='public' and table_name in
 ('compliance_items','compliance_alerts','compliance_documents','compliance_sync_log','compliance_categories')
order by 1;
-- Políticas RLS por tabla (esperado: ≥1 select policy c/u)
select tablename, policyname from pg_policies where schemaname='public' and tablename like 'compliance_%' order by 1,2;
-- CHECK constraints PRE-0141 de compliance_alerts (esperado: nivel in critical/warning/ok; kind 4 valores)
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.compliance_alerts'::regclass and contype='c';
-- Índices (esperado: *_item_idx, *_estado_idx, drive_file_uniq, etc.)
select indexname from pg_indexes where schemaname='public' and tablename like 'compliance_%' order by 1;
-- Versión PG + seed de items (esperado: 33)
select version();
select count(*) as items from public.compliance_items;   -- 33 (seed de 0065)
select id, vencimiento, frecuencia from public.compliance_items where id='MAG-04';  -- 2023-10-06 / Anual
```
**Gate**: cualquier ❌ ⇒ detener e informar.

---

## 3. Fase 2 — Aplicación controlada (orden + smoke test)

Aplicar en orden, **validando cada una** (vía `apply_migration` con el contenido de cada archivo del worktree):

| Orden | Archivo | Provee |
|---|---|---|
| 1 | `supabase/migrations/0001_init.sql` | `profiles`, enum `user_role_t`, `current_role()`, `handle_new_user`, auth base |
| 2 | `supabase/migrations/0065_compliance_core.sql` | `compliance_items` (+seed 33) |
| 3 | `supabase/migrations/0081_compliance_drive_sync.sql` | `compliance_alerts/documents/sync_log/categories` + cols sync en items |
| 4 | `supabase/migrations/0141_compliance_cases.sql` | `compliance_cases/evidence/anticipacion_config/normalizacion` + alters alerts |

### Smoke test SQL (post-0141) — exigir ✅
```sql
-- (a) Tablas nuevas de 0141 (esperado: las 4)
select table_name from information_schema.tables where table_schema='public'
 and table_name in ('compliance_cases','compliance_evidence','compliance_anticipacion_config','compliance_normalizacion') order by 1;
-- (b) BUG #1 FIX — nivel ahora admite 'info' (debe INSERTAR sin error)
insert into public.compliance_alerts (item_id,nivel,kind,titulo,detalle,estado,origen,confianza)
 values ('MAG-04','info','review','smoke','smoke nivel=info kind=review','abierta','nombre_archivo','baja') returning id;
-- (c) kind admite 'review' (cubierto por (b)). Limpiar:
delete from public.compliance_alerts where titulo='smoke';
-- (d) CHECK de nivel incluye info; kind incluye review
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.compliance_alerts'::regclass and conname in ('compliance_alerts_nivel_chk','compliance_alerts_kind_chk');
-- (e) Config de anticipación sembrada (esperado: 8 filas, Anual=60, Cuatrienal=180)
select frecuencia, anticipacion_dias from public.compliance_anticipacion_config order by anticipacion_dias;
-- (f) Diccionario de normalización (esperado: 46 filas)
select count(*) from public.compliance_normalizacion;
-- (g) FKs y RLS de cases/evidence
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.compliance_cases'::regclass and contype='f';
select tablename, policyname from pg_policies where tablename in ('compliance_cases','compliance_evidence');
```
**Gate**: cualquier error ⇒ detener e informar.

---

## 4. Fase 3 — Seed de los 6 casos + evidencias (sólo datos de prueba)

`compliance_items` ya trae los 33 (seed 0065), incluido **MAG-04** (`vencimiento=2023-10-06`, `Anual`). Insertar los casos:

```sql
-- 1) MAG-04 EN_TRAMITE (EX-2023-116887453) → 🟠
insert into public.compliance_cases
 (item_id,sede,tipo_certificado,expediente_nro,organismo,estado_administrativo,etapa,nivel_riesgo,
  fecha_inicio,fecha_pronto_despacho,ultima_actuacion,proxima_accion,observaciones,origen,confianza,activo)
values
 ('MAG-04','MAGALDI','CAA Nación – Generador R. Peligrosos','EX-2023-116887453','Min. Ambiente Nación – SCyMA',
  'en_tramite','pronto_despacho','alto','2023-11-01','2025-02-10',
  'Pronto despacho presentado','Esperar proyecto de Disposición','En elaboración del proyecto de Disposición y Certificado','sheet','confirmada',true),
-- 2) VIGENTE (LUJ-02, CAA vigente 2028) → 🟢
 ('LUJ-02','LUJAN','CAA – Ciudad',null,'GCABA – APRA / DGEVA','vigente',null,'medio',
  '2024-09-06',null,'Certificado vigente','Renovar 2028',null,'sheet','confirmada',true),
-- 3) PRÓXIMO A VENCER (MAG-07, matafuegos venc 2026-07-31, Anual→60d) → 🟡
 ('MAG-07','MAGALDI','Matafuegos',null,'GCBA – AGC','vigente',null,'medio',
  null,null,'Tarjeta vigente','Programar recarga','Próximo a recarga 07/2026','sheet','confirmada',true),
-- 4) PENDIENTE_EMISION (LUJ-08, PAT venc 2026-01-01 vencido) → 🟡
 ('LUJ-08','LUJAN','PAT – Medición',null,'COPIME','pendiente_emision',null,'medio',
  '2026-02-01',null,'Resolución emitida','Incorporar certificado','Aprobado, falta cargar nueva vigencia','sheet','confirmada',true),
-- 5) RECHAZADO (LUJ-03, RAC en adecuación, lo usamos como rechazado de prueba) → 🔴
 ('LUJ-03','LUJAN','RAC / Impacto Acústico',null,'GCABA – APRA / DGEVA','rechazado','subsanando','alto',
  '2024-01-01',null,'Expediente desestimado','Reiniciar trámite','Rechazado por el organismo','sheet','confirmada',true);
-- 6) VENCIDO SIN CASO: LUJ-15 (ANMAT faltante, Rojo) queda SIN caso activo → 🔴 (no insertar caso)

-- Evidencias (una por cada cambio de estado aplicado; origen sheet / nivel confirmada)
insert into public.compliance_evidence (case_id,item_id,from_estado,to_estado,origen,nivel_verificacion,fecha_evidencia,titulo,descripcion)
select c.id,c.item_id,null,c.estado_administrativo,'sheet','confirmada',coalesce(c.fecha_pronto_despacho,c.fecha_inicio),
       'Planilla 00_ESTADO_COMPLIANCE', 'Alta de caso confirmada en planilla'
from public.compliance_cases c where c.item_id in ('MAG-04','LUJ-02','MAG-07','LUJ-08','LUJ-03');
```
**Verificación de semáforo esperado** (con `today=2026-06-30`):
| Ítem | estado_administrativo | temporal | **Semáforo esperado** |
|---|---|---|---|
| MAG-04 | en_tramite | vencido | **🟠 En trámite administrativo** |
| LUJ-02 | vigente | vigente | 🟢 Vigente |
| MAG-07 | vigente | próximo (≤60d) | 🟡 Próximo a vencer |
| LUJ-08 | pendiente_emision | vencido | 🟡 Pendiente de emisión |
| LUJ-03 | rechazado | (s/f o vencido) | 🔴 |
| LUJ-15 | (sin caso) | falta/vencido | 🔴 |

---

## 5. Fase 4 — Auditoría funcional E2E (Playwright)

Levantar `next dev -p 3030` en el worktree con `.env.local` apuntando al proyecto de Integración. Crear usuario de prueba (signup vía anon API o insert en `auth.users` + `email_confirmed_at`; el trigger `handle_new_user` crea el `profiles`).

Checklist Playwright (capturar screenshot en cada uno):
1. **login** — `/login`, email/clave de prueba → redirección a la app.
2. **dashboard** — `/anmat` renderiza sin error de consola; banner de auditoría.
3. **KPIs** — existe "En trámite administrativo" (=1, MAG-04); "Próximos a vencer" cuenta Amarillo; "Vencidos/Faltantes" cuenta Rojo.
4. **semáforos / MAG-04** — **MAG-04 (EX-2023-116887453) se ve 🟠 "En trámite administrativo", NUNCA 🔴**, mientras el caso esté activo. Aserción dura.
5. **CaseChips** — en la fila MAG-04: estado `en_tramite`/etapa `pronto_despacho`, riesgo `alto`, chip `sheet/confirmada`.
6. **timeline** — MAG-04 aparece en el bucket correcto; sin crash.
7. **filtros** — filtrar por sede/categoría/riesgo; MAG-04 bajo Naranja.
8. **búsqueda** — buscar "MAG-04" / "EX-2023-116887453" lo encuentra.
9. **alertas** — centro de alertas muestra MAG-04 como warning (no critical), por `alertSeverity`.
10. **evidencias** — el detalle del caso muestra la evidencia sembrada (origen sheet, confirmada).
11. **máquina de estados** — (vía SQL/cron) intentar transición inválida `rechazado→vigente` en LUJ-03 ⇒ no se aplica + alerta `review`.
12. **cron** — `GET /api/compliance/sync?dry=1` con `Authorization: Bearer <CRON_SECRET>` ⇒ 200, `skipped` (sin Sheet) o corrida limpia; no muta estado fuera de cases/evidence/alerts.

**Criterio de aprobación global**: los 12 ✅ + la aserción dura de MAG-04 🟠.

---

## 6. Procedimiento de regeneración desde cero
1. Crear proyecto Supabase (org `bzpogcxjwsfvtlebijuy`, región `us-east-1`), plan con compute disponible.
2. `apply_migration` en orden: `0001_init` → `0065_compliance_core` → `0081_compliance_drive_sync` → `0141_compliance_cases` (contenido de los archivos del worktree). Validar cada una (Fase 1/2).
3. Smoke test (§3). Seed (§4). Crear usuario de prueba.
4. `.env.local` → Integración. `npm i` + `next dev`. Playwright (§5).
5. Conservar el proyecto (NO destruir). Re-medir línea base de tiempos.

> **Nota de fidelidad**: este entorno es el **slice de Compliance** (auth `0001` + compliance `0065/0081/0141`). NO es aún un mirror completo de prod (prod mezcla migraciones trackeadas + DDL fuera de banda — `compliance_items/alerts` no figuran en `list_migrations` de prod pese a existir; por eso el branch-desde-prod no es viable). Para convertirlo en el entorno oficial de **todas** las features: replicar el schema de prod vía `pg_dump --schema-only` (o replay del `supabase_migrations` de prod) + aplicar `0141` encima. Follow-up separado.

---

## 7. Hallazgos / Riesgos / Recomendaciones

**Hallazgos**
- H1 (proveedor, BLOQUEANTE del E2E vivo): provisioning de proyectos nuevos estancado en 2 regiones; prod sano ⇒ incidencia Supabase cuenta/plataforma.
- H2 (entrega, RESUELTO): colisión de numeración — prod ya tiene Knowledge `0125…0138` aplicado; la migración se **renumeró `0125→0141`** (commit `91e96ca`).
- H3 (infra prod): `compliance_items/alerts/documents/sync_log` existen en prod pero **NO** en `list_migrations` ⇒ creadas fuera de banda; el historial de prod no es 100% replicable (impide branch limpio).
- H4 (memoria): Knowledge F0.5/F0.5.2 figura **aplicado en prod** (`0125-0138`), aunque la memoria lo daba como "entregado-no-aplicado".

**Riesgos remanentes**
- R1: hasta correr el E2E vivo, la validación de UI (render real de MAG-04 🟠) queda pendiente; mitigado por 309 tests + regresión 12/12 + SQL smoke listo.
- R2: 2 proyectos Supabase trabados facturando hasta su borrado manual (dashboard).
- R3: el entorno de Integración es slice de compliance, no mirror total (ver §6).

**Recomendaciones**
1. Reintentar el provisioning cuando Supabase normalice (status page / soporte); verificar límite de proyectos del plan de la org.
2. Borrar los 2 proyectos trabados desde el dashboard.
3. Al primer proyecto sano: correr Fases 1→4 de este runbook y capturar la línea base de tiempos.
4. Planificar el follow-up "Integración = mirror completo de prod" vía `pg_dump --schema-only`.
</content>
