# TOPS NEXUS — Auditoría de pendientes (Gates 2 y 3 + Otros)

> Generado 2026-06-03. **Informe de clasificación. NO commitea nada.**
> 43 entradas sin commitear en `main` (working tree). Clasificación por dominio + readiness.

---

## Gate 2 — WMS Sprint 2 (Recepciones · Inventario · Ledger · Movimientos)

| Archivo | Estado | Tipo |
|---|---|---|
| `supabase/migrations/0025_wms_receptions.sql` | untracked | SQL |
| `supabase/migrations/0026_inventory_movements.sql` | untracked | SQL (ledger inmutable) |
| `supabase/migrations/0027_wms_functions.sql` | untracked | SQL (RPC confirm_reception/release_quarantine/confirm_movement) |
| `src/lib/wms/receptions.ts` | untracked | TS |
| `src/lib/wms/movements.ts` | untracked | TS |
| `src/lib/wms/data.ts` | modified | TS (inventario) |
| `src/app/(app)/wms/recepciones/page.tsx` | modified | UI |
| `src/app/(app)/wms/recepciones/_components/` | untracked | UI |
| `src/app/(app)/wms/recepciones/actions.ts` | untracked | UI (Server Actions) |
| `src/app/(app)/wms/recepciones/nueva/` | untracked | UI |
| `src/app/(app)/wms/movimientos/page.tsx` | modified | UI |

- **Estado funcional:** ✅ validado — Caso 1 de Recepciones E2E (REC‑2026‑0001, stock=100) + FASE 9A. **Aplicado en DB.**
- **Riesgo:** 🟠 **Alto por dependencia de git** — `0032`/`0033` (commiteadas) dependen de `0026`/`0027`. Hasta commitear esto, la cadena de migraciones en git está partida.
- **Caveat:** Casos 2‑6 de Recepciones (`wms_validation_kit_casos_2-6.sql`) **sin correr**.
- **Veredicto:** ✅ **LISTO para commit aislado** (sugerido: `feat(wms): Gate 2 — Recepciones + Inventario + Ledger (Sprint 2)`).

---

## Gate 3 — Pedidos + Reserva

| Archivo | Estado | Tipo |
|---|---|---|
| `supabase/migrations/0029_pedidos_permission_module.sql` | untracked | SQL (RBAC) |
| `supabase/migrations/0030_logistics_orders.sql` | untracked | SQL (pedidos + stock_allocations) |
| `supabase/migrations/0031_pedidos_functions.sql` | untracked | SQL (RPC allocate_order/release_allocation/cancel_order) |
| `src/lib/pedidos/` (types, orders, allocations) | untracked | TS |
| `src/app/(app)/pedidos/page.tsx` | modified | UI |
| `src/app/(app)/pedidos/[id]/` | untracked | UI (detalle + edit) |
| `src/app/(app)/pedidos/_components/` | untracked | UI |
| `src/app/(app)/pedidos/actions.ts` | untracked | UI (Server Actions) |
| `src/app/(app)/pedidos/nuevo/` | untracked | UI |

- **Estado funcional:** ✅ validado — E2E de reservas (FEFO total+parcial con depleción, liberar/cancelar OK; G‑001 restaurado 100/0). **Aplicado en DB.**
- **Riesgo:** 🟠 **Alto por dependencia de git** — `0032`/`0033` dependen de `0030`/`0031`.
- **Veredicto:** ✅ **LISTO para commit aislado** (sugerido: `feat(pedidos): Gate 3 — Pedidos Logísticos + Reserva FEFO`).

---

## Otros (fuera de gates WMS — NO listos para commit ciego)

| Archivo | Estado | Dominio |
|---|---|---|
| `src/app/(app)/pedidos/.../` (ver Gate 3) | — | — |
| `src/lib/pdf/OrderPdfDocument.tsx` | modified | PDF de pedidos (¿4A? ¿9B?) — **verificar intención** |
| `src/app/(app)/clients/ClientsView.tsx` | modified | Clientes |
| `src/app/(app)/clients/actions.ts` | modified | Clientes |
| `src/lib/data/clients.ts` | modified | Clientes |
| `src/lib/clientify.ts` | modified | Integración Clientify |
| `src/app/(app)/compras/ordenes/[publicId]/OrderDetailTabs.tsx` | modified | Compras |
| `src/lib/compras/email.ts` | modified | Compras |
| `src/lib/compras/pdf/PoPdfDocument.tsx` | modified | Compras |
| `src/lib/org.ts` | modified | Org/RBAC |
| `src/app/globals.css` | modified | Estilos globales |
| `src/lib/supabase/middleware.ts` | modified | Infra/auth |
| `docs/handoff/*.md` + `*.sql` | untracked | Documentación / kits |

- **Estado funcional:** ❓ **desconocido / mezcla** — cambios no asociados a un gate WMS, sin validación documentada en esta fase.
- **Riesgo:** 🟡 **Medio** — intención no clara (¿WIP? ¿ajustes sueltos?). Mezclan dominios (clientes, compras, org, estilos, middleware de auth).
- **Veredicto:** ⛔ **NO listo** — requiere **revisión archivo por archivo** y atribución a su feature antes de commitear. No incluir en los commits de Gates 2/3.
  - `docs/handoff/*` (incluida la documentación de esta sesión): **bajo riesgo**, se puede commitear como `docs(handoff): …` por separado.

---

## Resumen de readiness

| Grupo | Archivos (aprox.) | Readiness | Acción sugerida |
|---|---|---|---|
| Gate 2 (Sprint 2) | 11 | ✅ Listo | commit aislado |
| Gate 3 (Pedidos) | 9 | ✅ Listo | commit aislado |
| Otros (código) | ~12 modificados | ⛔ No listo | revisión individual |
| Docs/kits | ~12 untracked | 🟡 Bajo riesgo | `docs(handoff)` aparte |

**Orden recomendado (Fase 0, cuando se autorice):**
1. `docs(handoff): cierre WMS + snapshots` (estos documentos).
2. `feat(wms): Gate 2 — Recepciones/Inventario/Ledger` (0025/0026/0027 + código).
3. `feat(pedidos): Gate 3 — Pedidos + Reserva FEFO` (0029/0030/0031 + código).
4. Revisar y atribuir "Otros" uno por uno (clientes/compras/org/css/middleware).
5. Reparada la cadena de migraciones → `git push origin main`.

> **NO commitear todavía** — este documento es solo informe (entregable 5).
