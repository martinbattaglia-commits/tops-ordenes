# Fase 3 — Integración Productiva de Nexus Link · Integration Readiness Report + Master Plan

> **Hito F3.1** (Auditoría + Plan Maestro). Lead Software Architect · 2026-06-30. **Read-only; nada modificado.**
> Principio rector: **integrar sin romper** — incremental, reversible, validado, cero regresiones.

---

## 1. Integration Readiness Report

### 1.1 Realidad de producción (verificada read-only vía Supabase MCP sobre `arsksytgdnzukbmfgkju`)
| Hecho | Valor | Implicancia |
|---|---|---|
| Migraciones aplicadas | **58** (numeradas por TIMESTAMP, máx `20260630040905` = **hoy 04:09**) | prod **se movió hoy** → reconciliar base antes de aplicar |
| Tablas `connect_*` en prod | **0** | Integración **greenfield**: aplicar es aditivo, riesgo de regresión a módulos existentes ≈ nulo |
| Knowledge en prod | **9 tablas + 2 vistas + `knowledge_emit_event`** | Target de integración **LISTO**: el adapter `0149` enchufa directo |
| `notifications` | existe, **sin** columnas A4 (priority/remind_at) | `0147` = dependencia dura del Centro de Notificaciones |
| `profiles` | existe, **sin** columnas RC1.4 | `0154` = dependencia dura de Perfil/Presencia |
| Publicación realtime | incluye `notifications`, `knowledge_events` (no `connect_messages`) | `0143/0147` agrega `connect_messages` |
| `connect.*` permisos | **0** | Hasta sembrar+**asignar** `0146`, Nexus Link queda **gateado** (AccesoRestringido) |
| `knowledge.*` permisos | 5 | Knowledge operativo |
| `handle_new_user` | presente (default rol staff) | Landmine para usuarios externos (F5, no RC1) |

### 1.2 Veredicto de readiness
**El código de RC1 ya está construido y es session-aware** (la capa de lectura conmuta `isMock()`→real). Por eso la "integración" es **~70% aplicación controlada + verificación** de lo ya entregado, y **~30% trabajo nuevo aditivo** (detallado en §1.4). El terreno es favorable: connect es greenfield en prod, Knowledge está vivo, y todos los toques a tablas compartidas (`notifications`, `profiles`, publicación realtime, RBAC) son **migraciones aditivas**.

### 1.3 Riesgos priorizados (post-triaje senior)
| # | Riesgo | Sev | Estado / Mitigación |
|---|---|---|---|
| **IR-1** | **Divergencia base↔prod**: prod aplicó una migración hoy (`20260630040905`) no reflejada en el worktree | 🔴 Alto | **Bloqueante de inicio.** Reconciliar: identificar qué es esa migración y confirmar que no colisiona con la DDL de `0142`–`0154` antes de aplicar |
| **IR-2** | **Activación RBAC**: sembrar `0146` no basta; hay que **asignar** `connect.*` a roles/usuarios internos (RBAC dormido/fail-open) | 🔴 Alto | Definir el set de asignaciones (qué roles ven connect) como paso explícito de F3.3 |
| **IR-3** | **Numeración NNNN vs TIMESTAMP**: el repo usa labels `0142+`, prod usa timestamps | 🟠 Medio | Aplicar a mano (G3), `schema_migrations` recibe timestamp; verificar antes con `schema_migrations`. **Sin colisión** (namespaces distintos) — confirmado |
| **IR-4** | **Fan-out de notificaciones ausente**: el trigger encola en `connect_outbox` pero **no hay worker** que drene → menciones/respuestas/mensajes nuevos NO generan notificación | 🟠 Medio | Es el **mayor gap real**. Construir worker en F3.6 (Bloque G). Hasta entonces, el Centro agrega solo `notifications` + conversaciones no leídas |
| **IR-5** | **Storage no reversible**: rollback de buckets `connect-*` no recupera binarios | 🟠 Medio | Backup manual de buckets antes de cualquier rollback duro |
| **IR-6** | **Shell presencia sin cablear**: `layout.tsx` no llama `getMyProfile()`; el dot de presencia no se renderiza | 🟢 Bajo | Trabajo nuevo pequeño (F3.2, ~0.5d) |
| **IR-7** | **Multiempresa NO soportado** (instancia singleton, conversaciones globales) | 🟢 Bajo | **No aplica** a RC1 (interno, 1 empresa). RC2/F5 si hubiera tenants |
| **IR-8** | Context ID: secuencia global (el contador no resetea por año pese al prefijo `AAAA`) | 🟢 Bajo | Cosmético; IDs únicos garantizados. Aceptado |
| Cerrados | 0149 dep. Knowledge ≥0140 (✅ vivo); RC12-008 NULL-unsafe (✅ corregido en 0151); FLAG-ENTITY360-VOCAB (✅ resuelto RC1.3) | — | Verificados; no son riesgos abiertos |

