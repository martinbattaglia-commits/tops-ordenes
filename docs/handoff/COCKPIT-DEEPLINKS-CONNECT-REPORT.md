# Cockpit Ejecutivo — Deep Links + Acceso TOPS Connect

**Fecha:** 2026-06-12 · **Rama:** `feature/cockpit-deep-links` · **PR:** #15 · **Commit:** `680cd9c`
**Alcance:** UX/UI y navegación. Cero cambios de datos, cero migraciones, cero cambios de RBAC.

---

## 1. Resumen ejecutivo

Todas las métricas del Cockpit Ejecutivo (`/ejecutivo`) son ahora **deep links navegables** con la
microinteracción enterprise ya canónica del sistema (`.nx-interactive`), y la topbar incorpora un
**acceso directo premium a TOPS Connect** (portal B2B de clientes) con el branding oficial exacto.

| Validación | Resultado |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ EXIT 0 |
| ESLint | ✅ EXIT 0 (sin errores; solo warnings preexistentes de custody PDF) |
| Build producción (`next build`) | ✅ EXIT 0 — 79/79 páginas, `/ejecutivo` ƒ 607 B |
| Rutas rotas | ✅ 0 — 17/17 destinos verificados contra `src/app/(app)/**/page.tsx` |
| Navegación en vivo | ✅ KPI→/wms · fila Finanzas→/tesoreria · alerta→/comercial/pipeline · TOPS Connect→pestaña nueva |
| Consola | ✅ 0 errores |
| Dark mode | ✅ nativo; tokens adaptativos (`fg-primary`, `stroke-soft`, `bg-surface`) para light |
| Reduced motion | ✅ `.nx-interactive` y `.nx-connect-btn` lo respetan |

---

## 2. Objetivo 1 — Métricas convertidas en deep links

### 2.1 KPI maestro y KPIs ejecutivos (10)

| # | Métrica | Deep link | Fuente del dato |
|---|---|---|---|
| 1 | Cash Flow Proyectado (KPI maestro) | `/tesoreria/flujo-fondos` | `getCashflowProjection()` — Tesorería |
| 2 | Facturación del mes | `/billing` | `listInvoices()` — mismas `customer_invoices` que /billing |
| 3 | Cobranza pendiente | `/tesoreria/cobranzas` | `listCustomerOpenItems()` |
| 4 | Ocupación logística total | `/wms` | `getCorporateVacancySummary()` |
| 5 | Vacancia comercial | `/comercial/dashboard-vacancia` | `getCorporateVacancySummary()` |
| 6 | Leads activos | `/comercial/leads` | Clientify `getContactsPage()` |
| 7 | Oportunidades abiertas | `/comercial/oportunidades` | Clientify (pipeline) |
| 8 | Vehículos online | `/operaciones/tracking` | Traccar `listFleet()` |
| 9 | Cámaras online | `/cctv` | Hikvision `listCamerasSafe()` |
| 10 | KPIs "Dato no disponible" | linkean igual al módulo | decisión: el deep link sirve para investigar la fuente |

### 2.2 Filas de estado de sistema (9)

Cada fila del bloque "X/9 sistemas operativos" navega a su módulo (hover: fondo sutil + chevrón animado):

`Comercial→/comercial/pipeline` · `Compras→/compras` · `Operaciones→/dashboard` · `Finanzas→/tesoreria` ·
`Compliance ANMAT→/anmat` · `Tracking→/operaciones/tracking` · `CCTV→/cctv` · `Drive→/drive` · `RRHH→/rrhh`

### 2.3 Centro de alertas críticas

Cada alerta hereda el `href` del sistema que la origina (p. ej. "Tracking offline" → `/operaciones/tracking`).
El contenedor no linkea (no existe ruta `/alertas`; decisión deliberada validada en auditoría).

### 2.4 Módulos estratégicos (8)

Ya eran `Link` con `.nx-interactive` — sin cambios. Sin link quedan, por decisión de auditoría:
**Salud corporativa** y el contador **X/9** (agregados del propio cockpit; las filas individuales ya navegan).

### 2.5 Microinteracción aplicada (lenguaje visual existente)

Patrón `.nx-interactive` (globals.css) — el mismo de los KPIs del Compliance Cockpit y los módulos estratégicos:
- Hover elevation: `translate3d(0,-3px,0)` + glow `0 18px 40px -18px var(--nx-glow)`
- Halo radial + shimmer sweep · `cursor: pointer` · active `-1px`
- Transición 200ms `cubic-bezier(0.25,0.8,0.25,1)` · `prefers-reduced-motion` respetado
- Filas/alertas (elementos chicos): hover `bg-fg-primary/5` + chevrón/flecha con slide-in 200ms
- Focus visible: ring `tops-blue-700` (accesibilidad teclado)

