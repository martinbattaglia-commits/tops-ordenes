# Nexus Link — Módulo de Comunicación de Nexus OS (RC1)

> Estado: **RC1 COMPLETO y endurecido** · entregado-NO-aplicado · rama `release/nexus-base` · migs `0142`–`0154`.
> Docs vivos: Run Logs `RC1-0..4-RUN-LOG.md` · `RC1-HARDENING-REPORT.md` · `ADR-RC1-HARDENING-001` · spec `specs/2026-06-28-nexus-connect-design.md`.

## Qué es
Plataforma de colaboración interna de Nexus (chat tipo Slack/Teams) integrada al ERP: conversaciones, canales, **conversaciones contextuales atadas a entidades del ERP**, notificaciones, búsqueda, actividad y perfil. Reemplaza WhatsApp personal / Teams / portal suelto.

## Arquitectura
- **Bounded context `connect`** + capas de experiencia `notifications` / `profile`.
- **Patrón de capas:** Feature (`app/(app)/connect/**`) → Server Action (`adapters/driving/*`) → lectura `lib/connect/read/*` (`isMock()`→seeds) / escritura RPC `SECURITY DEFINER` → Supabase (vistas `security_invoker` + tablas `connect_*`).
- **Hexagonal** en mensajería: `domain/` (puro, testeable) · `ports/` · `application/` (use-cases) · `adapters/{supabase,driving}`.
- **RPC-first** (G10): el front nunca escribe tablas directo; los RPC re-validan permiso + membresía.
- **RBAC fail-closed:** `canAccess('connect.view|create|edit')`; RLS por membresía (`_connect_is_member`).
- **Política P-1:** toda SECDEF maneja NULL explícito y es fail-closed (nunca `NOT IN`/`<>` nullable en guards).
- **Integración Knowledge (unidireccional SoR→SoK):** Connect emite el vínculo conversación↔entidad vía `knowledge_emit_event` (adapter `0149`); consume read-only `v_knowledge_timeline` / `v_knowledge_entity_360`. No toca el emisor ni el worker.
- **Context ID** `CTX-AAAA-NNNNNN` permanente e inmutable: referencia transversal (Knowledge/Timeline/audit/búsqueda).

## Subfases (todas cerradas)
| Subfase | Alcance | Migs |
|---|---|---|
| RC1.0 | Fundación: 11 tablas, RLS, RBAC seed, Context ID, adapter Knowledge, storage | 0142-0149 |
| RC1.1 | Mensajería: bandeja, hilos, realtime, optimista, markRead | (reusa 0142-0149) |
| RC1.2 | Canales/grupos/moderación, auto-unión pública fail-closed, hardening fail-close | 0150, 0151 |
| RC1.3 | Conversaciones contextuales del ERP (get-or-create por entidad, Entity360, cross-nav) | 0152 |
| RC1.4 | Experiencia: Home, Notificaciones, Búsqueda, Actividad, Perfil, Favoritos, pulido UX | 0153, 0154 |

## Mapa de rutas
`/connect` (Home) · `/connect/c/[id]` (hilo) · `/connect/canales[/[slug]]` · `/connect/e/[entityType]/[entityId]` (contexto ERP) · `/connect/notificaciones` · `/connect/buscar` · `/connect/actividad` · `/connect/perfil` · `/connect/favoritos`.

## Cómo correr
- **Demo (sin prod):** `.env.local` con `NEXT_PUBLIC_DEMO_MODE=1` y sin vars de Supabase → `npx next dev -p <port>` → datos seed (`isMock()`). UAR de experiencia.
- **Real:** requiere migraciones `0142`–`0154` aplicadas (G3) sobre `arsksytgdnzukbmfgkju` + `.env.local` con Supabase.

## QA
`npm run typecheck` · `npm run lint` · `npm test` (378) · `npm run build` · `npm run lint:boundaries`. Estado: **todo verde** (warnings residuales solo en PDFs no-RC1).

## Pendientes (operativos, requieren autorización de Dirección)
1. Aplicar migs `0142`–`0154` a mano (G3) — re-verificar numeración vs `schema_migrations`.
2. Commit local RC1.1-1.4 + push/merge + deploy Netlify (CLI manual) + smoke.
3. (Pre-F5/externos) Resolver postura RBAC fail-open global (R-2, decisión de Dirección).

## Roadmap (RC2+, NO en RC1 — por decisión de Dirección)
- **IA** (Claude conversación + OpenAI OCR, tool-calling read-only allowlisted).
- **WhatsApp** (Meta Cloud API, inbound + HMAC + ventana 24h).
- **Incidentes** (tabla `connect_incidents` + ciclo de vida; hook `kind='incident'` reservado).
- **Menciones/respuestas discretas** + fan-out mensaje→notificación (worker `connect_outbox`).
- **Portales externos** (F5), Centro de Monitoreo / OIL / Memoria Operativa (visión KIL/MACL/EOL, no implementadas).
- **aria-live incremental** para notificaciones (región *debounced* de delta).

## Invariantes a respetar al evolucionar
No tocar el emisor único de Knowledge ni el worker; toda fuente nueva = adaptador + fila en `knowledge_sources` (OCP). RPC-first para escrituras. RLS por membresía como frontera de PII. Migraciones idempotentes, numeradas al siguiente libre, entregadas-NO-aplicadas (las aplica Dirección a mano).
