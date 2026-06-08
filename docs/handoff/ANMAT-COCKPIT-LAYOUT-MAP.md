# ANMAT-COCKPIT-LAYOUT-MAP

**Fecha:** 2026-06-08 · **tsc PASS · build PASS** · `/anmat` 3.27 kB · `/anmat/[id]` 251 B · 0 errores.
Mapa final del ANMAT Cockpit + ficha regulatoria por ítem (Opción B aprobada).

## Estructura de la página `/anmat`
```
HEADER ─────────────────────────────────────── informativo
BANNER CRÍTICO ──────────────────────────────── informativo
§1  Compliance Score Global (ScoreGauge) ────── informativo
§2  KPIs ejecutivos [9] ──────── NAVEGABLES · DEEP LINK · .nx-interactive
§3  Distribución de riesgo (RiskDonut) ──────── informativo (gráfico)
§4  Estado por categoría (CategoryBars) ─────── informativo (gráfico)
§5  Timeline  #timeline ───────── informativo · DESTINO deep link
§6  Centro de alertas  #alertas ─ informativo · DESTINO deep link
§7  Vista por sede  #sede ─────── INTERACTIVO (tabs) · DESTINO (#sede-MAGALDI/#sede-LUJAN)
§8  Calendario regulatorio 2026 ─ informativo
§9  Obligaciones recurrentes ──── informativo
§10 Matriz regulatoria  #matriz ─ INTERACTIVO (búsqueda/filtros/orden) · DESTINO · filas NAVEGABLES → ficha
ROADMAP / metodología ───────────────────────── informativo
```

## Navegabilidad
| Tipo | Componentes |
|---|---|
| 🔗 Deep link saliente (.nx-interactive) | 9 KPIs ejecutivos → #matriz / #timeline / #alertas / #sede-MAGALDI / #sede-LUJAN |
| 🔗 Navegable a ficha | **cada fila de la matriz** (ID + documento) → `/anmat/[id]` |
| 🎛️ Interactivo (client) | SedeTabs (tabs Magaldi/Luján) · ComplianceMatrix (búsqueda/filtros/orden) |
| 🎯 Destinos de deep link | #timeline · #alertas · #sede(+sede-MAGALDI/LUJAN) · #matriz |
| 📊 Informativo | Header, Banner, Score, Donut, Barras, Timeline, Alertas, Calendario, Recurrentes, Roadmap |

## Ficha regulatoria `/anmat/[id]` (Opción B)
Comportamiento estándar: **Matriz → click → Ficha**.

Cada ítem muestra:
- Encabezado: id, estado (RiskBadge), sede, documento, categoría · organismo.
- Bloque riesgo + fechas: riesgo (color), emisión, vencimiento, **días**, estado.
- Datos regulatorios: organismo, categoría, sede, tipo de documento, frecuencia, fuente.
- **Notas de auditoría** (texto completo del informe).
- **Documentación asociada (Drive)** — arquitectura preparada, **sin ingesta**: muestra el conteo de documentos de respaldo de la auditoría + el modelo futuro `compliance_documents (storage_path, sha256, item_id → compliance_items.id, fecha_extraida, organismo_detectado)`. Botón "Vincular documento" deshabilitado hasta la ingesta automática.

## Archivos
- `src/app/(app)/anmat/page.tsx` (cockpit)
- `src/app/(app)/anmat/[id]/page.tsx` (ficha · nuevo)
- `src/components/compliance/ui.tsx` · `ComplianceMatrix.tsx` (filas → Link) · `SedeTabs.tsx`
- `src/lib/compliance/data.ts` (+ `getItem(id)`)
- `supabase/migrations/0065_compliance_core.sql` (modelo DB-backed + seed; futura `compliance_documents` documentada)

## Validación
`tsc --noEmit` EXIT 0 · `next build` EXIT 0 · `/anmat` + `/anmat/[id]` compilados · `/anmat` → 307 (gate auth).

> ANMAT Cockpit completo (cockpit + ficha por ítem + arquitectura Drive preparada). CRM360 sigue en cola, sin iniciar. Sin escritura en prod. Sin commit/push.
