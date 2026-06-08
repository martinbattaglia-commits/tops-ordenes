# LOGIN_UI_REPLACEMENT_REPORT

**Proyecto:** TOPS NEXUS — Logistics Operating System (Logística TOPS / Verotin S.A.)
**Tarea:** Reemplazo completo de la experiencia visual de login por el nuevo diseño aprobado (Cloud Design).
**Fecha:** 2026-06-07
**Alcance:** Solo capa visual del acceso. **Autenticación, Supabase Auth, middleware, sesiones, RBAC, permisos, RLS y rutas protegidas NO fueron modificados.**
**Estado:** Implementado y auditado en local. **No desplegado. No se tocó producción.**

---

## 0. Resumen ejecutivo

La pantalla de login fue reemplazada por completo. El diseño anterior (panel izquierdo
azul + panel derecho blanco, estética clara) se sustituyó por la nueva dirección visual
**enterprise / mission-critical** del HTML adjunto:

- **FASE 1 · Splash de marca** — anillos animados + logo corporativo + barra de carga.
- **FASE 2 · Login de dos paneles** — panel institucional oscuro (65%) + panel de acceso
  con banner "Torre de operaciones" (35%).

La **lógica de autenticación es idéntica** a la versión previa: el formulario sigue
ejecutando `supabase.auth.signInWithPassword`, magic link (`signInWithOtp`) y la
recuperación de contraseña existente. El usuario no percibe ningún cambio funcional, solo
una mejora radical de experiencia visual.

---

## 1. Componentes modificados

| Archivo | Cambio |
|---|---|
| `src/app/login/page.tsx` | **Reescrito.** Antes construía el layout de dos paneles (azul/blanco) en server markup. Ahora: carga tipografías `Inter` + `JetBrains Mono` vía `next/font/google`, importa el tema scopeado `login-theme.css`, y renderiza `<LoginExperience>` dentro de un contenedor `.tn-login`. Mantiene la lectura de `searchParams` (`from`, `error`) sin cambios. |
| `src/app/login/LoginForm.tsx` | **Reescrito visualmente, lógica de auth intacta.** Conserva exactamente: validación, `signInWithPassword`, magic link (`signInWithOtp` con `emailRedirectTo` a `/api/auth/callback`), chequeos de `env.app.demoMode` y `createClient()` nulo, logs de debug `[TOPS]`, `router.replace(redirectTo ?? "/dashboard")` + `router.refresh()`. Se agregó: máscara visual de campos (estados de error inline), toggle de mostrar/ocultar contraseña, estado "Acceso concedido" antes del redirect, y alertas de error/info con el nuevo estilo. Recuperación de contraseña sigue apuntando a `/auth/forgot-password`. |

> Nota: `src/app/login/actions.ts` (server actions `signIn` / `sendMagicLink` / `signOut`)
> **no se tocó**. Igual que antes, `LoginForm` no lo usa (auth client-side); se deja intacto
> para no alterar superficie de auth.

---

## 2. Componentes nuevos

| Archivo | Propósito |
|---|---|
| `src/app/login/LoginExperience.tsx` | Componente cliente que orquesta la **capa visual**: splash (una vez por sesión, salteable), panel institucional izquierdo (marca, reloj en vivo, hero, KPIs, footer legal), panel derecho (banner + contenedor del formulario). **No contiene lógica de autenticación** — sólo renderiza `<LoginForm>`. |
| `src/app/login/login-theme.css` | Hoja de estilos del nuevo login, **100% scopeada bajo `.tn-login`** con todas las clases prefijadas `tn-` y todos los keyframes `tn-*`. Adaptada del CSS del HTML adjunto. Incluye responsive (1100 / 860 / 560 px) y `prefers-reduced-motion`. |
| `public/icons/login/ops-photo.png` | Fotografía de operaciones (extraída del bundle del diseño). Fondo del panel institucional y del banner. ~204 KB. |
| `public/icons/login/operator.png` | Avatar "operador en línea" del banner (extraído del bundle). ~63 KB. |

**Activos de marca reutilizados (no nuevos):** se usaron los logos corporativos ya
existentes del repo para honrar el requisito *"Mantener logo corporativo actual"*:
- Splash: `public/icons/logo-color-transparent.png`
- Badge (panel institucional): `public/icons/logo-isologo-primary.png`

---

## 3. Componentes eliminados

- **Ninguno a nivel de archivo.** El reemplazo se hizo reescribiendo `page.tsx` y
  `LoginForm.tsx` in-place y agregando los nuevos componentes.
- **Elementos visuales del diseño anterior eliminados:** el layout claro (panel derecho
  blanco), el componente interno `BrandWhite` y `Stat` de `page.tsx`, y la dependencia del
  `<Icon>` interno en el formulario (sustituido por SVGs inline acordes al diseño).
