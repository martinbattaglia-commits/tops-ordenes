# Nexus Link · RC1.3 — Conversaciones Contextuales del ERP · RUN LOG

> **Estado:** implementada y validada · **entregada-NO-aplicada** · parte del **bloque RC1** (nada se commitea/aplica/pushea/mergea/deploya hasta cerrar RC1 completo).
> **Worktree:** `~/CODE/tops-ordenes-nexus-base` (rama `release/nexus-base`). RC1.0/RC1.1/RC1.2 **congeladas**; RC1.3 reusa por import y es puramente aditiva.
> **G7:** aprobado (Plan RC1.3 + D-RC1.3-1..4).

## 1. Objetivo
Toda entidad del ERP puede tener **SU** conversación: una, contextual, permanente, asociada por `Context ID`, integrada con Knowledge/Entity360, con navegación cruzada entidad ⇄ conversación. **NO** IA/automatizaciones/bots/WhatsApp.

## 2. Decisiones de Dirección
- **D-RC1.3-1** — Conversación **principal única** por entidad (relación `Entidad ERP → Conversación 1:0..1`). Resuelta por get-or-create determinístico (la `erp` más antigua; sin crear una 2ª).
- **D-RC1.3-2** — Componente reutilizable **embebido** en todas las entidades-connect **que ya poseen pantalla de detalle**. Sin lógica por módulo; un único componente.
- **D-RC1.3-3** — Consumo de Knowledge **exclusivamente** vía `v_knowledge_entity_360` (sin vistas nuevas, sin modificar Knowledge).
- **D-RC1.3-4** — Único componente estándar **`EntityConversationButton`** = única forma oficial de acceder a una conversación contextual (mismo icono/comportamiento/ubicación/UX en todo el ERP).

## 3. Artefactos
### DB (1 migración nueva, aditiva)
- **`0152_connect_get_or_create_entity_conversation.sql`** — RPC SECDEF `connect_get_or_create_entity_conversation(p_entity_type, p_entity_id, p_entity_id_text)` → `table(conversation_id, context_id)`. Guard **fail-closed P-1** (`has_permission('connect.create')`), valida vocabulario + coherencia PK uuid/text, get-or-create atómico (crea `erp` + creador owner + link → dispara adapter `0149` → Entity360), determinístico `order by created_at asc, id asc`. `revoke all` + `grant authenticated`. **NO toca 0142-0151.**

### Lib (`src/lib/connect/`)
- `domain/entity-conversation.ts` (+test) — `isConnectEntityType`, `usesTextPk`, `erpEntityHref` (cross-nav), `contextualConversationHref`.
- `read/entity-conversation-data.ts` — `getEntityConversation` (principal, read-only; **desempate `id asc` alineado al RPC** — fix RC1.3-AUDIT-001).
- `read/entity360-data.ts` — `listEntity360` (consume **solo** `v_knowledge_entity_360`, isMock→seeds).
- `entity360-mock.ts` — seeds demo.
- `adapters/driving/entity-conversation-actions.ts` — `getOrCreateEntityConversationAction` (fail-closed: sesión + `connect.create` + zod; ruteo uuid/text).

### UI
- **`src/components/connect/EntityConversationButton.tsx`** — componente estándar (D-RC1.3-4).
- `src/app/(app)/connect/e/[entityType]/[entityId]/page.tsx` — vista contextual (hilo + panel Entity360 + cross-nav; existe-vs-CTA).
- `src/app/(app)/connect/_components/EntityContextPanel.tsx` — timeline Knowledge + cross-nav + Context ID.
- `src/app/(app)/connect/_components/StartEntityConversation.tsx` — CTA get-or-create (write-on-intent).

### Embeds (6 páginas-detalle ERP — aditivo, mismo componente, UUID correcto)
| Entidad | entity_type | Archivo | id |
|---|---|---|---|
| Órdenes de Servicio | `orders` | `orders/[publicId]/page.tsx` | `order.id` (UUID) |
| Clientes | `clients` | `clientes/[id]/page.tsx` | `c.id` (UUID) |
| Órdenes de Compra | `purchase_orders` | `compras/ordenes/[publicId]/page.tsx` | `po.id` (UUID) |
| Proveedores | `vendors` | `compras/proveedores/[id]/page.tsx` | `p.id` (UUID) |
| Compliance/ANMAT | `compliance_items` | `anmat/[id]/page.tsx` | `item.id` (TEXT) |
| Oportunidades | `crm_opportunities` | `comercial/oportunidades/[id]/Opportunity360View.tsx` | `o.id` (UUID) |