### 1.4 Trabajo NUEVO de integración (no construido en RC1)
| Pieza | Bloque | Esfuerzo | Riesgo |
|---|---|---|---|
| Cableado presencia/avatar en shell (`layout`→`Shell`/`Sidebar`, dot de color) | A | ~0.5d | Bajo (aditivo a shell) |
| **Worker de fan-out** `connect_outbox`→`notifications` (drena cola, mención/reply/mensaje) | G | ~2-3d | Medio (infra nueva: RPC/route/cron) |
| Indicadores de escritura (typing) vía Broadcast/Presence | C | ~1-2d | Medio (o diferir a RC2) |
| Tarjeta KPI de Nexus Link en Cockpit (read-only: conversaciones activas, no leídos) | H | ~1d | Bajo (usar **count liviano**, no la agregación completa — IR de perf) |
| Eventos de Timeline adicionales (más allá de `conversation_linked`) | E/F | decisión | Acoplado al worker; mayormente diferido |
| (Diferidos por decisión) Incidentes, @menciones-discretas, presencia realtime, antivirus de adjuntos | — | RC2+ | — |

---

## 2. Mapa completo de dependencias (Nexus Link ⇄ Nexus OS)
```
                    DEPENDE DE (prod debe tener)          NEXUS LINK (connect)            EMITE / CONSUME
auth.users ─────────────┐                              ┌─────────────────────┐
profiles (0001/04/40) ──┤                              │  connect_* (0142-43) │── emite→ knowledge_events
RBAC 0009 ──────────────┤  has_permission/current_role │  RPCs SECDEF (0144)  │         (adapter 0149, UNIDIRECCIONAL)
audit_log (0001) ───────┤                              │  vistas (0145)       │── consume→ v_knowledge_timeline
notifications (0004) ───┤  +A4 cols (0147)             │  RBAC seed (0146)    │            v_knowledge_entity_360
Knowledge 0125-0140 ────┘  (LIVE ✓)                    │  Context ID (0143)   │            (read-only)
                                                        └─────────┬───────────┘
        EXTIENDE (aditivo, compartido):                          │ TOCA (UI/shared):
        · notifications +A4 (0147)                               ├─ shell: Sidebar/Icon/NotificationsBell/layout
        · profiles +RC1.4 (0154)                                 ├─ 6 páginas-detalle ERP (RC1.3 embeds):
        · supabase_realtime +connect_messages                    │   orders·clientes·compras/ordenes·proveedores·anmat·oportunidades
        · permission_module_t +connect (0142)                    ├─ realtime.ts (+connect_messages)
        · RBAC +connect.* (0146)                                 └─ boot-permissions (+connect flag)
```
**Dirección del acoplamiento:** Nexus Link **consume** Knowledge (read-only) y **emite** a `knowledge_events` por el emisor único (nunca INSERT directo). No hay dependencia inversa: Knowledge no conoce a connect. Los toques a módulos existentes son **aditivos** (columnas/publicación/seed), no modifican comportamiento previo.

---

## 3. Integration Master Plan (bloques → hitos F3.1–F3.7)
> Cada bloque: objetivo · componentes · dependencias · riesgos · rollback · pruebas · GO/NO GO. **Rama dedicada** `feat/nexus-link-integration` (desde `release/nexus-base`). Aplicación de migraciones = **G3 manual por Dirección**, reversible.

### F3.1 — Auditoría + Plan Maestro *(este documento)* → **espera aprobación**

