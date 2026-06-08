# DEPLOY-CHECKLIST — TOPS NEXUS

**Fecha:** 2026-06-08 · Pasos para llevar `claude/gracious-pasteur-6efdde` a producción.
**Regla permanente:** el asistente NO ejecuta escrituras en prod. Migraciones/seeds y el merge/deploy los realiza el usuario.

---

## A. Pre-merge (verificación de código) — ✅ hecho
- [x] `tsc --noEmit` → PASS
- [x] `next lint` → PASS (0 errores)
- [x] `next build` → PASS (79 páginas, sin warnings)
- [x] Sin hallazgos críticos/importantes abiertos
- [x] `.eslintrc.json` con `root:true` (lint determinístico)

## B. Base de datos (Supabase prod `arsksytgdnzukbmfgkju`)
- [ ] **Confirmar estado de migraciones aplicadas** (0066–0068 ya aplicadas: crm_units, seed, crm_reserve_units).
- [ ] **0069 `clientify_deal_name`** — *opcional, no bloqueante*. Aplicar SOLO si se quiere el nombre real del deal:
  ```sql
  alter table public.crm_opportunities add column if not exists clientify_deal_name text;
  ```
  - [ ] tras aplicar: sumar `clientify_deal_name` al LIST_SELECT/FULL_SELECT de `opportunities-supabase.ts`.
  - [ ] tras aplicar: poblar `name` del Deal en el upsert de sync (frente aparte, con autorización).
  - Si NO se aplica: el front sigue OK (fallback comercial, nunca URL técnica).
- [ ] (Lectura opcional) Ejecutar el SQL read-only de CRM360-KANBAN-DEFAULT-REPORT.md para registrar conteos antes/después del filtro de pipelines.

## C. Variables de entorno (Netlify)
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `CLIENTIFY_API_KEY` **válida** (el token actual del MCP dio 401; verificar la key de runtime en prod)
- [ ] `NEXT_PUBLIC_APP_URL`, `RESEND_*`, `OPENAI_*`, `META_WA_*`, `HIKVISION_*`, `ARCA_*` según módulos activos
- [ ] `NODE_VERSION=22`, `NODE_OPTIONS=--max-old-space-size=4096` (ya en `netlify.toml`)
- [ ] `npm run env:check` sin faltantes

## D. Build & deploy
- [ ] Merge de `claude/gracious-pasteur-6efdde` → `main` (revisar diff: 246 archivos)
- [ ] Build de Netlify verde (`npm run build`, publish `.next`)
- [ ] Verificar que NO corre `next build` con un `next dev` compartiendo `.next` (regla operativa local)

## E. Smoke test post-deploy (sesión autenticada)
- [ ] Login OK
- [ ] CRM360: Kanban abre por defecto · buscador filtra · solo 3 pipelines · sin URLs como título
- [ ] Ficha 360°: header sin URL técnica · pestaña Contrato muestra plantilla por servicio + estado documental
- [ ] Mapas Magaldi/Luján: colores desde crm_units · deep link "Reservar" → CRM360 con unidad precargada
- [ ] Reserva atómica: 2º intento sobre misma unidad → "Unidad ya reservada"
- [ ] RRHH / Compliance / Drive / Facturación: navegación y datos OK
- [ ] Consola del navegador sin errores/hydration

## F. Rollback
- [ ] Plan: revertir el merge en `main` y redeploy del commit previo verde. Las migraciones aplicadas son aditivas/idempotentes (no requieren rollback de esquema).

---

## Resumen
Código **listo** (gates verdes). Lo pendiente es operativo y del usuario: confirmar migraciones (0069 opcional), env vars (incl. Clientify key válida), merge, build de Netlify y smoke test autenticado. Ver GO-NO-GO.md.
