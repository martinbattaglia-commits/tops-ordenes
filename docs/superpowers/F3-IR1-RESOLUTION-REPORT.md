# Fase 3 · IR-1 — Informe Técnico de Resolución (read-only, evidencia verificable)

> Principal/Release Engineer · 2026-06-30. **Read-only**: no se modificó código, prod, migraciones, ni docs (salvo este informe). Toda conclusión respaldada por inspección real de prod (`arsksytgdnzukbmfgkju`) y del repo.

## 1. Resumen ejecutivo
La migración `20260630040905` que prod aplicó "hoy" y que IR-1 marcó como **divergencia no reconciliada** es **`0141_compliance_cases`** — el módulo **Compliance Cases (semáforo)**, un workstream **separado** (`feat/compliance-integration`). Es exactamente el **"hueco 0141" que RC1 reservó deliberadamente** (por eso el repo de RC1 salta de `0140` a `0142`). No es una migración desconocida ni un accidente: es divergencia **por diseño**. La verificación de catálogo demuestra que 0141 y RC1 (`0142`–`0154`) son **dominios disjuntos**: 0141 no toca ninguna superficie compartida de RC1, y el único objeto en común (`compliance_items`) lo usa de forma **aditiva**, mientras RC1 lo referencia **solo polimórficamente por valor (sin FK)**. **IR-1 → RESUELTO. No existe conflicto. F3.2 puede iniciarse** (sujeto a las restantes pre-condiciones del GO del Master Plan, ajenas a IR-1).

## 2. Análisis completo de la migración `0141_compliance_cases` (evidencia: `supabase_migrations.schema_migrations`)
- **version:** `20260630040905` · **name:** `0141_compliance_cases` · **DDL:** 9.245 chars, 1 statement.
- **Objetos creados/modificados (conteo real del DDL):**
  - **4 tablas nuevas:** `compliance_cases`, `compliance_anticipacion_config`, `compliance_normalizacion`, `compliance_evidence` (live en prod = 4/4).
  - **12 `alter table`** sobre: `compliance_cases`, `compliance_anticipacion_config`, `compliance_normalizacion`, **`compliance_items`**, `compliance_alerts` (×7), `compliance_evidence` — RLS enable + grants + el add-column.
  - **4 policies RLS** (sobre las tablas nuevas).
  - **0 funciones · 0 triggers · 0 enums · 0 buckets · 0 RPC · 0 seed de permisos · 0 cambios de realtime.**
- **Uso de `compliance_items` (líneas reales del DDL):**
  - `item_id text references compliance_items(id) on delete set null` (×2) → las tablas **de 0141** hacen FK a `compliance_items`.
  - `alter table compliance_items add column if not exists anticipacion_dias int;` → **agrega una columna aditiva** a `compliance_items`.
- **Dominio:** Compliance (gestión de casos/semáforo, evidencias, normalización, anticipación). Sin relación con comunicación/connect.

## 3. Comparación contra Git
- `0141_compliance_cases.sql` **existe en git**, rama `feat/compliance-integration` (commits `cb0d218`/`e1345ba`: *"renumera 0139→0141 (prod aplicó Knowledge 0139_rrhh+0140_kpis)"*). También en worktree `feat+compliance-integration` (HEAD `defd0d0`).
- **NO existe** en `release/nexus-base` (RC1): el worktree salta `0140_knowledge_kpis_admin.sql` → `0142_connect_module_enum.sql` (verificado `ls`; no hay `0141*`).
- **Veredicto:** la migración **sí está versionada** (no es ad-hoc de dashboard); pertenece a **otra rama**; **nunca fue incorporada a RC1** — y eso es **intencional** (RC1 reservó el número 0141 para Compliance). **No hay divergencia anómala**: es la separación de workstreams esperada.

