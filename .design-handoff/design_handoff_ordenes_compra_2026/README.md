# Handoff · Sistema de Órdenes de Compra Digitales — Logística TOPS 2026

## Overview

Este handoff describe el rediseño completo del sistema de **Órdenes de Compra** de **Logística TOPS / Verotin S.A.**, llevándolo de un formulario manual en papel a una plataforma SaaS empresarial digital, móvil-first y automatizada.

La aplicación cubre todo el flujo:

- Creación de OC en 4 pasos (proveedor → datos generales → productos → firma digital)
- Firma digital del Director de Operaciones (José Luis Battaglia, único emisor autorizado)
- Generación automática de PDF corporativo con QR
- Envío automático por email al proveedor + administración (Ruth) + dirección
- Almacenamiento automático en Google Drive (`/Órdenes de Compra 2026/Mes/Proveedor/`)
- Panel administrativo, historial filtrable, conciliación contra facturas
- Maestro de proveedores con CUIT, contacto y rendimiento histórico

## About the Design Files

> **Los archivos HTML/JSX de este bundle son referencias de diseño — prototipos que muestran el look & feel y los comportamientos esperados, NO código de producción para copiar tal cual.**

La tarea es **recrear estos diseños en el entorno productivo del proyecto** (React + framework de tu elección, o el stack ya establecido) siguiendo los patrones y bibliotecas que el equipo ya utilice.

Si todavía no existe un codebase, se recomienda:

- **Frontend**: React 18 + TypeScript + Tailwind CSS + Framer Motion + React Router
- **Backend**: Firebase (Firestore + Auth + Functions) o Supabase
- **PDF**: `pdf-lib` o `react-pdf` para generación lado servidor
- **Firma digital**: `react-signature-canvas` o `signature_pad`
- **Email**: Resend o Gmail API (vía Service Account)
- **Drive**: Google Drive API v3 (con cuenta de servicio)
- **QR**: `qrcode` (npm) — apuntando a la URL de validación del comprobante

## Fidelity

**High-fidelity (hi-fi).** Los mockups tienen colores finales, tipografía Gotham, espaciados, iconografía Lucide, microinteracciones y copy en español rioplatense neutral, alineado al manual de marca de Logística TOPS. Reproducir fielmente.

---

## Pantallas / Vistas

### 1. Login — `extras.jsx` → `Login`

**Propósito**: acceso corporativo con email `@logisticatops.com` o Google Workspace SSO.

**Layout**: split 1fr / 480px.

- **Panel izquierdo (brand)**: foto fachada Magaldi 1765 a full-bleed con overlay azul `rgba(5,5,85,0.55)`. Eyebrow rojo "COMPRAS INTELIGENTES · 2026", título display `52px / 1.04 / -0.015em / uppercase`, párrafo subtítulo, fila de stats (42 OC · $ 24,8 M · 84% conciliación) divididas por `border-top: 1px rgba(255,255,255,0.18)`.
- **Panel derecho (form)**: padding 48/56 px. Logo color en top-left. Input email con icono, input password con icono. Checkbox "Mantener sesión iniciada" + link "¿Olvidaste tu contraseña?". Botón primario full-width "Ingresar al panel". Separador "O". Botón ghost "Continuar con Google Workspace" (logo G oficial 4 colores). Footer fino con CUIT 33-60489698-9 + dirección.

### 2. Dashboard — `dashboard.jsx` → `Dashboard`

**Propósito**: panel ejecutivo con KPIs, gráficos y alertas accionables.

**Layout** (grid columns):
- Header: eyebrow rojo · H1 "Buen día, José Luis." · subtítulo + botones (Exportar mes / Nueva orden)
- KPI grid: 4 columnas iguales, gap 16px
- Charts grid: `1.6fr 1fr` gap 16px → SpendChart + CategoryMix
- Bottom grid: `1.6fr 1fr` gap 16px → RecentOrdersCard + AlertsCard