> En cada embed se usó el **UUID** de la entidad (no el `publicId`/slug humano), para que el vínculo `connect_conversation_links` apunte a la PK real.

## 4. Gap honesto — entidades pedidas sin pantalla de detalle
De las 8 entidades del mínimo de D-RC1.3-2, **5 no tienen pantalla de detalle hoy** y por la cláusula "que ya poseen pantalla de detalle" **no se embeben en RC1.3**:
- **Facturas de Proveedor** (`compras/facturas` = lista, sin `[id]`).
- **Vehículos** (sin detalle por vehículo; tracking es mapa).
- **Depósitos** (WMS son vistas funcionales, sin detalle por depósito).
- **Prospectos** (`comercial/prospeccion` = lista/tabla, sin `[id]`).
- **Contratos** (`comercial/contratos` = lista, sin `[id]`).

El componente estándar (D-RC1.3-4) queda listo: cuando esas pantallas de detalle existan, adoptarlo es una línea (`<EntityConversationButton entityType=… entityId={uuid} />`). Se adoptaron en cambio **3 entidades-connect extra** con detalle (Proveedores, Compliance, Oportunidades), cumpliendo "todas las que ya poseen detalle".

## 5. Validaciones
- `typecheck` **0** · `build` **0** · `vitest` **373/373** (+4 dominio entity-conversation).
- Ruta `/connect/e/[entityType]/[entityId]` compilada; `EntityConversationButton` confirmado en las 6 páginas.
- **Render preview (demo)** — `/connect/e/orders/<uuid>`: vista contextual con hilo + Context ID `CTX-2026-000003` + panel **CONTEXTO·ENTITY360** con timeline de Knowledge (OS creada · OS firmada · **Conversación vinculada (orders)** ← adapter 0149 · Despacho) + cross-nav "Entidad". `/connect/e/clients/<uuid>` sin conversación → CTA "Iniciar conversación". `entityType` inválido → "no soportado". 0 errores de consola.

## 6. Engineering Readiness Review (adversarial, read-only)
- 5 dimensiones (0152/lógica/UI/Knowledge/embeds) → verify por hallazgo. Etapa verify con rate-limiting parcial (no afecta los confirmados accionables).
- **Confirmados:** 0 critical. **1 important accionable** + notas de conformidad (minor).
- **RC1.3-AUDIT-001 (important) — RESUELTO:** read-path `getEntityConversation` sin desempate vs RPC `created_at asc, id asc`. **Fix aplicado:** `.order("id", { ascending: true })`. Re-validado typecheck 0 / tests 373.
- Conformidad confirmada (minor): RC1.3 es **aditiva** (solo `create or replace function` + grants) y **no modifica 0142-0151**.

## 7. Política de ingeniería aplicada
- **P-1 (fail-closed SECDEF NULL-safe):** `0152` usa guard positivo `has_permission` (sin `NOT IN`/`<>` sobre nullable); `not in (...)` es allowlist de input (raise si no está = fail-closed). NULL de PK manejado explícito.
- Capas: Feature → Server Action → `data`/`read` (`isMock`) → RPC SECDEF / vista `security_invoker`. RPC-first para la escritura. Sin duplicación.

## 8. Estado / próximos pasos
- **RC1.3 lista, entregada-NO-aplicada.** Sin commit/push/merge/apply/deploy (se hará una sola vez al cerrar **RC1 completo**, con G3 manual sobre prod `arsksytgdnzukbmfgkju`).
- **No iniciar RC1.4** hasta declarar RC1.3 oficialmente cerrada (este Run Log + tu confirmación).
- Bloque RC1 a la fecha: migs `0142`–`0152` (RC1.0 0142-0149 · RC1.2 0150+0151 · RC1.3 0152).