## 4. Matriz de compatibilidad (`0142`–`0154` vs estado de prod con `0141` aplicada)
| Mig RC1 | Veredicto | Justificación (evidencia) |
|---|---|---|
| 0142 enum connect | **Compatible** | 0141 no toca `permission_module_t` (catálogo: `touches_perm_enum=false`) |
| 0143 connect schema | **Compatible c/observación** | Comparte `compliance_items` SOLO como valor de `entity_type` (CHECK), link **polimórfico sin FK** (`entity_id_text`, no referencia la tabla). La columna `anticipacion_dias` que 0141 agregó es invisible a RC1. Sin colisión de nombres (RC1 no crea tablas `compliance_*`) |
| 0144 RPCs | **Compatible** | 0141 no crea funciones/RPC; sin colisión de nombres connect_* |
| 0145 vistas | **Compatible** | 0141 no crea vistas |
| 0146 RBAC seed | **Compatible** | 0141 no siembra permisos (`touches_permissions_seed=false`) |
| 0147 notifications ext | **Compatible** | 0141 no toca `notifications` (`touches_notifications=false`) |
| 0148 storage | **Compatible** | 0141 no toca `storage.*` (`touches_storage=false`) |
| 0149 knowledge adapter | **Compatible** | 0141 no toca Knowledge ni el emisor |
| 0150–0153 features | **Compatible** | Disjunto; 0 referencias cruzadas |
| 0154 profiles | **Compatible** | 0141 no toca `profiles` (`touches_profiles=false`) |
> **0 conflictos confirmados. 0 conflictos potenciales.** 1 observación benigna (compliance_items compartido, interacción nula).

## 5. Riesgos (clasificados)
- **Crítico:** ninguno.
- **Alto:** ninguno.
- **Medio:**
  - **M-1 (git housekeeping):** el folder de migraciones de RC1 **no incluye** `0141`. Al mergear RC1 a un branch compartido, debe traerse `0141` desde `feat/compliance-integration` para que la secuencia quede completa (`0140→0141→0142+`); un mal merge podría dejar el hueco. **No es bloqueante de DB** (prod ya tiene 0141).
  - **M-2 (prod móvil):** prod podría aplicar nuevas migraciones antes de la ventana de apply de RC1. **Mitigación:** re-verificar `schema_migrations` inmediatamente antes de aplicar.
- **Bajo:**
  - **B-1:** columna aditiva `anticipacion_dias` en `compliance_items` — invisible a RC1 (link polimórfico). Sin acción.
  - **B-2:** 0141 toca `compliance_alerts` (RLS) — tabla del dominio compliance, ajena a RC1.

## 6. Estrategia de reconciliación (definitiva)
**No se requiere reconciliación estructural a nivel DB.** RC1 (`0142`–`0154`) **stackea limpio** sobre prod (que está en `0141`): numeración sin colisión (prod numera por TIMESTAMP; RC1 son labels de archivo; 0141 ocupa el slot reservado y RC1 es 0142+), y superficies disjuntas.
- **Por qué es la más segura:** no toca lo aplicado (0141 intacto); RC1 es aditivo y greenfield para connect; cero objetos compartidos con riesgo.
- **Por qué minimiza riesgo:** evita cualquier ALTER/DROP sobre objetos de compliance; la única intersección (`compliance_items`) es de solo-lectura-por-valor desde RC1.
- **Cómo se valida:** (a) re-verificar `schema_migrations` antes del apply (M-2); (b) las 0142-0154 usan guards `if not exists`/`create or replace` (idempotentes) → re-ejecución segura; (c) tras apply, `get_advisors` security/performance.
- **Reversibilidad:** rollback de RC1 vía `ROLLBACK_0142_0149.md` + drops inversos `if exists`; **0141 queda intacto** (el rollback de RC1 no lo referencia). Acción de housekeeping M-1 reversible por git.
- **Housekeeping recomendado (NO bloqueante, fuera de IR-1):** al preparar el merge de RC1, incorporar el archivo `0141_compliance_cases.sql` desde `feat/compliance-integration` para completar la secuencia del repo.

