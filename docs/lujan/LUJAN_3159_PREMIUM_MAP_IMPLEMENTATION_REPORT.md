# LUJAN_3159_PREMIUM_MAP_IMPLEMENTATION_REPORT

**Sede:** Pedro Luján 3159 · **Fase:** 2 — UI premium (implementada) · **Fecha:** 2026-06-04
**Decisiones aplicadas:** fuente = capa local `lujan3159-map.ts` · construir UI como ruta nueva no destructiva
**Relacionado:** [CODE_AUDIT](./LUJAN_DIGITAL_MAP_CODE_AUDIT.md) · [DATA_MODEL](./LUJAN_3159_DIGITAL_TWIN_DATA_MODEL.md) · [DATA_INCONSISTENCIES](./LUJAN_3159_DATA_INCONSISTENCIES.md)

---

## 1. Qué se construyó

Mapa Digital Premium **comercial** de Pedro Luján 3159, como **vista nueva** que NO reemplaza el mapa operativo existente (`/operaciones/mapa-inteligente` queda intacto).

**Ruta:** `/comercial/mapa-lujan`

### Funcionalidad entregada (vs. spec del master prompt)
| Requisito | Estado |
|---|---|
| 4 vistas: Comercial / Infraestructura / ANMAT / Racks | ✅ |
| Tarjetas por depósito (PB1–PB15, PA1, PA2) | ✅ |
| Cubículos ANMAT individuales (1º y 2º piso) clickeables | ✅ |
| Estados comerciales (Ocupado / Parcial / Disponible) con color | ✅ rojo / naranja / verde |
| Categoría (Cargas Generales coral · ANMAT azul · Racks navy) | ✅ |
| Cliente por sector/cubículo | ✅ |
| Resumen comercial superior (total/ocupada/disponible/%libre/posiciones/cubículos) | ✅ 6 KPIs |
| Filtros (Todos/Disponible/Ocupado/Parcial/ANMAT/Cargas Generales/Con racks/Cubículos) | ✅ |
| Buscador (depósito/cliente/categoría/estado) | ✅ |
| Panel lateral con detalle completo + fuentes + notas | ✅ |
| Leyenda comercial + categoría + racks | ✅ |
| Niveles de confianza visibles (Estimado / A confirmar) | ✅ pill por tarjeta |
| Exportación PDF (print A4 landscape) | ✅ `window.print()` + print CSS |
| Exportación CSV de disponibilidad | ✅ Blob download (BOM UTF-8, `;`) |
| Responsive desktop/tablet + claro/oscuro | ✅ grid responsive + tokens del design system |

---

## 2. Archivos (rutas modificadas / creadas)

| Archivo | Tipo | Cambio |
|---|---|---|
| `src/lib/wms/lujan3159-map.ts` | **nuevo** | Data model tipado + selectores comercial readiness (Fase 1) |
| `src/app/(app)/comercial/mapa-lujan/page.tsx` | **nuevo** | Server component (metadata) |
| `src/app/(app)/comercial/mapa-lujan/LujanMapView.tsx` | **nuevo** | UI cliente interactiva (~520 líneas) |
| `src/components/shell/Sidebar.tsx` | **editado** | +1 ítem nav `Comercial · CRM → Mapa Luján 3159` (badge "Premium"). Additive, no destructivo. |

**No tocado:** Supabase (sin migraciones), seed `warehouse_*`, `/operaciones/mapa-inteligente`, `twin.ts`, Netlify, PROD, Clientify, ARCA, Custody, RLS.

---

## 3. Comercial Readiness (helpers para CRM)

Expuestos desde `lujan3159-map.ts` (Fase 3 adelantada — funciones puras):
- `getCommercialAvailabilitySummary()` → resumen consolidado.
- `getAvailableAreaByCategory('general' | 'anmat')` → m² disponibles por categoría.
- `getAvailableRackCapacity()` → posiciones libres + sectores pendientes (PB3).
- `getAvailableAnmatCubicles()` → cubículos libres (bloque/piso/code/m²).

Responden los casos de uso del CRM (forecast / validación de capacidad):
- *300 m² ANMAT* → no hay bloque único; combinación de cubículos o 2º piso (258 m²).
- *800 m² CG con racks* → PB8 (806 + 248 pos.) / PB2 (997 + 248) / PB1 penetrable.

---

## 4. Evidencia QA (comandos ejecutados)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | **TSC_EXIT=0** (sin errores de tipos) |
| `npx next lint` (archivos nuevos) | **✔ No ESLint warnings or errors** |
| `npm run build` | **✓ Compiled successfully** · ruta `/comercial/mapa-lujan` = 6.9 kB / 97.7 kB First Load |
| Verificación de datos | `getCommercialAvailabilitySummary()` reproduce **3.613 m² disponibles / 2.315 m² ocupados (39%)** — coincide con el cuadro de Dirección |

> Los warnings `jsx-a11y/alt-text` del build provienen de **otros archivos preexistentes** (embeds de herramientas con `<img>`), no de esta implementación (sus componentes no usan `<img>`).

### Cuadre de totales validado
CG (8 dep) 5.184 + PA1 100 = 5.284 · ANMAT 644 · **Total 5.928 m²** · Disponible 3.613 · Ocupado 2.315 · Racks 1.413 (1.389 pen + 24 sel). ✓

---

## 5. Criterios de aceptación del master prompt

| Criterio | Cumple |
|---|---|
| Distingue Comercial / Infraestructura / ANMAT / Racks / Ocupación | ✅ (4 vistas + estados) |
| Ver qué está ocupado / disponible / por quién / m² / posiciones / cubículos libres | ✅ |
| Resumen coincide: 5.928 / 2.315 / 3.613 / 61% / 39% / 1.413 pos | ✅ (verificado por código) |
| Listo para alimentar el CRM Comercial | ✅ (helpers de readiness) |

---

## 6. Pendiente / próximos pasos

| Ítem | Estado |
|---|---|
| **Screenshots / evidencia visual en vivo** | ⏸️ Requiere sesión autenticada en entorno **no-PROD** (la ruta vive bajo el layout `(app)` con middleware de auth). No se ejecutó para respetar la restricción "no tocar PROD/Supabase PROD". Se puede capturar contra `npm run dev` + Supabase staging/local cuando lo autorices. |
| Reconciliación seed `warehouse_sectors` D→PB | ⏸️ Diseñada, no ejecutada (decisión: capa local es fuente ahora) |
| Confirmaciones de Dirección | ⏸️ PA4/PA5 (2º piso), split PB3, % PB6 |
| Sede Central Magaldi (2ª etapa) | ⏸️ Mismo patrón, fase posterior |
| Conexión real al CRM (forecast/cotización) | ⏸️ Cuando arranque F2.1 del CRM |

---

## 7. Cómo verlo

1. `npm run dev` (puerto 3030).
2. Login en entorno local/staging.
3. Nav: **Comercial · CRM → Mapa Luján 3159** (o ir a `/comercial/mapa-lujan`).
4. Probar: cambiar vista (Comercial/Infra/ANMAT/Racks), filtros, buscador, click en sector/cubículo (panel lateral), exportar CSV/PDF.

**Sin deploy. Sin merge a main. Sin commits** (a la espera de tu autorización).