---

## 3. Objetivo 2 — Botón TOPS Connect

**Componente:** `src/components/shell/TopsConnectButton.tsx` · **Ubicación:** topbar, margen superior
derecho (primer elemento del cluster derecho, antes de fecha/tema/notificaciones), visible en todas las
páginas autenticadas incluido el Cockpit.

- **Branding 1:1** extraído del splash oficial del portal (sin reinterpretación):
  - Hexágono de red: líneas `#3e62f4` (op. 0.5) + 6 nodos `#6188fc`, doble chevrón `#ffffff`/`#e11b27`
  - Tile: gradiente navy `160deg #101c52 → #0a1238` + sombra `rgba(31,51,200,0.6)`
  - Wordmark: **TOPS** (900, `#e11b27`) + **Connect** (500, `fg-primary` adaptativo) · tracking −0.02em
- **Comportamiento:** abre `https://connect.logisticatops.com` en **pestaña nueva**
  (`target="_blank" rel="noopener noreferrer"`) → la sesión de NEXUS queda intacta.
- **Microinteracción** (`.nx-connect-btn`, globals.css): hover `translateY(-1px) + scale(1.03)` +
  glow azul Connect `rgba(31,51,200,0.55)` + borde `rgba(62,98,244,0.45)`, 200ms; flecha externa ↗ con
  micro-desplazamiento; active `scale(0.99)`; focus ring; reduced-motion safe.
- **Responsive:** en `<md` queda el tile (icon-only); wordmark + flecha desde `md`.

---

## 4. Objetivo 3 — Auditoría previa (resultados)

Auditoría multi-agente sobre el código real (cockpit, rutas, shell, RBAC, patrón visual):

1. **Estructura:** página server component; métricas definidas en `src/lib/ejecutivo/command-center.ts`
   y renderizadas por `KpiCard`/`MasterKpi`/`EstadoGeneral`/`AlertasCriticas` (inline en `page.tsx`).
   Se agregó `href` tipado a `SystemState`, `CriticalAlert`, `ExecKpi` y `master`.
2. **Rutas:** inventario completo de `src/app/(app)/**/page.tsx` → los 17 destinos existen literalmente.
   Las rutas sugeridas del requerimiento se mapearon a las rutas reales equivalentes
   (p. ej. `/finanzas/facturacion`→`/billing`, `/crm/clientes`→`/comercial/leads`,
   `/compliance/documental`→`/anmat`, `/seguridad/cctv`→`/cctv`, Inventario→`/wms`).
3. **RBAC — sin conflictos introducidos:**
   - Bloques financieros (Cash Flow, Facturación, Cobranza) y módulo Analytics conservan su gating `exec`
     (`canViewExecutiveFinancialBlocks`) — sin cambios.
   - `/rrhh` tiene page guard server-side (`rrhh.view` → `<AccesoRestringido/>` in-place): el deep link
     nunca rompe permisos; mismo comportamiento que los ítems RRHH del Sidebar.
   - El enforcement real sigue siendo de los page guards (Estrategia B intacta, `RBAC_ENFORCE` sin tocar).
   - Hallazgo preexistente documentado (no introducido por este cambio): mismatch del módulo Analytics
     (link gateado por `cockpit.view`, página exige `analytics.view`). Queda para la etapa de asignación RBAC.

---

## 5. Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/lib/ejecutivo/command-center.ts` | +`href` en tipos y en los 9 sistemas, 8 KPIs, master y alertas |
| `src/app/(app)/ejecutivo/page.tsx` | KpiCard/MasterKpi → `Link .nx-interactive`; filas y alertas → `Link` con hover + chevrón |
| `src/components/shell/TopsConnectButton.tsx` | **nuevo** — botón con asset oficial 1:1 |
| `src/components/shell/Topbar.tsx` | monta `<TopsConnectButton/>` en el cluster derecho |
| `src/app/globals.css` | clase `.nx-connect-btn` (hover premium, reduced-motion) |

## 6. Evidencia visual

- **Before (producción):** KPIs y filas estáticos, sin affordance; topbar sin acceso a Connect.
- **After (validado en vivo):** botón TOPS Connect en topbar; hover con elevación+glow en KPI;
  chevrón en filas de sistema; navegaciones verificadas (KPI→/wms, Finanzas→/tesoreria,
  alerta→/comercial/pipeline, Connect→pestaña nueva con sesión intacta). Capturas en el hilo de entrega.

## 7. Pendiente de aprobación

Deploy Preview (PR #15) → validación visual final → merge `--no-ff` a `main` → deploy productivo.
