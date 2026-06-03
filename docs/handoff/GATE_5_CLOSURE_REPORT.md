# GATE 5 — Cadena de Custodia · REPORTE DE CIERRE (auditoría integral)

> Auditoría integral de Gate 5 para determinar cierre. Roles: Principal Architect + QA Lead + Security
> Architect + Product Owner + Auditor Técnico. Repo `~/CODE/tops-ordenes` @ `681d810`. Fecha: 2026-06-03.
> **Modo: auditoría + documentación.** Sin nuevas funcionalidades, sin migraciones, sin Gate 6.
>
> ## ⛔ VEREDICTO: GATE 5 **NOT CLOSED** (bloqueantes documentados §8)
> **Gate 5 Back-End (DB · `0036`–`0039`) = COMPLETO y commiteado.** **Gate 5 (completo, con capa de
> aplicación) = NO CERRADO:** la capa TS/UI/QR/Timeline/POD-Surface **no existe** y la aplicación/validación
> de `0038`/`0039` no está confirmada. Honestidad técnica > sello de cierre.

---

## 0. Hallazgo de fondo (estado real vs estado esperado)

El pedido lista como "todo implementado": `0036`–`0039` + **TS Layer + UI Layer + QR Layer + Timeline Layer +
POD Surface**. **Verificación de hecho (READ ONLY):**

| Componente | Esperado | Real | Evidencia |
|---|---|---|---|
| `0036`–`0039` (DB) | ✅ | ✅ presente y commiteado | `supabase/migrations/003[6-9]_*.sql` (1212 líneas) |
| TS Layer (`src/lib/custody/*`) | ✅ | ❌ **NO existe** | `src/lib/custody` ausente |
| UI Layer (rutas/captura/timeline/POD) | ✅ | ❌ **NO existe** | sin archivos `*custody*` en `src/` |
| QR Layer (generación/escaneo app-side) | ✅ | ❌ **NO existe** | sin referencias |
| Server Actions / wrappers RPC | ✅ | ❌ **NO existe** | `grep` de RPC custody en `src/` = 0 |

> Cada autorización de Gate 5 (0036–0039) **excluyó explícitamente** TS/React/Server Actions/QR-frontend/
> cámara/firma-UI/PDF-server/etiquetas, difiriéndolos a "la capa de aplicación posterior". Por lo tanto la
> capa de aplicación **nunca se implementó** — coherente con lo entregado, pero **incompatible con un cierre
> total de Gate 5** (cuyo diseño/plan la incluyen: Plan §2 TS/UI/POD-PDF; Diseño §14 Fases 4–6).

---

## 1. Auditoría arquitectónica (diseño vs implementación)

**Diseño Rev.2 + Review (7 cambios obligatorios) → implementación DB:** **CONFORME.**

| Elemento del diseño | Implementado en | Estado |
|---|---|---|
| 3 enums (`custody_stage_t`/`custody_event_type_t`/`evidence_kind_t`) | 0036 | ✅ |
| `custody_events` (doble FK+CHECK, hash-chain, PostGIS, append-only) | 0036 | ✅ |
| `custody_evidence` (sha256 not null, multi-bucket CHECK, redacción) | 0036/0037/0038 | ✅ |
| `delivery_pods` (1×shipment) | 0036 | ✅ |
| Tokens QR opacos (`custody_token`) | 0036 | ✅ |
| 3 buckets privados + storage RLS + signed URL auditado | 0037 | ✅ |
| Modelo de retención (`retention_class`/`until`) | 0037/0038 | ✅ |
| RPC attach/register/verify/redact | 0038 | ✅ |
| RPC generate_pod/timeline/by_token/summary | 0039 | ✅ |
| Hash-chain + read-audit (custody.access) + erasure | 0036/0037/0038 | ✅ |

**Desviaciones documentadas (todas justificadas, no defectos):**
1. `custody_evidence` **NO particionada** — para preservar FK limpia `delivery_pods.signature_evidence_id`. (0036 report §3) **A ratificar.**
2. `generate_delivery_pod` **no inserta `custody_event 'pod'`** — el POD se deriva en el timeline (0039 report §2.1).
3. `redacted_by` **agregada en 0038** (no estaba en 0036) — additive; permitida por el trigger de inmutabilidad.
4. `retention_until` con **deadlines TENTATIVOS** (pii 1a / evidence 2a / pod 10a) — **pendiente confirmación legal**.
5. **Anclaje Merkle diario** (legal-grade, "opcional" en el review) — **NO implementado** (deuda residual).