- **Elemento del diseño nuevo deliberadamente NO incluido:** el botón
  *"Continuar con Google Workspace"* y su divisor (decisión confirmada — ver §4).

---

## 4. Decisiones de diseño / producto (confirmadas con el usuario)

| Tema | Decisión | Motivo |
|---|---|---|
| **Botón "Google Workspace"** | **Omitido** (sin botón ni divisor "o continuá con"). | El login actual NO tiene OAuth de Google. Cablearlo implicaría modificar autenticación + configurar el provider en Supabase, fuera del alcance *"No modificar autenticación"*. Incluirlo deshabilitado habría agregado un elemento no funcional. |
| **Splash de marca** | **Una sola vez por sesión** (`sessionStorage`), salteable con click / Enter / Esc, y se omite si `prefers-reduced-motion`. Duración ~3.2 s. | El diseño abría con 5 s bloqueantes en cada carga; en una pantalla de acceso recurrente eso penaliza logins repetidos. Se conserva el momento de marca sin fricción. |
| **Logo** | Se reutiliza el **logo corporativo del repo** en vez del GIF animado de 4.6 MB del bundle. | Requisito explícito *"Mantener logo corporativo actual"* + peso (un GIF de 4.6 MB en el login es inaceptable). |
| **Tipografías** | `Inter` (sans) + `JetBrains Mono` (datos/KPIs/reloj) vía `next/font/google` self-host. | Fidelidad con el diseño; sin layout-shift; mismo patrón que `Montserrat` en el layout raíz. |
| **Dark mode** | El login es **siempre oscuro** (navy corporativo), independiente del toggle de tema de la app. | Es la dirección visual aprobada (estética enterprise/mission-critical). |

---

## 5. Riesgos detectados

| # | Riesgo | Severidad | Mitigación / Estado |
|---|---|---|---|
| R1 | **Bug de splash bajo React StrictMode (dev):** la primera versión seteaba `sessionStorage` antes del timer, y el doble-montaje de StrictMode cancelaba el único timer → splash colgado. | Media (solo dev, pero indicio de fragilidad) | **Resuelto.** Se separó la *decisión* del splash de su *timer* en dos `useEffect`; el timer está keyed en `splashActive`, de modo que StrictMode siempre deja un timer vivo. Verificado: el splash se descarta correctamente. |
| R2 | **Peso del route:** `/login` pasó a 6.57 kB / 159 kB first-load (antes más liviano) por Inter + JetBrains Mono + CSS del tema. | Baja | Fonts self-host con `display:swap`; imágenes optimizables a futuro (WebP). Aceptable para una pantalla de acceso. |
| R3 | **Fuga de estilos:** el CSS del diseño usa clases genéricas (`.btn`, `.field`, `.pill`, `.input`) que **ya existen** globalmente en la app. | Alta (si no se scopeaba) | **Mitigado por diseño.** Todo el tema está bajo `.tn-login` con clases `tn-*` y keyframes `tn-*`. No se tocó `globals.css`. Cero colisión. |
| R4 | **Avatar "operador en línea":** es una foto de stock de persona en el banner. | Baja (estético) | Forma parte del diseño aprobado. Reemplazable por foto institucional real si se desea. |
| R5 | **Ruta de éxito de login no ejercitada en vivo:** sin Supabase configurado en local no se pudo completar un login real exitoso. | Baja | La rama de éxito (`granted` + `router.replace`) se validó por revisión de código y es idéntica a la previa; las ramas de error/validación/magic-link sí se probaron en vivo. Validar login real en staging antes de prod. |
| R6 | **`next/font/google` requiere acceso de red en build.** | Baja | El build local fue exitoso. El layout raíz ya usa `Montserrat` del mismo proveedor, por lo que el entorno de build (Netlify) ya soporta este patrón. |

---

## 6. Capturas comparativas (Antes / Después)

> Las capturas se tomaron del entorno local (`localhost:3030/login`) con el navegador de
> preview. El "Antes" corresponde al login claro de dos paneles (azul/blanco) descripto en
> §1; el "Después" es el render verificado del nuevo diseño.

### ANTES (login previo)
- Panel izquierdo azul `#050555` con foto de fondo + KPIs en blanco.
- Panel derecho **blanco** con formulario claro ("Iniciá sesión", inputs claros, botón rojo).
- Estética corporativa clara.

### DESPUÉS (nuevo login — verificado)
- **Splash:** anillos giratorios + glow + logo corporativo "LOGÍSTICA TOPS" sobre navy
  `#050816`, barra de carga e "Inicializando sistema operativo". (✔ capturado)
- **Desktop (1280px):** dos paneles 65/35. Izquierda: marca + pill "Sistema operativo" +
  reloj en vivo, hero "TOPS NEXUS. OPERACIONES 3PL, SIN IMPROVISACIONES.", KPIs
  (40+ / 15.000 / ANMAT / 24/7), footer Verotin/CUIT/ANMAT-IGJ-3PL. Derecha: banner
  "Torre de operaciones" con avatar "EN LÍNEA", form "Iniciá sesión". (✔ capturado)
