# ANMAT-COCKPIT-IMPLEMENTATION-REPORT

**Fecha:** 2026-06-08 · **`tsc --noEmit` PASS (EXIT 0)** · **`next build` PASS (EXIT 0)** · `/anmat` compila (3.16 kB) y responde 307 (gate de auth).
**Fuente oficial:** COMPLIANCE-AUDIT-MASTER-REPORT (08/06/2026) · VEROTIN S.A. / Logística Tops · **33 ítems · 12 categorías · 2 sedes · 747 documentos.**
**Implementación real lista para producción** (no wireframe). Sin escritura en prod (la migración 0065 queda preparada).

---

## 1) Arquitectura funcional
Centro de Control Regulatorio Corporativo en `/anmat` (reemplaza el placeholder previo). Monitorea cumplimiento, vencimientos, alertas, documentación, auditorías, inspecciones y riesgos de **Magaldi** y **Luján** desde una pantalla ejecutiva única.

- **Fuente de verdad hoy:** dataset tipado `src/lib/compliance/data.ts` (los 33 ítems oficiales, sin asumir datos). El cockpit es operativo sin dependencia de DB.
- **Score Nexus:** `100 − críticos×20 − warnings×5` (clamp 0–100). Global = **0/100** (2 críticos + 12 a resolver). Por sede: Magaldi **55**, Luján **45**.
- **Selectores derivados puros:** score, distribución, por categoría, timeline (vencido/30/60/90/90+), centro de alertas (críticos/inmediatos/próximos), obligaciones recurrentes, calendario, KPIs ejecutivos. Ningún dato fabricado: todo deriva del dataset auditado.

## 2) Arquitectura visual (dark enterprise, consistente con Cockpit/Tesorería/Digital Twin)
| Sección | Componente | Detalle |
|---|---|---|
| 1 · Score Global | `ScoreGauge` | Gauge circular SVG, color dinámico (verde/amarillo/naranja/rojo) + fórmula |
| 2 · KPIs ejecutivos | cards `.nx-interactive` | 9 KPIs **deep-link** (Documentos, Vigentes, Próximos, Vencidos, Críticos, Riesgos abiertos/cerrados, Score Magaldi, Score Luján) |
| 3 · Distribución de riesgo | `RiskDonut` | Donut SVG + leyenda (cantidad / %) |
| 4 · Estado por categoría | `CategoryBars` | Barras apiladas por riesgo, 12 categorías |
| 5 · Timeline | `TimelineView` | Buckets vencido · 30 · 60 · 90 · +90, colores semáforo |
| 6 · Centro de alertas | `AlertCenter` | Panel SOC: CRÍTICOS / INMEDIATOS / PRÓXIMOS |
| 7 · Vista por sede | `SedeTabs` (client) | Tabs Magaldi/Luján: score, riesgos, vencimientos ≤90d, documentación |
| 8 · Calendario regulatorio | `CalendarView` | 12 meses 2026 con vencimientos y colores |
| 9 · Obligaciones recurrentes | `RecurringGrid` | Matafuegos, Plagas, Limpieza tanques, SAP, PAT, ACUMAR, ANMAT (último/próximo por sede) |
| 10 · Matriz regulatoria | `ComplianceMatrix` (client) | Búsqueda + filtros (sede/riesgo) + orden (riesgo→días); 12 columnas |

- **Hover/Deep links:** todos los KPIs usan `.nx-interactive` (lift + glow azul + focus-visible), idéntico a Cockpit Ejecutivo / Tesorería / Digital Twin / Tracking. Navegan por anchor a su sección (`#matriz`, `#alertas`, `#timeline`, `#sede-MAGALDI`, `#sede-LUJAN`).
- **Paleta de riesgo** semántica (Verde #16a34a · Amarillo #d97706 · Naranja #ea580c · Rojo #dc2626) sobre tokens Nexus (`card`, `bg-surface`, `fg-*`), dark/responsive.

## 3) Modelo de datos
`ComplianceItem`: `id, sede, categoria, documento, organismo, tipo, emision, vencimiento, frecuencia, estado, riesgo, fuente, nota, docs, dias, venc_fmt, emi_fmt`.
`dias` y `*_fmt` son derivados de presentación (no se persisten). Score y agregados se calculan, no se almacenan.

## 4) Componentes React (nuevos)
- `src/lib/compliance/data.ts` — tipos + 33 ítems + 9 selectores puros.
- `src/components/compliance/ui.tsx` — `RiskBadge, ScoreGauge, RiskDonut, CategoryBars, TimelineView, AlertCenter, RecurringGrid, CalendarView` (server).
- `src/components/compliance/ComplianceMatrix.tsx` — matriz interactiva (client).
- `src/components/compliance/SedeTabs.tsx` — tabs por sede (client).
- `src/app/(app)/anmat/page.tsx` — cockpit (server) que compone las 10 secciones.

## 5) SQL / 6) Migraciones
- `supabase/migrations/0065_compliance_core.sql` — tabla `compliance_items` (PK `id`, checks de `sede`/`riesgo`, índices sede/riesgo/categoría/vencimiento), **RLS** (lectura autenticada, escritura admin) + **seed de los 33 ítems** (idempotente `on conflict (id) do nothing`). **No aplicada** (el cockpit ya opera desde el dataset TS; la migración deja el modelo persistente listo).

## 7) Dashboard final operativo
`/anmat` operativo, dark, ejecutivo, con las 10 secciones y datos reales del informe. Nav ya registrada (Sidebar + MobileBottomNav).

## 8) Typecheck PASS · 9) Build PASS
```
tsc --noEmit        → EXIT 0
next build          → EXIT 0 · /anmat 3.16 kB · 0 errores
```

## Futuro (arquitectura preparada · NO implementado)
Documentado en código + migración (comentarios):
- Ingesta automática desde Drive TOPS → lectura de PDFs → detección de vencimientos.
- Alertas automáticas 30/60/90 + envío de mails + notificaciones Nexus.
- Tablas futuras: `compliance_documents`, `compliance_alerts`, `compliance_ingest_log` (no creadas).

## Datos clave reflejados (verificados contra el informe)
- Score global **0/100** · 2 críticos (CAA Nación vencido MAG-04, Proyecto ANMAT LUJ-15) · 1 inminente (Conservación Edilicia Ley 257 LUJ-10, vence 10/06/2026).
- Distribución: **Vigente 19 · A verificar 9 · Próximo 3 · Vencido/Falta 2** (=33).
- Score Magaldi **55** · Luján **45**.

## 10) Reporte final
Implementación real, tipada y compilada. Sin modificar lógica de otros módulos. Sin escritura en producción. Sin commit/push.