### F3.2 — Bloque A · Autenticación y Perfiles
- **Objetivo:** sesión real + perfiles + presencia persistente operativos.
- **Componentes:** aplicar `0142`,`0143`,`0154`; cablear `getMyProfile()` en `layout`→`Shell`/`Sidebar` (dot de presencia).
- **Dependencias:** auth.users, profiles, RBAC 0009 (todos en prod).
- **Riesgos:** IR-1 (reconciliar base), IR-6 (cableado shell).
- **Rollback:** `drop` columnas profiles (0154) + revertir cableado por git; enum connect permanece inerte.
- **Pruebas:** login real → `getMyProfile` devuelve perfil; cambio de presencia persiste; dot visible; typecheck/lint/test/build/smoke.
- **GO/NO GO:** GO si auth real resuelve perfil y presencia sin regresión del shell.

### F3.3 — Bloque B · Persistencia y Mensajería
- **Objetivo:** conversaciones/mensajes/canales/favoritos sobre tablas reales.
- **Componentes:** aplicar `0144`,`0145`,`0146`,`0148`,`0150`,`0151`; **sembrar + ASIGNAR** `connect.*` a roles internos (IR-2); verificar que los data layers conmutan a real.
- **Dependencias:** F3.2; RBAC seed.
- **Riesgos:** IR-2 (asignación RBAC), IR-5 (storage).
- **Rollback:** `delete` permisos connect + `drop` RPCs/vistas/buckets (orden inverso, `if exists`); rollback doc `ROLLBACK_0142_0149.md`.
- **Pruebas:** crear conversación/mensaje/canal real; favorito persiste; RLS niega no-miembro (smoke negativo); 0151 fail-closed verificado.
- **GO/NO GO:** GO si CRUD real funciona con RLS fail-closed y sin acceso cruzado.

### F3.4 — Bloque D · Contexto ERP
- **Objetivo:** conversación contextual por entidad operativa (vía Context ID) desde los 6 módulos.
- **Componentes:** aplicar `0152`; verificar los 6 embeds (`EntityConversationButton`) + get-or-create + Entity360 contra datos reales.
- **Dependencias:** F3.3; `connect_conversation_links`; adapter 0149.
- **Riesgos:** vocab entity_type (✅ resuelto RC1.3) — verificar; compliance_items (PK text).
- **Rollback:** `drop` RPC 0152 + revertir embeds por git (páginas ERP core).
- **Pruebas:** desde una OS/cliente/OC real abrir su conversación; el vínculo aparece en Entity360; cross-nav ida y vuelta.
- **GO/NO GO:** GO si toda entidad principal abre su conversación y aparece en su 360.

### F3.5 — Bloque E+F · Timeline y Knowledge
- **Objetivo:** registro automático de acciones relevantes + alimentación del conocimiento.
- **Componentes:** verificar adapter `0149` emite `conversation_linked`; verificar `listTimeline`/`listActivity`/`v_knowledge_entity_360` leen real; **decisión**: ¿emitir más eventos (mención/incidente) — mayormente diferido?
- **Dependencias:** Knowledge vivo (✅); F3.4.
- **Riesgos:** per-mensaje no emitido (diseño D-RC1-1); searchable_items diferido (F0.5.2).
- **Rollback:** `disable` fuente en `knowledge_sources` (el adapter deja de emitir); `knowledge_events` es append-only (no se borran).
- **Pruebas:** vincular conversación → evento en timeline/Entity360 real; actividad muestra eventos reales.
- **GO/NO GO:** GO si la vinculación se proyecta a Knowledge sin tocar el emisor/worker.

### F3.6 — Bloque C+G · Realtime y Notificaciones
- **Objetivo:** mensajes en vivo + centro de notificaciones con fan-out real.
- **Componentes:** verificar realtime (`connect_messages` en publicación post-apply); **CONSTRUIR el worker de fan-out** `connect_outbox`→`notifications` (IR-4); (opcional) typing.
- **Dependencias:** F3.3; publicación realtime; `connect_outbox` (existe).
- **Riesgos:** IR-4 (worker, mayor gap); idempotencia del drenado; preferencia `notif_freq_default`.
- **Rollback:** desactivar el cron/route del worker; el resto es aditivo.
- **Pruebas:** mensaje nuevo aparece en vivo; mención genera notificación real; centro agrupa por prioridad; smoke de idempotencia del worker.
- **GO/NO GO:** GO si el fan-out genera notificaciones correctas e idempotentes y el realtime fluye.

