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

### 1 · Crear el proyecto

1. [app.supabase.com](https://app.supabase.com) → **New project**
   - Name: `tops-ordenes-prod`
   - Region: **South America (São Paulo)** (latencia ~20 ms a BsAs)
   - Plan: Free (alcanza para arrancar)
2. Esperar ~2 min al provisioning.
3. **Settings → API** → copiar a `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL       = https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY  = eyJhbGc...
   SUPABASE_SERVICE_ROLE_KEY      = eyJhbGc...   ← jamás exponer al cliente
   ```

### 2 · Aplicar las 4 migraciones

**Opción A — Supabase CLI (recomendado):**
```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref <YOUR_REF>
./scripts/setup-supabase.sh
```

**Opción B — Manual:** copiar y pegar en orden cada archivo de
`supabase/migrations/` en el **SQL Editor** del dashboard:

| Migración | Crea |
| --- | --- |
| `0001_init.sql` | Enums, tablas (profiles, clients, operators, services_catalog, orders, order_services, email_sends, audit_log), índices, RLS por rol, trigger handle_new_user |
| `0002_seed.sql` | Catálogo de 13 servicios + 4 operadores |
| `0003_storage.sql` | Buckets `signatures`, `pdfs`, `attachments` con policies |
| `0004_extended_schema.sql` | `notifications` + `attachments` tables, columnas adicionales, triggers de notification y updated_at, **realtime publication**, vista `v_orders_dashboard` |

### 3 · Crear el primer admin

1. **Authentication → Users → Add user** con email corporativo y password fuerte.
2. En el **SQL Editor**:
   ```sql
   update public.profiles set role = 'admin', active = true
   where email = 'tu-email@logisticatops.com';
   ```
3. Loguearse en la app → el usuario ya tiene permisos full. Desde
   `/settings/users` puede invitar al resto del equipo (cada uno recibe
   email con magic link para definir su propia contraseña).

### 4 · (Opcional) Personalizar emails de Supabase

**Authentication → Email Templates** — editar las plantillas de:
- Invite user
- Magic Link
- Reset Password
- Confirm signup

Aplicar la paleta TOPS (`#050555` / `#C90812`) para que el branding sea consistente.

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

## Realtime

La app suscribe a la tabla `orders` y `notifications` vía Supabase Realtime
(habilitado en `0004_extended_schema.sql`):

- **`<RealtimeRefresher />`** en `/dashboard` y `/orders` ejecuta
  `router.refresh()` cuando cambia cualquier orden → KPIs y listados se
  actualizan sin recargar.
- **`<NotificationsBell />`** en el topbar muestra el badge con unread
  count y abre un popover con las últimas 15 notificaciones. Cada cambio
  de estado de orden dispara un trigger PostgreSQL que inserta una
  notification, que llega al cliente vía WebSocket.

Para sumar más tablas a realtime:
```sql
alter publication supabase_realtime add table public.<tabla>;
```

## Rate limiting

`src/lib/rate-limit.ts` — bucket in-memory por IP/userId.

| Acción | Límite | Ventana |
| --- | --- | --- |
| `createOrder` | 10 | 1 minuto |
| `sendPasswordResetLink` | 5 | 1 hora |
| `inviteUser` | 20 | 1 hora |

> Para escala multi-instancia (Netlify Functions horizontales) cambiar a un
> backend centralizado (Upstash Ratelimit / Redis). El in-memory cubre el
> escenario actual ANNUAL y abuso casual.

## Auditoría

Tabla `audit_log` registra acciones críticas con `user_id`, `entity`,
`action`, `payload`, `ip`, `ts`. Eventos cubiertos:

- `create_signed` — alta de orden firmada
- `invite` — invitación de usuario
- `export_csv` — descarga del CSV de órdenes
- (extensible para futuros eventos)

Solo `admin` y `supervisor` pueden leerla (policy en `0001_init.sql`).

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