**Faltante vs plan (capa de aplicación):** TS (`src/lib/custody/*`), UI (captura/timeline/POD/QR/etiquetas),
Server Actions, **POD-PDF server-side**, generación de imagen QR. → **bloqueante de cierre total.**

---

## 2. Auditoría técnica (TS/eslint/imports/rutas/actions/wrappers/QR/timeline/POD)

| Verificación | Resultado |
|---|---|
| `tsc --noEmit` | ✅ **0 errores** — pero **trivial**: no hay TS de custody que compilar |
| eslint custody | n/a — **no hay `src/lib/custody`** |
| Server Actions custody | ❌ no existen |
| Wrappers RPC custody | ❌ no existen |
| Rutas / UI / QR / Timeline / POD surface | ❌ no existen |

> **Conclusión honesta:** "0 errores" **NO** significa "implementado y limpio" — significa **ausente**. La capa
> de aplicación de Gate 5 está sin construir.

---

## 3. Auditoría de seguridad (back-end)

**Sin bypass conocidos en el SQL.** Verificado por lectura de `0036`–`0039`:

| Control | Estado |
|---|---|
| Todas las RPC `SECURITY DEFINER` + authz `current_role()` | ✅ |
| RLS lockdown (lectura auth; escritura **solo** vía RPC) | ✅ |
| Signed URL = `emit_custody_signed_url` (autoriza + audita; firma app-side, patrón 0010) | ✅ (DB) |
| PII gating estricto (`custody-pii` → admin/supervisor) | ✅ (RPC + storage RLS) |
| Redacción (erasure) restringida admin/supervisor | ✅ |
| Hash-chain (`prev_hash`/`row_hash`) | ✅ |
| Auditoría de **lectura** de PII (`custody.access`) | ✅ |
| `get_custody_by_token` **sin PII** | ✅ (validado por kit C8) |

**Caveats (no bypass, pero gaps de borde):**
- El **camino seguro de lectura del binario** (emit → signed URL → fetch) es **app-side y NO está cableado**
  (capa TS/UI ausente) → el control existe en DB pero **no opera end-to-end** todavía.
- El trigger de redacción de 0036 **no protege** `retention_*`/`redacted_by` (no los lista) — una redacción
  podría alterarlos; impacto bajo (solo metadatos), pero anotado.

---

## 4. Auditoría de integridad

| Tabla / mecanismo | Garantía | Estado |
|---|---|---|
| `custody_events` | append-only (UPDATE/DELETE/TRUNCATE bloqueados) + hash-chain | ✅ (implementado) |
| `custody_evidence` | append-only salvo flip de redacción · `sha256 not null` | ✅ |
| `delivery_pods` | 1×shipment (unique) | ✅ |
| SHA-256 por archivo + `row_hash` encadenado (sha256 built-in) | tamper-evidence | ✅ |
| Continuidad de cadena (`verify_custody_chain`) | recompute idéntico al trigger | ✅ |

**Validación ejecutada (según declaración del owner):** `0036` = **10/10 OK** (incl. C10 hash-chain
determinístico) · `0037` = **9/9 OK**. **`0038`/`0039`:** kits generados (`gate5_evidence/pod_reads_*`),
**aplicación/validación en DB NO confirmada en esta auditoría** (las migraciones las aplica Martín; los kits
de 0038/0039 aún no se reportaron corridos) → **pendiente.**

---

## 5. E2E (flujo Packing → … → Resolución pública)

**No ejecutable end-to-end hoy.** El flujo está **cubierto a nivel SQL** por los kits (piecewise):

```
Packing(foto)→Evidencia[attach·0038]→Despacho→CustodyEvent[register·0038]→
Timeline[get_custody_timeline·0039]→POD[generate_delivery_pod·0039]→QR[token·0036]→
Resolución[get_custody_by_token·0039]
```

- **Cubierto por kits:** attach/register/verify (0038 C1–C10), timeline/POD/token/summary (0039 C1–C12, incl.
  timeline correcto, token packing/shipment, PII no expuesta).
- **NO ejecutable como E2E real** porque: (a) `0038`/`0039` no confirmadas aplicadas/validadas; (b) **no hay
  UI/TS** que dispare el flujo; (c) QR/signed-URL/POD-PDF son **app-side y no existen**.
- → **E2E a nivel aplicación = imposible hasta construir la capa de app.**

---

## 6. Documentación actualizada

