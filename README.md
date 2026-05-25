# TOPS Órdenes

Sistema digital de órdenes de servicio operativas para **Logística TOPS (Verotin S.A.)**.
Reemplaza el formulario manual en papel: generación, firma, envío y centralización de cada
orden de servicio (autoelevador, transporte, peón, picking, distribución, ANMAT, etc.) desde
cualquier celular, tablet o desktop — con auditoría, PDF profesional y reglas de envío
automáticas.

> Operación 3PL · 40+ años · Depósitos Magaldi (CABA) y Luján (BsAs).

---

## Stack

| Capa | Tecnología |
| --- | --- |
| Framework | Next.js 14 (App Router) + React 18 |
| Lenguaje | TypeScript estricto |
| Estilos | Tailwind CSS 3 + tokens del manual de identidad TOPS |
| Backend / DB | Supabase (Postgres + Auth + Storage + RLS) |
| Email | Resend (HTML transaccional) |
| PDF | `@react-pdf/renderer` server-side |
| QR | `qrcode` (server) + SVG inline (preview) |
| Forms | React Hook Form patterns + validación con Zod-friendly utils |
| PWA | manifest + service worker (mobile-first, instalable iOS/Android) |
| Hosting | Netlify con `@netlify/plugin-nextjs` |

---

## Quick start (local)

```bash
# 1. instalar dependencias
npm install

# 2. configurar entorno (opcional para demo mode)
cp .env.example .env.local
# editá .env.local y completá las claves de Supabase si las tenés

# 3. correr en dev
npm run dev
# → abre http://localhost:3000
```

> **Demo mode:** si no configurás Supabase, la app arranca con datos mock en memoria
> (48 órdenes, 7 clientes, 4 operadores, catálogo completo). Sirve para evaluar
> la UI sin tocar la base. Para activar producción real, completá las env vars y
> aplicá las migraciones SQL.

---

## Configurar Supabase (producción)