### F3.7 — Bloque H · Cockpit y Validación Final
- **Objetivo:** indicadores de Nexus Link en el Cockpit + regresión total.
- **Componentes:** tarjeta KPI read-only (conversaciones activas/no leídos) con **count liviano** (no la agregación completa); regresión completa de Nexus OS.
- **Dependencias:** F3.2–F3.6; `command-center.ts`.
- **Riesgos:** perf del KPI (usar query indexada/liviana); no degradar el SSR del cockpit.
- **Rollback:** quitar la card por git.
- **Pruebas:** KPI correcto; cockpit sin degradación; **regresión total** de todos los módulos; QA verde global.
- **GO/NO GO:** GO si el cockpit integra connect sin regresión y todo el sistema queda verde → **cierre de Fase 3**.

---

## 4. Roadmap técnico, esfuerzo y orden óptimo
| Hito | Bloque | Esfuerzo (dev) | Naturaleza |
|---|---|---|---|
| F3.1 | Auditoría + plan | — (hecho) | Análisis |
| F3.2 | A · Auth/perfiles | ~1–1.5d | Aplicar + cableado pequeño |
| F3.3 | B · Persistencia | ~1d | Aplicar + asignar RBAC + verificar |
| F3.4 | D · Contexto ERP | ~0.5–1d | Verificar |
| F3.5 | E+F · Timeline/Knowledge | ~0.5d | Verificar (+decisión eventos) |
| F3.6 | C+G · Realtime/Notif | ~2–3d | **Construir worker** + verificar |
| F3.7 | H · Cockpit + final | ~1–1.5d | Construir card + regresión |
| **Total** | | **~7–10 días-dev** | + ventanas de apply/deploy (Dirección) |

**Orden óptimo recomendado:** el de los hitos (A→B→D→E/F→C/G→H) es correcto por dependencias, con un matiz: **el apply de `0142`–`0154` conviene hacerlo como una ventana G3 cohesiva al inicio de F3.2** (todo aditivo y greenfield; aplicar medio bloque deja estado no-funcional), y luego los bloques operan como **fases de verificación + trabajo nuevo** sobre el esquema ya aplicado. El deploy de UI va **después** del apply (las páginas viven post-deploy).

---

## 5. Estrategia de rollback (resumen por capa)
- **Lógico (preferido, reversible en caliente):** desactivar fuente en `knowledge_sources`; `delete` permisos `connect.*`; desactivar worker/cron; revertir UI por git + redeploy.
- **Duro (esquema):** `ROLLBACK_0142_0149.md` + drops en orden inverso con `if exists`. Irreversibles conocidos: enum `connect` en `permission_module_t` (permanece inerte) y binarios de storage (backup manual previo). `knowledge_events` es append-only (no se borran).
- **Por bloque:** cada hito define su rollback puntual (ver §3). La rama dedicada permite revertir el código sin afectar `release/nexus-base`.

---

## 6. Checklist de validación (obligatorio por bloque)
`typecheck` 0 · `lint` 0 (RC1) · `tests` verde · `build` 0 · **smoke contra real** (RLS negativo, fail-closed, CRUD) · **revisión manual** de la pantalla del bloque · **verificación de regresiones** (módulos vecinos sin cambios de comportamiento) · `get_advisors` security/performance post-apply. **No avanzar con un solo rojo.**

---

## 7. Criterio GO / NO GO para iniciar la integración
**🟡 GO CON CONDICIONES.** El terreno es de bajo riesgo (greenfield connect, migraciones aditivas, Knowledge vivo, RC1 endurecido y aprobado). Condiciones **antes de F3.2**:
1. **Reconciliar IR-1** — identificar la migración `20260630040905` aplicada hoy en prod y confirmar 0 conflicto con `0142`–`0154`.
2. **Crear la rama dedicada** `feat/nexus-link-integration`.
3. **Definir el plan de asignación RBAC** (qué roles internos ven `connect.*`) — IR-2.
4. **Confirmar backup/PITR** y backup de buckets antes de cualquier apply (red de seguridad).
5. **Autorización expresa de Dirección** para la primera ventana de apply (G3).

Cumplidas las 5 → **GO** para F3.2. Sin push/merge/deploy/migraciones irreversibles/cambios en prod hasta cada autorización puntual.

---

## 8. Confirmación
Etapa 1 (Auditoría) y Etapa 2 (Master Plan) **completas**. No se modificó nada (solo lectura: repo + prod). **No se inicia implementación** hasta que apruebes este Integration Master Plan.