`WMS_ARCHITECTURE_SNAPSHOT`, `WMS_PHASE_CLOSURE_HANDOFF`, `MASTER_HANDOFF` actualizados con el **estado real**:
Gate 5 **back-end DB (0036–0039) implementado/commiteado**; capa de aplicación + aplicación/validación de
0038/0039 **pendientes** → **Gate 5 NO cerrado** (no se registró un "CLOSED" falso).

---

## 7. Métricas

| Métrica | Valor |
|---|---|
| Migraciones Gate 5 | 4 (`0036`–`0039`), **1212 líneas SQL** |
| Tablas nuevas | 3 (`custody_events`/`custody_evidence`/`delivery_pods`) + 2 columnas token |
| Buckets privados | 3 (`custody-evidence`/`custody-pii`/`custody-pod`) |
| RPC | 9 (emit + attach/register/verify/redact + generate_pod/timeline/by_token/summary) |
| Kits de validación | 4 (`gate5_{core,storage,evidence,pod_reads}_validation_report.sql`) · 41 casos |
| Reportes/diseños | 8 docs (`GATE_5_*`) |
| Commits locales Gate 5 | 4 (`7196b86`,`468d893`,`d301e8e`,`681d810`) |
| `tsc` | 0 errores (capa app ausente) |
| Capa de aplicación (TS/UI/QR/Timeline/POD surface) | **0% — no existe** |

---

## 8. Bloqueantes para el cierre total de Gate 5

| # | Bloqueante | Severidad |
|---|---|---|
| **B1** | **Capa de aplicación inexistente** (TS `src/lib/custody/*`, UI captura/timeline/POD/QR, Server Actions). El back-end no es usable por la operación. | 🔴 Crítico |
| **B2** | **`0038`/`0039` no confirmadas aplicadas/validadas** en la DB (kits sin correr reportado). | 🟠 Alto |
| **B3** | **Backup de Storage indefinido** (no cubierto por backup DB ni PITR, que está off). Sin esto, la evidencia no es recuperable. | 🔴 Crítico (operativo) |
| **B4** | **POD-PDF server-side no implementado** (route/Edge Function). | 🟠 Alto |
| **B5** | **Generación/escaneo de QR app-side no implementado.** | 🟠 Alto |
| **B6** | Retención con **deadlines tentativos** (sin confirmación legal) · anclaje Merkle (legal-grade) no implementado. | 🟡 Medio |

---

## 9. Deuda técnica residual

- Particionado de `custody_evidence` (diferido) — ratificar antes de alto volumen.
- Trigger de redacción no protege `retention_*`/`redacted_by` (impacto bajo).
- `get_shipment_custody_summary` verifica solo la cadena del shipment (no las de packing_units).
- Anclaje Merkle diario (legal-grade) no implementado (era opcional).

---

## 10. Checklist de cierre

| Tarea | Estado |
|---|---|
| Back-end DB (0036–0039) implementado | ✅ |
| Back-end commiteado local (sin push) | ✅ |
| Validación 0036 / 0037 | ✅ (10/10 · 9/9, declarado por owner) |
| Validación 0038 / 0039 | ⏳ pendiente (kits sin correr) |
| Seguridad back-end (sin bypass) | ✅ |
| Integridad (append-only + hash-chain) | ✅ |
| **Capa de aplicación (TS/UI/QR/Timeline/POD)** | ❌ **no existe** |
| **POD-PDF server-side** | ❌ |
| **Backup de Storage definido** | ❌ |
| E2E aplicación | ❌ (imposible sin capa app) |
| Handoffs actualizados (estado real) | ✅ |

---

## 11. Veredicto

> ### Gate 5 — Custody Back-End (DB `0036`–`0039`): ✅ **COMPLETO** (commiteado; 0036/0037 validados; 0038/0039 pendientes de validar).
> ### Gate 5 (COMPLETO, con capa de aplicación): ⛔ **NOT CLOSED** — bloqueantes B1–B6 (§8).

**Para alcanzar `GATE 5 = VALIDATED + CLOSED` se requiere:** (1) aplicar+validar `0038`/`0039` (kits → todo
OK); (2) implementar la **capa de aplicación** (TS + UI + QR + Timeline + POD surface + POD-PDF server-side);
(3) **definir backup de Storage**; (4) confirmar **marco legal de retención**. Recién entonces puede declararse
el cierre total.

---

> **FIN — Auditoría de cierre de Gate 5.** Sin nuevas funcionalidades, sin migraciones, sin Gate 6.
> **Gate 5 NO se declara CLOSED** (bloqueantes documentados). El back-end DB queda como **milestone completo**.
> Esperar aprobación: o (a) construir la capa de aplicación para cerrar Gate 5, o (b) re-alcance del cierre.