1. Crear un proyecto en [supabase.com](https://supabase.com).
2. Desde **Settings → API** copiar las claves a `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (sólo backend, NO exponer)
3. Aplicar las migraciones del directorio `supabase/migrations/`:
   - Opción A (CLI): `supabase db push`
   - Opción B (UI): copiar y pegar cada `.sql` en el **SQL Editor** del dashboard, en orden.
4. Crear el primer usuario admin desde **Authentication → Add user**, luego en la
   tabla `profiles` cambiar su `role` a `admin`.
5. (Opcional) Configurar **Email templates** propios en Supabase para los
   magic links y confirmaciones, usando la paleta corporativa.

### Storage

Las migraciones crean 3 buckets automáticamente:

| Bucket | Visibilidad | Para qué |
| --- | --- | --- |
| `signatures` | público (URL) | PNG de cada firma + hash SHA-256 |
| `pdfs` | público (URL) | PDFs generados servidor-side |
| `attachments` | privado (auth) | Fotos / remitos / anexos del operario |

---

## Configurar Resend (emails)

1. Crear cuenta en [resend.com](https://resend.com).
2. Verificar el dominio `logisticatops.com` (DNS records).
3. Generar API key → poner en `RESEND_API_KEY`.
4. Ajustar `RESEND_FROM_EMAIL` con un remitente del dominio verificado.

> Sin `RESEND_API_KEY` la app sigue funcionando: marca los emails como
> *skipped* en lugar de fallar, ideal para staging.

---

## Reglas de envío automático

Definidas en [`src/lib/email.ts`](src/lib/email.ts), basadas en el handoff:

- **Siempre:** `ruth@logisticatops.com` + `joseluis@logisticatops.com`
- **Magaldi:** + `juancarlos@logisticatops.com`
- **Luján:** + `despachos@logisticatops.com`
- **Cliente:** + email registrado en su ficha

Las direcciones son overrideables vía env vars (`EMAIL_DEPOT_MAGALDI`, etc.) sin
tocar código.

---

## Deploy en Netlify

1. **New site → Import from Git** apuntando al repo.
2. Build command: `npm run build` · Publish directory: `.next` (lo gestiona el plugin).
3. **Environment variables** (Site settings → Environment): copiar todas las de
   `.env.example` con los valores reales.
4. Asegurarse de que el plugin `@netlify/plugin-nextjs` aparezca en
   `Plugins → Installed` (se instala solo al detectar Next).
5. **Custom domain:** apuntar `ordenes.logisticatops.com` al sitio.
6. Forzar HTTPS y HSTS desde Netlify (ya está habilitado en `netlify.toml`).

El archivo [`netlify.toml`](netlify.toml) ya tiene:

- Headers de seguridad (HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy).
- Cache-Control correcto para `sw.js` (no-cache) y `manifest.webmanifest`.
- Long-cache para assets de `/icons`.

---

## Estructura del proyecto

```
src/
├── app/                          # Next App Router
│   ├── (app)/                    # Rutas autenticadas (envueltas en Shell)
│   │   ├── dashboard/            # KPIs, gráfico depósitos, mix servicios
│   │   ├── orders/               # Lista + filtros + paginación
│   │   │   ├── [publicId]/       # Detalle + PdfPreview + share
│   │   │   └── new/              # Wizard 4 pasos + firma canvas
│   │   ├── clients/              # Maestro de clientes
│   │   ├── reports/              # KPIs ejecutivos
│   │   ├── billing/              # Cierre mensual a facturar
│   │   ├── templates/            # Vista previa email
│   │   └── settings/             # Estado de integraciones
│   ├── api/
│   │   ├── auth/                 # callback OAuth + signout
│   │   └── orders/
│   │       ├── [publicId]/pdf/   # PDF server-side
│   │       └── export/           # CSV export
│   ├── login/                    # Pantalla de acceso
│   ├── layout.tsx                # Root layout + PWA bootstrap
│   └── globals.css               # Tokens TOPS + Tailwind
├── components/
│   ├── Icon.tsx                  # 40+ SVG inline (Lucide-style)
│   ├── StatusBadge.tsx
│   ├── charts/                   # Sparkline, DepotChart, ServiceMixDonut
│   └── shell/                    # Sidebar, Topbar, MobileBottomNav, Drawer
├── lib/
│   ├── data/orders.ts            # Data access (Supabase ↔ mock fallback)
│   ├── pdf/OrderPdfDocument.tsx  # Plantilla react-pdf
│   ├── supabase/                 # client + server + middleware
│   ├── email.ts                  # Reglas destinatarios + Resend
│   ├── env.ts                    # Lectura tipada de env vars
│   ├── mock-data.ts              # Demo mode
│   ├── services-catalog.ts       # Tarifario fallback
│   ├── types.ts
│   └── utils.ts                  # fmtCurrency, sha256, isValidCuit, …
├── middleware.ts                 # Refresh de sesión + redirect a /login
supabase/migrations/              # SQL versionado (init, seed, storage)
public/
├── fonts/Gotham-*.otf            # Fuente corporativa
├── icons/                        # Logos + iconos PWA
├── manifest.webmanifest          # PWA
└── sw.js                         # Service worker (offline-friendly)
```

---

## Mobile-first / PWA

- **Instalable** en iOS y Android (manifest + iconos + apple-touch-icon).
- **Inputs ≥16 px en mobile** para evitar el zoom automático de Safari iOS.
- **Safe-area-inset** respetado en sidebar, topbar y bottom nav.
- **Bottom nav** con FAB rojo para “Nueva orden” siempre a un tap.
- **touch-action: none** en el canvas de firma para que el scroll no
  interfiera con el trazo.
- **Service worker** cachea assets estáticos y deja navegables las páginas
  de dashboard/órdenes aún en redes pobres.
- **Performance:** Sin librerías pesadas. Gráficos son SVG inline. PDF se
  genera on-demand server-side (no bundle bloat).

---

## Seguridad y compliance

- **RLS** activado en todas las tablas: clientes externos sólo ven sus
  propias órdenes; staff interno separa permisos por rol (`admin`,
  `operaciones`, `supervisor`, `cliente`).
- **Audit log** append-only de cada `create/update` de orden con `user_id`,
  `ip`, `payload`.
- **Hash SHA-256** de la firma al persistir, para garantizar integridad.
- **Trazabilidad GPS + IP + timestamp** se embebe en el PDF firmado.
- Headers de seguridad: HSTS, X-Frame-Options DENY, Referrer-Policy,
  Permissions-Policy mínima.
- **Service role key** sólo se usa en server actions / route handlers —
  jamás expuesta al cliente.

---

## Scripts

```bash
npm run dev          # dev server (port 3000)
npm run build        # production build
npm run start        # production server
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
```

---

## Roadmap inmediato

- [ ] Integración con AFIP padrón para auto-validar CUIT en alta de cliente.
- [ ] Notificaciones push (Web Push) cuando una orden necesita firma.
- [ ] App nativa wrapper (Capacitor) para distribuir en App Store / Play Store.
- [ ] Integración Clientify para sincronizar maestro de clientes y deals.
- [ ] Dashboard avanzado (cohorts, retención de cliente, margen por servicio).

---

## Soporte

- **Desarrollo:** Martín Battaglia · martin.battaglia@logisticatops.com
- **Operaciones:** Ruth Cardozo · ruth@logisticatops.com

© 2026 Logística TOPS — Verotin S.A. Todos los derechos reservados.