**KPIs** (cada uno): label en uppercase 12px wide-tracking, valor 30px tabular-nums, delta verde/rojo con flecha, sparkline 70×28px en bottom-right. El segundo KPI ("Monto comprometido") lleva `featured-stroke` (top stroke rojo 3px).

**SpendChart**: barras agrupadas, últimos 6 meses, emitidas (azul `#050555`) vs conciliadas (rojo `#C90812`). SVG con grid horizontal `#EEF1F6`, labels eje Y tabular `$ 28 M / $ 21 M / $ 14 M / $ 7 M / $ 0 M`. Leyenda en card head.

**CategoryMix**: donut SVG 160×160px con 6 segmentos (Combustible 28%, Insumos depósito 22%, Repuestos 16%, IT 12%, ANMAT 11%, Otros 11%). Centro: "$ 24,8" + "MILLONES". Leyenda con swatches cuadrados 10×10 a la derecha.

**RecentOrdersCard**: tabla con últimas 6 OC, columnas: Orden · Proveedor (razón + CUIT abajo) · Categoría (con icono tag) · Total (tabular-nums, color brand) · Estado (badge) · menu kebab.

**AlertsCard**: 4 filas con icon-box 36px (color por kind), título, detalle, contador a la derecha. Kinds: warn (factura faltante), info (pendientes firma), danger (diferencia contra factura), ok (sync Drive).

### 3. Historial / Órdenes — `orders-list.jsx` → `OrdersList`

**Propósito**: tabla completa con filtros para auditoría administrativa.

**Layout**: header standard + tabs de estado en pill-group, fila de filtros en card, tabla principal.

**Tabs**: Todas, Enviadas, Firmadas, Pendientes, Conciliadas, Borradores — cada uno con contador. La activa usa `btn-primary`, las demás `btn-ghost` sin borde.

**Filter row**: input search con icono · `FilterPill` (Proveedor) · `FilterPill` (Período) · `FilterPill` (Monto). A la derecha: contador de resultados + suma total tabular-nums.

**Tabla**: columnas — checkbox · Orden (mono) · Fecha · Proveedor (razón + CUIT) · Categoría · Items (tabular-nums) · Total (color brand, bold, tabular-nums) · Estado (`StatusBadge`) · Firma (SVG glifo + iniciales "JL") · menu kebab.

**Footer paginación**: contador + botones `<` `1` `2` `3` `>`.

### 4. Detalle de OC + PDF Preview — `order-detail.jsx` → `OrderDetail`

**Propósito**: vista de una orden con metadatos, trazabilidad, comprobante PDF embebido.

**Layout**: grid `360px 1fr` gap 24px.

**Columna izquierda (sticky)**:
- Card de header con eyebrow OC-ID, h2 razón social, CUIT, badge de estado, grid 2×2 de metadatos (Fecha, Cond. pago, Destino, Entrega), bloque totales (Total destacado, neto+IVA a la derecha).
- Card "Emisor autorizado": avatar rojo "JL" 36px, nombre + rol, check verde "Firmada".
- Card "Trazabilidad": timeline vertical con 4 eventos (OC generada → Firma → Email → Recibido + factura), dots con check verde/blanco según estado, línea vertical `var(--neutral-100)`.
- Card "Envíos automáticos": 3 chips `EmailChip` (Proveedor / Dirección / Administración) con doble check verde (delivered + opened).
- Card "Sincronizado en Drive": icon check verde + path mono completo.

**Columna derecha**:
- Header con eyebrow "Vista previa · A4" + tabs de canal (PDF / Email / WhatsApp)
- `PdfPreview` — documento A4 con `aspect-ratio: 1 / 1.414`, padding 36/38px:
  - Top accent bar 4px rojo
  - Header con logo color (alto 38px) + datos Verotin + Razón "Orden de Compra" + número mono 20px + fecha
  - Bloque "Proveedor" con grid 1.7fr 1fr 1fr (Razón / CUIT / Contacto + Domicilio / Teléfono / Email)
  - Bloque "Destino" en card neutral-50 con 4 columnas
  - Tabla de items con thead azul-900 / blanco, filas con bottom border `--stroke-soft`, filler rows para mantener forma de planilla
  - Bloque totales a la derecha (Subtotal · IVA 21% · TOTAL con top-border 1.5px azul-900)
  - Footer 3 columnas: Autorizado por (firma SVG manuscrita "José Luis" + nombre + timestamp) · Recibido y verificado por (línea vacía o factura A-0003-…) · QR pseudoaleatorio 92×92 + caption "Validar OC"
  - Disclaimer fino con hash sha256 + ID Drive