## 7. Evidencias utilizadas
- **Prod (Supabase MCP, read-only, `arsksytgdnzukbmfgkju`):** `schema_migrations` (version/name/statements/columns); conteo de objetos del DDL de `20260630040905` (regexp sobre `statements[1]`); flags de superficie compartida (notifications/profiles/enum/connect/realtime/storage/seed); líneas reales que mencionan `compliance_items`; targets de `alter table`; existencia live de las 4 tablas compliance + `compliance_items`.
- **Repo (Bash/git):** `ls supabase/migrations` (salto 0140→0142); `git log --all -- *0141_compliance_cases*` (rama `feat/compliance-integration`); `git worktree list`; grep de referencias cruzadas RC1↔tablas de 0141 (0 referencias); definición polimórfica del link en `0143_connect_schema.sql` (entity_type/entity_id_text, sin FK a compliance_items).

## 8. Recomendación GO / NO GO
**🟢 GO — Opción A: IR-1 completamente resuelto. No existe conflicto.** RC1 (`0142`–`0154`) es compatible con el estado de prod (que incluye `0141`). F3.2 **puede iniciarse** una vez cumplidas las pre-condiciones restantes del Master Plan (rama dedicada, plan de asignación RBAC, backup/PITR, autorización G3) — **independientes de IR-1**.

## 9. Checklist de validación
- [x] Migración `20260630040905` identificada con nombre real (`0141_compliance_cases`) — evidencia: `schema_migrations.name`.
- [x] Contenido real enumerado (4 tablas, 12 alter, 4 policies, 0 fn/trg/enum/rpc/seed/realtime) — evidencia: conteo regexp sobre `statements[1]`.
- [x] Comparación git: existe en `feat/compliance-integration`, ausente en `release/nexus-base` por diseño.
- [x] Matriz `0142`–`0154`: 10/10 Compatible (1 con observación benigna), 0 conflictos.
- [x] Impacto por componente determinado (§ siguiente) con justificación.
- [x] Superficie compartida verificada por catálogo (notifications/profiles/enum/realtime/storage/seed = sin impacto).
- [x] `compliance_items`: interacción confirmada nula (aditiva + polimórfica sin FK).
- [x] Estrategia de reconciliación + rollback definidas.
- [x] Riesgos clasificados (0 crítico/alto).
- [x] Sin modificaciones a prod/código/migraciones (solo lectura).

### Impacto sobre componentes de Nexus Link (§4 requerido)
| Componente | Impacto | Justificación |
|---|---|---|
| Connect | **Sin impacto** | 0141 no toca objetos connect_* (catálogo false); 0 referencias cruzadas |
| Profiles | **Sin impacto** | 0141 no toca `profiles` (false) |
| Notifications | **Sin impacto** | 0141 no toca `notifications` (false) |
| Knowledge / Timeline / Entity360 | **Sin impacto** | 0141 no crea fn/trigger ni toca Knowledge/emisor |
| RBAC | **Sin impacto** | 0141 no siembra permisos (false); RLS solo sobre tablas compliance |
| Realtime | **Sin impacto** | 0141 no toca `supabase_realtime` (false) |
| Cockpit | **Sin impacto** | 0141 no toca `command-center`/ejecutivo |
| Context IDs | **Sin impacto** | 0141 no toca `connect_context_seq` |
| Auth | **Sin impacto** | 0141 no toca auth/`handle_new_user` |
| Storage | **Sin impacto** | 0141 no toca `storage.*` (false) |
| Compliance (compliance_items) | **Impacto indirecto (benigno)** | 0141 agrega col aditiva + FKs desde sus tablas; RC1 referencia `compliance_items` solo por valor (polimórfico, sin FK) → interacción nula |

## 10. Confirmación explícita
**IR-1 queda cerrado por evidencia. NO existe conflicto entre `0141_compliance_cases` (prod) y RC1 `0142`–`0154`. F3.2 PUEDE COMENZAR** tras las pre-condiciones del Master Plan ajenas a IR-1. **No se inicia ninguna implementación** hasta tu aprobación explícita posterior a este cierre.
