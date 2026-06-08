# RELEASE-FILE-INVENTORY — TOPS NEXUS

**Fecha:** 2026-06-08 · Inventario detallado del Release Candidate (`git add -A` → 241 paths, 0 removes).

---

## A. Código `src/` — 75 (54 modificados + 21 nuevos)

### A.1 Modificados (54)
```
src/app/(app)/anmat/page.tsx
src/app/(app)/cctv/CctvGrid.tsx
src/app/(app)/clients/ClientsView.tsx
src/app/(app)/comercial/contactos/page.tsx
src/app/(app)/comercial/mapa-lujan/LujanMapView.tsx
src/app/(app)/comercial/mapa-lujan/page.tsx
src/app/(app)/comercial/mapa-magaldi/MagaldiMapView.tsx
src/app/(app)/comercial/mapa-magaldi/page.tsx
src/app/(app)/comercial/oportunidades/[id]/Opportunity360View.tsx
src/app/(app)/comercial/oportunidades/[id]/page.tsx
src/app/(app)/comercial/oportunidades/page.tsx
src/app/(app)/comercial/pipeline/page.tsx
src/app/(app)/compras/nueva/NewPoWizard.tsx
src/app/(app)/compras/page.tsx
src/app/(app)/compras/proveedores/page.tsx
src/app/(app)/dashboard/page.tsx
src/app/(app)/ejecutivo/page.tsx
src/app/(app)/layout.tsx
src/app/(app)/orders/new/NewOrderWizard.tsx
src/app/(app)/rrhh/documentos/page.tsx
src/app/(app)/rrhh/empleados/[id]/page.tsx
src/app/(app)/rrhh/empleados/page.tsx
src/app/(app)/rrhh/mi-espacio/page.tsx
src/app/(app)/rrhh/novedades/page.tsx
src/app/(app)/rrhh/page.tsx
src/app/(app)/rrhh/solicitudes/[id]/page.tsx
src/app/(app)/rrhh/solicitudes/page.tsx
src/app/(app)/tesoreria/bancos/page.tsx
src/app/(app)/tesoreria/cobranzas/page.tsx
src/app/(app)/tesoreria/page.tsx
src/app/(app)/tesoreria/pagos/page.tsx
src/app/(app)/workspace/page.tsx
src/app/globals.css
src/components/shell/MobileBottomNav.tsx
src/components/shell/Shell.tsx
src/components/shell/Sidebar.tsx
src/components/shell/Topbar.tsx
src/components/tesoreria/ui.tsx
src/lib/clientify/data.ts
src/lib/clientify/mappers.ts
src/lib/clientify/types.ts
src/lib/comercial/crm-types.ts
src/lib/comercial/opportunities-data.ts
src/lib/comercial/opportunities-mapper.ts
src/lib/comercial/opportunities-supabase.ts
src/lib/comercial/stage-actions.ts
src/lib/env.ts
src/lib/rbac/check.ts
src/lib/rbac/types.ts
src/lib/rrhh/actions.ts
src/lib/rrhh/data.ts
src/lib/rrhh/types.ts
src/lib/rrhh/validation.ts
src/lib/tesoreria/data.ts
```

### A.2 Nuevos (21)
```
src/app/(app)/anmat/[id]/page.tsx
src/app/(app)/clientes/[id]/page.tsx
src/app/(app)/comercial/oportunidades/OpportunitiesView.tsx
src/app/(app)/compras/proveedores/[id]/page.tsx
src/app/(app)/compras/proveedores/actions.ts
src/app/(app)/rrhh/empleados/nuevo/page.tsx
src/app/(app)/tesoreria/bancos/[slug]/page.tsx
src/components/compliance/ComplianceMatrix.tsx
src/components/compliance/SedeTabs.tsx
src/components/compliance/ui.tsx
src/components/compras/NuevoProveedorButton.tsx
src/components/rrhh/EmpleadoForm.tsx
src/components/shell/AccesoRestringido.tsx
src/lib/comercial/opportunity-title.ts
src/lib/comercial/pipeline-filter.ts
src/lib/comercial/units-data.ts
src/lib/compliance/data.ts
src/lib/ejecutivo/command-center.ts
src/lib/legajo/data.ts
src/lib/rbac/cockpit-visibility.ts
src/lib/rbac/guard.ts
```

## B. Migraciones `supabase/migrations/` — 12
```
0052_crm_opportunity_clientify_mirror.sql
0053_crm_ingest_deal.sql
0061_mi_espacio_permission.sql
0061a_rrhh_modalidad_real.sql
0062_rrhh_carga_inicial.sql
0063_rrhh_bancario_carga.sql
0064_rrhh_doc_class_recibo.sql
0065_compliance_core.sql
0066_crm_units.sql
0067_crm_units_seed.sql
0068_crm_reserve_units.sql
0069_crm_opportunities_deal_name.sql   ← opcional, NO aplicada
```

## C. Config raíz — 4
```
package.json            (deps)
package-lock.json       (lockfile)
.eslintrc.json          (+ "root": true — lint determinístico)
.gitignore              (+ .env.local.* / .env*.bak / .next.trash-*/)
```

## D. Assets públicos — 2
```
public/tools/contrato-anmat/index.html         (plantilla Contrato ANMAT)
public/tools/aceptacion-condiciones/index.html (plantilla Aceptación y Condiciones)
```

## E. Scripts — 2 (operativos, leen process.env)
```
scripts/crm-backfill-deals.mjs
scripts/rrhh-ch5b-ingest-recibos.mjs
```

## F. Documentación `docs/handoff/` — 146 `.md`
Reportes de arquitectura, dataflow, QA y deploy acumulados. Incluye los de esta fase final:
`RELEASE-READINESS-AUDIT`, `OPEN-ISSUES`, `QA-REPORT`, `GO-NO-GO`, `DEPLOY-CHECKLIST`,
`PREVIEW-SIGNOFF`, `DEPLOY-RUNBOOK`, `PROD-CHECKLIST`, `ROLLBACK-PLAN`,
`POST-DEPLOY-SMOKE-TEST`, `RELEASE-MANIFEST`, `RELEASE-COMMIT-PLAN`, `RELEASE-FILE-INVENTORY`,
y los de CRM360 (`MAP-TO-CRM-DEEPLINK`, `CRM360-PREFILL-ARCHITECTURE`, `DIGITAL-TWIN-COMMERCIAL-FLOW`,
`P2-IMPLEMENTATION-REPORT`, `CRM360-KANBAN-DEFAULT-REPORT`, `CRM360-SEARCH-IMPLEMENTATION`,
`CRM360-CLIENTIFY-DEAL-NAME-FIX`, etc.).

---

## EXCLUIDOS (no staged — `.gitignore`)
```
.env, .env*.local, .env.local.*.bak, .env*.bak     (secretos / backups de env)
.next/, .next.trash-*/, .next.trash-build-*/        (build output / artefactos)
*.pem, *.log, *.save                                (artefactos)
```
Verificado con `git add -A --dry-run`: 0 de estos serían staged.