### 5. Nueva Orden — `new-order.jsx` → `NewOrder`

**Propósito**: wizard de 4 pasos para crear una OC firmada.

**Layout**: header de breadcrumb + stepper · grid `1.15fr 1fr` gap 24px (formulario + preview en vivo del PDF escalado 88%).

**Stepper**: 4 items (Proveedor / Datos generales / Productos / Firma) con número en círculo. Activo: azul-900 / blanco + label azul-900 bold. Completado: verde + check icon.

#### Paso 1 — Proveedor
- Eyebrow paso N de 4 + h2 "Proveedor" + párrafo guía
- Búsqueda inteligente: input con icono search + dropdown autocomplete que muestra hasta 10 proveedores, cada fila con avatar 28×28 color azul-700, razón + meta (CUIT · # órdenes · última), tags chips a la derecha.
- Form fields: Razón Social (2fr) + CUIT (1.2fr con check verde de validación AFIP), Domicilio (2fr) + Teléfono (1fr), Contacto + Email (con icono mail + help "Recibirá el PDF automáticamente").

#### Paso 2 — Datos generales
- **Destino**: 2 DepotCards lado a lado (Magaldi · ANMAT / Luján · General). Card seleccionada: fondo azul-900, texto blanco, icon check-circle en top-right, badge transparente blanco-16. No seleccionada: fondo blanco, borde stroke-soft.
- Condición de pago (select wrapper con chevron) + Fecha de entrega (input con icono calendar)
- Categoría: chip-group con 9 categorías, la seleccionada en azul-900/blanco con check icon
- Emisor: card con gradient rojo→azul sutil, avatar JL rojo, datos JL, badge "Autorizado" verde

#### Paso 3 — Productos
- Tabla dinámica `lines-table` con columnas N° / Producto / Cant. / Un. / Precio unit. / Subtotal / acción borrar.
- Inputs transparentes con hover→fondo blanco, focus→borde azul-700 + shadow.
- Click en columna producto abre `ProductPicker` (dropdown con 10 productos del catálogo, label + SKU mono + precio).
- Botón "Agregar producto" en estilo dashed dentro del card.
- Bloque totales debajo en card neutral-50: Subtotal neto / IVA 21% / TOTAL con top-border azul.
- Textarea "Observaciones".
- Sugerencia inteligente: card con gradient sutil, icon wand, copy "Pallets Sur suele entregar cinta adhesiva junto con pallets. ¿Sumar 24 un.?" + botón "Agregar".

#### Paso 4 — Firma
- Card con avatar JL + datos del emisor
- Signature pad: canvas 200px alto, dashed border 2px stroke-strong, hint "X — JOSÉ LUIS BATTAGLIA" en top-left, placeholder pen icon + texto centrado cuando vacío.
- Soporta mouse + touch (touchAction:none, preventDefault). DPR-aware (scale ctx por devicePixelRatio).
- Botones: "Limpiar" (ghost) + indicador "Hash SHA-256 generado al guardar".
- Bloque "Al confirmar se ejecutarán automáticamente": 4 acciones con check verde (Generar PDF / Guardar en Drive / Enviar email a 3 destinatarios / Registrar en historial).
- Botón final rojo grande "Confirmar, firmar y enviar" deshabilitado hasta que haya tinta.

**Vista previa en vivo**: `PdfPreview` escalado 0.88, sticky top, marca "Sincronizado" con dot verde pulsante.

### 6. Email al proveedor — `extras.jsx` → `EmailPreview`

**Propósito**: mostrar la plantilla de email automática.

**Layout**: grid `1.2fr 1fr` gap 24px.

**Izquierda — EmailMockup**: mock estilo cliente de email con barra superior (3 dots de macOS + dirección), header con avatar T azul-900, de/para, fecha, asunto h3 azul-brand. Cuerpo con saludo personalizado, párrafo, resumen en grid 2×2 (Orden / Fecha / Cond. pago / Entrega en / Items / Total bold rojo), CTA inline rojo "Ver Orden de Compra (PDF) →", firma. Footer con 2 attachments (PDF 312KB + PNG firma 34KB).

**Derecha — Reglas**: 3 RuleRows (Siempre / Siempre - copia / Siempre - copia) con tag a la derecha. Sección adjuntos. Info card azul sobre sync Drive.

### 7. Proveedores — `extras.jsx` → `Vendors`

Tabla maestra: Proveedor (avatar color + razón + CUIT) · Categoría · Contacto (nombre + teléfono) · Cond. pago · OC histórico (tabular) · Comprado YTD (color brand) · Última OC · menu.

### 8. Drive — `extras.jsx` → `DrivePage`

- Card de status: icon check verde + email JL + "324 órdenes sincronizadas · 2,4 GB · última sync hace 8 min" + badge "Conectado".
- Grid auto-fill 220px de folder cards (Enero/Febrero/.../Mayo 2026) con icono folder azul-900 estilo Drive, contador de órdenes, chips de avatares de proveedores.

---

## Interacciones & Comportamiento

### Navegación
- **Routing**: state-based (`route` en useState). 9 rutas: dashboard, orders, order-detail, new, vendors, reports, billing, email-preview, drive, settings.
- **Mobile**: bottom-nav con 5 items (Inicio / Órdenes / Nueva [FAB rojo] / Proveedores / Más) + drawer lateral desde sidebar.

### Wizard NuevaOC
- Botones Atrás/Continuar al fondo del card
- Click en step "done" navega a ese paso
- Auto-guardado simulado (badge "Auto-guardado" en breadcrumb)

### Firma digital
- Canvas escucha mousedown/move/up + touchstart/move/end con `passive: false`
- DPR-aware: `canvas.width = rect.width * dpr; ctx.scale(dpr, dpr)`
- `lineWidth: 2.4`, `lineCap: round`, `strokeStyle: #050555`
- Botón confirmar habilitado solo si `hasInk === true`
- Al confirmar: `toDataURL('image/png')` → push toast → modal de éxito

### Toasts
- Stack en `position: fixed; top: 76px; right: 28px` (mobile: top/left/right)
- Auto-dismiss 5.5s
- Kinds: signed (default azul), info (azul-700), warn (amber), success (verde)
- Animación entry: 320ms `cubic-bezier(0.22,1,0.36,1)` translate-up + fade

### Modal de éxito
- Backdrop `rgba(5,5,85,0.45)` + `backdrop-filter: blur(4px)`
- Card max-width 560px con check verde grande, número OC, monto, 3 send items con check, ruta Drive
- En mobile: bottom-sheet con animación `translateY(100% → 0)`

### Animaciones
- Easing entry: `cubic-bezier(0.22, 1, 0.36, 1)` · exit: `cubic-bezier(0.4, 0, 1, 1)`
- Duración: 180–240ms UI · 320–420ms section reveals
- NO bounces, NO scale-up, NO rotation
- Hover cards: `translateY(-1px)` + `box-shadow: var(--shadow-sm)`
- Hover botón sólido azul-900: cambia a azul-700, sin scale
- Hover botón rojo: oscurece a `#A8060F`

### Responsive
- Breakpoint `max-width: 900px`: sidebar oculto (drawer), tabla → cards, KPI grid 4→2 cols, login full-width sin panel brand
- Breakpoint `max-width: 480px`: page-title 20px, sparklines ocultas

---

## State Management

```ts
// Root App
const [authed, setAuthed] = useState(false);
const [route, setRoute] = useState<Route>('dashboard');
const [openOrderId, setOpenOrderId] = useState<string | null>(null);
const [toasts, setToasts] = useState<Toast[]>([]);
const [showSuccess, setShowSuccess] = useState<Order | null>(null);
const [notifs, setNotifs] = useState<Notif[]>(NOTIFS_INITIAL);
const [menuOpen, setMenuOpen] = useState(false);

// NewOrder wizard
const [stepIdx, setStepIdx] = useState(0);
const [data, setData] = useState<OrderDraft>({
  providerId, proveedor, cuit, domicilio, telefono, contacto, email,
  condPago, categoria, destino, depot, entrega,
  items: LineItem[], observ, signatureData: string | null
});
const totals = useMemo(() => {
  const neto = items.reduce((a,b) => a + b.total, 0);
  const iva = Math.round(neto * 0.21);
  return { neto, iva, total: neto + iva };
}, [data.items]);
```

### Datos requeridos del backend
- `GET /api/orders` — listado con filtros (status, providerId, period, amount, q)
- `GET /api/orders/:id` — detalle con items y trazabilidad
- `POST /api/orders` — crear nueva OC. Body incluye signatureData base64, items, metadatos. Backend genera ID `OC-2026-XXXX`, PDF, sube a Drive, envía email.
- `POST /api/orders/:id/resend` — reenviar email
- `GET /api/vendors` — maestro proveedores con estadísticas
- `GET /api/vendors/search?q=` — autocomplete
- `GET /api/products` — catálogo SKU
- `POST /api/auth/login` / `POST /api/auth/google`

### Validaciones
- CUIT: 11 dígitos en formato `XX-XXXXXXXX-X`, validación módulo 11 + consulta AFIP opcional
- Email proveedor: regex estándar + DNS check opcional
- Cantidad: `> 0`, precio `>= 0`
- Firma: requerida en paso 4
- Solo José Luis Battaglia puede emitir (verificar `auth.user.role === 'director_ops'`)

---

## Design Tokens

Tomados del Logística TOPS Design System. Disponibles en `assets/colors_and_type.css`.

### Colores

| Token | Hex | Uso |
|---|---|---|
| `--tops-blue-900` | `#050555` | Marca master, fondos oscuros, sidebar |
| `--tops-blue-700` | `#214576` | Secundario, hover, gráficos |
| `--tops-red` | `#C90812` | Accent, botones de acción, eyebrows |
| `--tops-white` | `#FFFFFF` | Surface |
| `--neutral-50` | `#F7F8FB` | Page bg |
| `--neutral-100` | `#EEF1F6` | Hover sutil |
| `--neutral-200` | `#DDE2EB` | |
| `--neutral-300` | `#C2CAD6` | |
| `--neutral-400` | `#9AA3B2` | Placeholders |
| `--neutral-500` | `#6B7384` | Texto secundario |
| `--neutral-700` | `#3F4757` | Texto primary |
| `--neutral-900` | `#0E121A` | Texto fuerte |
| `--status-success` | `#0E7C3A` | |
| `--status-warning` | `#B45309` | |
| `--status-danger` | `#C90812` (= rojo brand) | |
| `--status-info` | `#214576` | |
| `--stroke-soft` | rgba(5,5,85,0.08) | Dividers default |
| `--stroke-strong` | rgba(5,5,85,0.16) | Bordes fuertes |

### Tipografía

**Familia**: **Gotham** (primary, en `assets/fonts/`). Fallbacks: Montserrat, system-ui. Mono: SF Mono, Menlo, monospace.

| Token | Size | Line | Weight | Tracking |
|---|---|---|---|---|
| `--display-xl-*` | 64px | 1.04 | 700 | -0.02em |
| `--display-lg-*` | 52px | 1.06 | 700 | -0.015em |
| `--h1-*` | 30px | 1.15 | 700 | -0.005em |
| `--h2-*` | 22px | 1.2 | 700 | -0.005em |
| `--h3-*` | 17px | 1.3 | 700 | 0 |
| `--body-lg-*` | 16px | 1.6 | 400 | 0 |
| `--body-*` | 14px | 1.55 | 400 | 0 |
| `--body-sm-*` | 13px | 1.5 | 400 | 0 |
| `--eyebrow-*` | 10–11px | 1 | 700 | 0.16em |
| `--caption-*` | 11px | 1.4 | 500 | 0.02em |

**Casing**: eyebrows + display + buttons en UPPERCASE. Headlines en sentence case. Body normal.

### Spacing

`--space-1: 4px · --space-2: 8px · --space-3: 12px · --space-4: 16px · --space-5: 20px · --space-6: 24px · --space-8: 32px · --space-10: 40px · --space-12: 48px · --space-16: 64px · --space-20: 80px · --space-24: 96px · --space-32: 128px`

### Radii

`--radius-xs: 4px · --radius-sm: 6px · --radius-md: 6px (default) · --radius-lg: 10px (cards/photos) · --radius-xl: 16px (hero) · --radius-pill: 999px`

**Regla**: nunca radios > 16px en elementos interactivos.

### Shadows

Todas tintadas hacia el azul brand (`rgba(5,5,85,...)`), nunca negro puro.

`--shadow-xs: 0 1px 2px rgba(5,5,85,0.04)`
`--shadow-sm: 0 2px 8px rgba(5,5,85,0.06)`
`--shadow-md: 0 6px 18px rgba(5,5,85,0.10)`
`--shadow-lg: 0 18px 40px rgba(5,5,85,0.20)`

---

## Iconografía

**Set**: Lucide (línea, 1.5px stroke, 24px nominal).

Iconos personalizados implementados en `icons.jsx`: dashboard, orders, cart, plus, minus, vendors, clients, report, bill, gear, search, bell, arrow-(right/left/up-right), trend-(up/down), check, check-circle, x, download, send, mail, phone, truck, package, building, pin, clock, calendar, filter, menu-dots, eye, pen, export, qr, lock, user, sparkle, logout, chevron-(down/right), refresh, paperclip, bolt, trash, copy, drive, cloud, cloud-check, file-pdf, wallet, tag, database, shield, pause, play, wand.

Reemplazar por imports de `lucide-react` en producción. Mantener `strokeWidth={1.6}`.

---

## Tone of voice

- **Idioma**: español rioplatense neutral. No voseo en copy corporativo.
- **Persona**: nosotros (corporate) / usted (CTAs directas al proveedor).
- **Tono**: industrial, técnico, sin hype. Cuantificable.
- **Números**: separador miles `.`, decimales `,` (`$ 24.800.000` o `$ 24,8 M`).
- **Casing**: ANMAT, AMBA, CABA siempre en caps.
- **No emoji** en superficies corporativas.

Ejemplos on-brand:
- ✅ "Buen día, José Luis. 9 órdenes emitidas este mes."
- ✅ "Trazabilidad completa de cada compra emitida."
- ✅ "Coordinación con muelle, requisitos, certificados…"
- ❌ "Descubrí la magia de las compras digitales 🚀"

---

## Datos de la organización (constantes)

```ts
const ORG = {
  legalName: 'Verotin S.A.',
  brand: 'Logística TOPS',
  cuit: '33-60489698-9',
  iva: 'Responsable Inscripto',
  address: 'Agustín Magaldi 1765 (C1286AFM) — CABA · Argentina',
  phone: '(011) 4302-3944 / 3541 / 9710',
  website: 'www.logisticatops.com',
  emitter: {
    name: 'José Luis Battaglia',
    role: 'Director de Operaciones',
    email: 'joseluis@logisticatops.com',
  },
  admin: { name: 'Ruth Cardozo', email: 'ruth@logisticatops.com' },
  depots: [
    { id: 'magaldi', name: 'Magaldi', address: 'Agustín Magaldi 1765 · CABA', anmat: true },
    { id: 'lujan',   name: 'Luján',   address: 'Ruta 8 km 67.5 · BsAs',     anmat: false },
  ],
};
```

---

## Estructura de archivos en este bundle

```
design_handoff_ordenes_compra_2026/
├── README.md                           ← este archivo
├── index.html                          ← root, importa todos los JSX
├── styles.css                          ← layout, componentes app-level
├── tweaks-panel.jsx                    ← panel de tweaks (omitir en prod)
├── icons.jsx                           ← set de iconos Lucide-style
├── data.jsx                            ← mocks de proveedores/productos/órdenes
├── shell.jsx                           ← Sidebar + Topbar + MobileBottomNav
├── dashboard.jsx                       ← Panel administrativo + KPIs + charts
├── orders-list.jsx                     ← Historial + filtros
├── order-detail.jsx                    ← Detalle OC + PDF preview + QR
├── new-order.jsx                       ← Wizard 4 pasos + signature pad
├── extras.jsx                          ← Login + EmailPreview + Vendors + Drive
├── app.jsx                             ← Root: routing, toasts, success modal
└── assets/
    ├── colors_and_type.css             ← tokens del design system Logística TOPS
    ├── fonts/                          ← Gotham + Gotham Rounded (.otf)
    ├── logo-color-transparent.png
    ├── logo-color-blue-bg.png
    ├── logo-horizontal-transparent.png
    ├── logo-white-transparent.png
    ├── logo-isologo-primary.png
    └── photo-facade.jpg                ← hero del login
```

---

## Cómo correr el prototipo localmente

```bash
# Cualquier static server, ej.:
npx serve .
# → abrir index.html
```

Los archivos JSX usan Babel standalone (transpilación en navegador). Para producción, migrar a Vite/Next.js + JSX precompilado.

---

## Pasos recomendados de implementación

1. **Setup del codebase** (React + Tailwind + framework de routing)
2. **Importar tokens**: copiar `assets/colors_and_type.css` o convertir a `tailwind.config.js` con la paleta TOPS
3. **Tipografía**: cargar Gotham (`@font-face` desde `assets/fonts/`) o instalar Montserrat de Google Fonts como fallback
4. **Auth**: implementar SSO con Google Workspace + restricción a dominio `@logisticatops.com` + rol "director_ops" para emitir
5. **Estructura de rutas**: las 9 rutas mencionadas + guard de auth
6. **Backend**: Firestore con colecciones `orders`, `vendors`, `products`, `users`; Functions para generación de PDF + envío de email + sync Drive
7. **PDF**: usar `pdf-lib` con plantilla equivalente a `PdfPreview`. Generar QR con `qrcode` apuntando a `https://compras.logisticatops.com/validar/:id`
8. **Drive**: configurar cuenta de servicio + carpeta raíz `Órdenes de Compra 2026/` con subdirectorios `Mes/Proveedor/`
9. **Email**: plantilla HTML basada en `EmailMockup`, enviada con Resend. Destinatarios siempre: proveedor + Ruth + José Luis
10. **Firma**: persistir signatureData como PNG base64 en Firestore + embeber en PDF
11. **Trazabilidad**: cada acción genera un evento en subcolección `orders/{id}/events` con timestamp, usuario, kind, ip
12. **Hash**: SHA-256 sobre `(items, total, providerId, emisor, signedAt)` para detectar alteraciones

---

## Caveats

- El sandbox del prototipo no consulta AFIP de verdad; en producción usar API de AFIP para validar CUIT activo.
- Los SKUs y precios del catálogo son ficticios.
- El número de OC mostrado (`OC-2026-0348`) debe ser generado server-side con secuencia atómica por año.
- El email mockup muestra inline preview; el HTML enviado debe ser table-based para compatibilidad con clientes de email (Gmail/Outlook).
- Mobile-first verificado a 375/414/768/1280px.

---

## Contacto del diseño

Cualquier duda sobre intención visual o comportamiento esperado: revisar el prototipo HTML interactivo abriendo `index.html` y navegando con el panel de Tweaks (botón flotante).