- **Tablet (768px):** apilado en columna, reloj visible. (✔ capturado)
- **Mobile (375px):** apilado, KPIs 2×2, reloj oculto, form full-width. (✔ capturado)

El render local es **visualmente equivalente** al HTML adjunto (con las adaptaciones de §4:
logo corporativo del repo, sin botón Google, splash una-vez-por-sesión).

---

## 7. Resultado de pruebas

| Prueba | Método | Resultado |
|---|---|---|
| **Typecheck** | `tsc --noEmit` | ✅ Sin errores |
| **Lint** | `next lint --dir src/app/login` | ✅ Sin warnings ni errores |
| **Build de producción** | `next build` | ✅ `Compiled successfully`; `/login` 6.57 kB / 159 kB; sigue siendo `ƒ` (dynamic por `searchParams`) |
| **Login incorrecto (validación)** | Submit con campos vacíos | ✅ Bordes rojos + "Ingresá un email válido." / "Ingresá tu contraseña." |
| **Login incorrecto (auth)** | Submit con credenciales sobre entorno sin Supabase | ✅ Alerta roja "Supabase no está configurado…" (misma rama de error que la versión previa) |
| **Login correcto** | Revisión de código (sin Supabase local para E2E) | ✅ Rama `signInWithPassword` → sesión → `granted` → `router.replace(redirectTo ?? "/dashboard")` idéntica a la previa. *(Validar E2E en staging.)* |
| **Magic link** | Handler `handleMagic` | ✅ Valida email, llama `signInWithOtp`, muestra info de envío (lógica intacta) |
| **Recuperar contraseña** | Link | ✅ Apunta a `/auth/forgot-password` (flujo existente) |
| **Mostrar/ocultar contraseña** | Toggle del ojo | ✅ Alterna `type` password/text e ícono |
| **Responsive** | Desktop / Tablet / Mobile | ✅ Las tres vistas correctas (ver §6) |
| **Dark mode** | Diseño siempre oscuro | ✅ Navy corporativo constante; sin dependencia del toggle de tema |
| **Animaciones** | Splash, reveal escalonado, anillos, shimmer del botón, pulsos | ✅ Presentes; respetan `prefers-reduced-motion` |
| **Consola** | Errores en carga limpia | ✅ Sin error overlay; sin errores en carga real (los errores observados eran artefactos de Hot-Module-Reload durante la edición) |
| **Aislamiento de estilos** | Scope `.tn-login` | ✅ Sin colisión con `.btn/.field/.pill/.input` globales; `globals.css` intacto |

---

## 8. Verificación de NO-alcance (lo que NO se tocó)

- ❌ Autenticación / `supabase.auth.*` → **intacta** (mismas llamadas, mismos parámetros).
- ❌ Supabase Auth / `src/lib/supabase/*` → **sin cambios**.
- ❌ Middleware (`src/middleware`) → **sin cambios**.
- ❌ Sesiones / cookies (`@supabase/ssr`) → **sin cambios**.
- ❌ RBAC / permisos / roles (`src/lib/rbac`, `src/lib/auth/roles.ts`) → **sin cambios**.
- ❌ Rutas protegidas / redirects / `/api/auth/callback` → **sin cambios**.
- ❌ Base de datos / RLS → **sin cambios**.
- ❌ Producción / deploy → **no se desplegó nada**.

---

## 9. Archivos tocados (diff lógico)

```
Reescritos:
  src/app/login/page.tsx
  src/app/login/LoginForm.tsx        (solo capa visual; auth idéntica)

Nuevos:
  src/app/login/LoginExperience.tsx
  src/app/login/login-theme.css
  public/icons/login/ops-photo.png
  public/icons/login/operator.png

Sin cambios (auth / no-alcance):
  src/app/login/actions.ts
  src/lib/supabase/*, src/middleware, src/lib/rbac/*, src/lib/auth/roles.ts
  src/app/api/auth/*, src/app/auth/forgot-password, src/app/auth/reset-password
  src/app/globals.css, src/app/layout.tsx
```

---

## 10. Recomendaciones (post-merge, fuera de esta tarea)

1. **Validar login real E2E en staging** (Supabase configurado) para cubrir R5.
2. **Optimizar imágenes** del login a WebP/AVIF para bajar el first-load (R2).
3. Evaluar reemplazar el **avatar de stock** por una foto institucional real (R4).
4. Si en el futuro se aprueba **Google Workspace SSO**, reactivar el botón del diseño
   cableando `signInWithOAuth({ provider: 'google' })` + provider en Supabase (cambio de
   autenticación → fuera de esta tarea).

---

*Generado como entregable de la tarea de modernización de UI de login. No se realizó deploy
ni cambios fuera del alcance del login.*
