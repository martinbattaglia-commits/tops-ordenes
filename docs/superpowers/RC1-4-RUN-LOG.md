# Nexus Link · RC1.4 — Capa de Experiencia (ÚLTIMA subfase de RC1) · RUN LOG

> **Estado:** implementada y validada · **entregada-NO-aplicada** · **cierra el bloque Nexus Link RC1**.
> **Worktree:** `~/CODE/tops-ordenes-nexus-base` (rama `release/nexus-base`). RC1.0-1.3 congeladas; RC1.4 reusa por import.
> **G7:** aprobado (Plan RC1.4 + D-RC1.4-1..6).

## 1. Objetivo
Convertir Nexus Link en una plataforma **completamente utilizable a diario**: capa de experiencia (UX) sobre RC1.0-1.3, **sin nueva infra/lógica/motores**. Criterio de cierre de RC1: poder usar Nexus Link como plataforma colaborativa principal dentro de Nexus.

## 2. Decisiones de Dirección
- **D-RC1.4-1** — Incidentes **diferidos** (no existen en BD; solo hooks `kind='incident'` reservados). No se construye su lógica.
- **D-RC1.4-2** — Migración `0154` aprobada: reusar `profiles` (4 columnas), sin tablas nuevas.
- **D-RC1.4-3** — Presencia **persistente** (columna), NO Supabase Presence realtime.
- **D-RC1.4-4** — Búsqueda `0153` sobre infra existente; orden **Conversaciones → Contextos ERP → Mensajes** (→ Adjuntos).
- **D-RC1.4-5** — Notificaciones híbridas + prioridad visual **Urgente/Importante/Normal**; sin motor nuevo.
- **D-RC1.4-6** — **Home principal** de Nexus Link = punto de entrada diario (actividad/pendientes/conversaciones/favoritos/notificaciones/canales). No dashboard técnico.

## 3. Entregables
### DB (2 migraciones aditivas, P-1 fail-closed; NO tocan 0142-0152)
- **`0153_connect_search.sql`** — RPC `connect_search(p_query, p_limit)` SECDEF read-only sobre índices FTS/ILIKE existentes (índice GIN español de `connect_messages.body` calzado exacto). Filtra **membresía explícita** (sin fuga: mensajes/contextos/adjuntos solo de conversaciones donde el caller es miembro; canales públicos discoverables). Orden D-RC1.4-4. Guard `has_permission('connect.view')`. Sin motor paralelo, sin `searchable_items` (diferido F0.5.2).
- **`0154_profile_experience.sql`** — `ALTER profiles ADD` avatar_url · presence_status (CHECK online/idle/busy/offline) · profile_meta jsonb · notif_freq_default · last_activity_at + RPCs `set_my_presence` / `update_my_profile` (fail-closed, solo perfil propio `auth.uid()`). RLS de `profiles` (0040) intacta. Sin tablas nuevas.

### Lib (nueva, aditiva)
- `src/lib/notifications/{types(+test),data,actions}` — Centro híbrido: agrega `notifications` (priority A4) + conversaciones no leídas (`v_connect_inbox`); snooze oculta `remind_at` futuro; mark-read/all.
- `src/lib/profile/{types(+test),data,actions}` — perfil propio + presencia/preferencias por RPC.
- `src/lib/connect/read/{search-data,activity-data}` — búsqueda (RPC `0153`) + actividad (reusa `listTimeline`/`v_knowledge_timeline`).
- `src/lib/connect/adapters/driving/favorite-actions.ts` — `toggleFavoriteAction` (reusa `connect_toggle_favorite` 0144, sin DB nueva).

### UI (nueva)
- **Home** `(app)/connect/page.tsx` (D-RC1.4-6) + centros `/connect/{notificaciones,buscar,actividad,perfil,favoritos}` + `_components/{NotificationCenter,GlobalSearch,ActivityLive,ProfileForm}.tsx`.
- Primitivos compartidos: `components/ui/{Skeleton,EmptyState}.tsx`, `components/connect/FavoriteStar.tsx`. Iconos `star/home/activity/inbox` (aditivo en `Icon.tsx`).
- Shell aditivo: `Sidebar.tsx` (nav Nexus Link: Inicio/Actividad/Notificaciones/Búsqueda/Canales + `/connect` en exact-set), `NotificationsBell.tsx` (pie → centro).

### Favoritos sin tocar RC1.1
Favoritos (conversaciones/canales/contextos ERP — todo es conversación) viven en la Home + `/connect/favoritos` con `FavoriteStar`; **NO se modificó `ConversationList`/`ThreadView` (RC1.1 congelada)**.

## 4. Gaps honestos (declarados)
- **Incidentes**: no existen en BD (D-RC1.4-1, diferidos). Notif/Búsqueda/Actividad NO listan incidentes reales; el hook `kind='incident'` queda reservado.
- **Menciones/respuestas como ítems discretos** y fan-out mensaje→notificación: requieren worker `connect_outbox` + detección `@mention` (diferidos, sería infra nueva). En RC1.4 se cubren a nivel de **conversación no leída**.

## 5. Validaciones
- typecheck **0** · build **0** · vitest **378/378** (+5: notificaciones/perfil helpers puros).
- **Render preview (demo):** Home (`/connect`) con las 6 secciones (notificaciones por prioridad, actividad timeline, favoritos, conversaciones con estrellas, canales) + nav lateral; `/connect/notificaciones` (Urgente/Importante/Normal + acciones); `/connect/buscar?q=` (agrupado Conversaciones→Contextos ERP→Mensajes); `/connect/actividad` (timeline Knowledge); `/connect/perfil` (presencia/firma/preferencias); `/connect/favoritos`. **0 errores de consola.**

## 6. Engineering Readiness Review (adversarial, read-only)
- 5 dimensiones (0153-seguridad/0154/lib/UI/congelamiento) → verify por hallazgo. **65 hallazgos, 0 critical, 0 important.** (verify con rate-limiting parcial; las dimensiones de seguridad/congelamiento no arrojaron confirmados.)
- **2 minor — RESUELTOS:** (a) `ProfileForm` `<img>` sin `onError` → agregado fallback a iniciales (`imgBroken` state + reset on change); (b) `GlobalSearch` no re-sincronizaba en Atrás/Adelante → `key={q}` remonta y re-siembra input/ref. Re-validado typecheck 0.
- Confirmado: búsqueda `0153` filtra membresía (sin fuga); `0153`/`0154` fail-closed P-1; RC1.0-1.3 (0142-0152) intactas.

## 7. Estado / cierre RC1
- **RC1.4 lista, entregada-NO-aplicada.** Bloque RC1 = migs **`0142`–`0154`** (RC1.0 0142-0149 · RC1.2 0150+0151 · RC1.3 0152 · RC1.4 0153+0154). Worktree sobre `42ad20d` (RC1.0 commit); RC1.1-1.4 sin commitear/aplicar/pushear/mergear/deployar.
- **🏁 Nexus Link RC1 = COMPLETO** (RC1.0 fundación · RC1.1 mensajería · RC1.2 canales/moderación · RC1.3 conversaciones contextuales · RC1.4 experiencia). Criterio cumplido: plataforma colaborativa usable a diario.
- **Pendiente de Dirección (una sola vez, al cierre de RC1):** aplicar migs `0142`–`0154` a mano (G3) sobre prod `arsksytgdnzukbmfgkju` (re-verificar numeración vs `schema_migrations`) + commit local + push/merge/deploy. **NO avanzar a RC2 sin autorización expresa.**
