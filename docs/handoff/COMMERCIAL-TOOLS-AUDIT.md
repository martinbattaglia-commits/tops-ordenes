# COMMERCIAL-TOOLS-AUDIT — TOPS NEXUS

**Fecha:** 2026-06-08 · Auditoría: Herramientas comerciales en blanco en producción (`main@3b12c26`).
**Sin corregir nada.** Evidencia por archivo. Afecta: Cotizador, Propuesta ANMAT, Propuesta Cargas Generales.

---

## 1. Cómo se cargan (código)
- Páginas: `/comercial/herramientas/{cotizador,propuesta-anmat,propuesta-general}/page.tsx` → renderizan `<ToolEmbed slug=... />`.
- `src/app/(app)/comercial/herramientas/_components/ToolEmbed.tsx`:
  ```tsx
  const src = `/tools/${slug}/index.html`;
  <iframe src={src} ... />        // iframe SAME-ORIGIN dentro del shell Nexus
  ```
- Es un **iframe same-origin** que apunta a un HTML estático autocontenido en `public/tools/<slug>/index.html`.

## 2. ¿Existen los archivos? (working tree)
| Tool | Ruta | Existe | Tamaño |
|---|---|---|---|
| Cotizador | `public/tools/cotizador/index.html` | ✅ | 1.93 MB |
| Propuesta ANMAT | `public/tools/propuesta-anmat/index.html` | ✅ | 2.51 MB |
| Propuesta Cargas Generales | `public/tools/propuesta-general/index.html` | ✅ | 1.76 MB |

## 3. ¿iframe apunta al archivo correcto?
✅ Sí. `src = /tools/<slug>/index.html` coincide exactamente con la ruta del archivo. slug correcto por tool (cotizador / propuesta-anmat / propuesta-general).

## 4. Status HTTP de la URL final (prod)
| URL | Sin sesión (curl/fetch) | Con sesión (browser) |
|---|---|---|
| `/tools/cotizador/index.html` | **307 → /login** (middleware auth) | 200 (archivo servido) |
| (idem ANMAT / general) | 307 → /login | 200 |
- El **307 sin sesión** es por el middleware (el matcher protege `/tools/*`, no lo excluye). **No es 404 ni 403.** El archivo se sirve (200) cuando hay sesión, que es el caso del iframe en la app logueada.
- **El blanco NO es por status** (el HTML se entrega 200), es por el **header de framing** (ver §5).

## 5. Headers / restricciones de framing — EL PUNTO CLAVE
Hay **dos fuentes contradictorias** de `X-Frame-Options`:
| Fuente | Valor | Aplica a |
|---|---|---|
| `next.config.* headers()` source `/(.*)` | **`SAMEORIGIN`** (intencional, comentado para permitir las herramientas) | respuestas servidas por Next (SSR) |
| `netlify.toml [[headers]] for="/*"` | **`DENY`** | respuestas servidas por Netlify CDN (estáticos `/tools/*`) |

**Evidencia observada en prod (`fetch`, headers):**
```
GET /login   → 200 · x-frame-options: SAMEORIGIN   (SSR → gana next.config)
GET /tools/cotizador/index.html → 307 (sin sesión; no se pudo leer el header del 200 estático sin auth)
```
- `DENY` ordena al browser **no renderizar el recurso en NINGÚN iframe** (ni same-origin).
- Sin CSP `frame-ancestors` en juego (no hay CSP definida); el bloqueante es `X-Frame-Options`.

## 6. ¿El deploy 3b12c26 excluyó los archivos?
❌ **No.** `git ls-tree -r origin/main public/tools/` lista los 5 HTML (cotizador, propuesta-anmat, propuesta-general, contrato-anmat, aceptacion-condiciones). Están en el deploy.

## 7. Local vs Producción
| | Local (`next dev`) | Producción (Netlify) |
|---|---|---|
| Aplica `next.config` headers | ✅ SAMEORIGIN | ✅ en SSR |
| Aplica `netlify.toml` headers | ❌ (dev ignora netlify.toml) | ✅ **DENY** en estáticos `/tools/*` |
| Resultado del iframe | ✅ renderiza | ❌ **en blanco** |
→ La única diferencia relevante es el `X-Frame-Options: DENY` de `netlify.toml`, ausente en local.

---

## Evidencia que confirma definitivamente (capturable por vos en el browser logueado)
En `/comercial/herramientas/cotizador` (prod), DevTools:
- **Console:** mensaje tipo `Refused to display 'https://tops-ordenes.netlify.app/tools/cotizador/index.html' in a frame because it set 'X-Frame-Options' to 'deny'` (o "multiple/conflicting X-Frame-Options").
- **Network:** request a `/tools/cotizador/index.html` → status **200**, Response Header `X-Frame-Options: DENY` (o DENY+SAMEORIGIN).
> El asistente no pudo leer ese header del 200 por estar tras auth (sin sesión da 307). El resto de la cadena (archivos, iframe, deploy, conflicto de config, local vs prod) está probado arriba.

## Síntesis
Archivos OK · iframe OK · deploy OK · status 200 (con sesión). **El contenido queda en blanco porque `netlify.toml` aplica `X-Frame-Options: DENY` a `/*` (incluye los estáticos `/tools/*`), contradiciendo el `SAMEORIGIN` intencional de `next.config`.** Causa raíz → `COMMERCIAL-TOOLS-ROOT-CAUSE.md`.

> **Nota:** el mismo header afecta cualquier otro iframe same-origin a estáticos en prod — incluida la pestaña **Contrato** de la Ficha 360° (templates `contrato-anmat` / `aceptacion-condiciones`). El fix los cubre a todos.
