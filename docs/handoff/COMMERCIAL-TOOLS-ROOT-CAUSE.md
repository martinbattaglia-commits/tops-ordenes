# COMMERCIAL-TOOLS-ROOT-CAUSE — TOPS NEXUS

**Fecha:** 2026-06-08 · Causa raíz: herramientas comerciales en blanco en prod.

---

## Qué está roto
El render del **iframe same-origin** de las herramientas (`/tools/<slug>/index.html`) dentro de `/comercial/herramientas/<slug>`.

## Dónde está roto
**Configuración de headers de deploy**, NO el código de la app ni los HTML:
- `netlify.toml` → `[[headers]] for = "/*"` → `X-Frame-Options = "DENY"`.

## Por qué está roto
1. La app embebe las herramientas con `<iframe src="/tools/<slug>/index.html">` (same-origin).
2. `next.config` setea **`X-Frame-Options: SAMEORIGIN`** a propósito (comentado: permitir embeber las herramientas internas) → el framing same-origin debería estar permitido.
3. Pero `netlify.toml` setea **`X-Frame-Options: DENY`** para `/*`. En producción, los **estáticos `/tools/*`** (servidos por el CDN de Netlify) reciben ese `DENY` (y/o un duplicado DENY+SAMEORIGIN en conflicto).
4. `DENY` = el browser **rehúsa renderizar el recurso en cualquier frame**, incluso same-origin → el iframe queda **en blanco** (con error en consola: *"Refused to display … X-Frame-Options: deny"*).
5. En **local** (`next dev`) **no se aplica `netlify.toml`** → solo rige el `SAMEORIGIN` de `next.config` → las herramientas **renderizan**. De ahí la diferencia local↔prod.

## Diagnóstico
Es un **conflicto de configuración** entre dos fuentes de `X-Frame-Options`:
| Fuente | Valor | Intención |
|---|---|---|
| `next.config` headers() | `SAMEORIGIN` | correcta (permite las herramientas, bloquea framing externo) |
| `netlify.toml` `for="/*"` | `DENY` | **demasiado restrictiva**; rompe el embebido same-origin en estáticos |

El `DENY` de `netlify.toml` **anula la intención** del `SAMEORIGIN` de `next.config` para los archivos estáticos del CDN.

## Evidencia (resumen, detalle en AUDIT)
- Archivos presentes y en el deploy (`origin/main` 3b12c26). ✅
- iframe `src` correcto. ✅
- Status 200 con sesión (307 solo sin sesión, por middleware). ✅ — no es 404/403.
- `next.config` = SAMEORIGIN; `netlify.toml` = DENY (conflicto). ✅
- Prod `/login` (SSR) devuelve `SAMEORIGIN`; estáticos `/tools/*` reciben el `DENY` de netlify.toml. 
- Local renderiza; prod no → única diferencia: `netlify.toml`.

## Clasificación
- **Severidad:** Importante (funcionalidad comercial visible rota en prod). No afecta datos ni otros módulos.
- **Naturaleza:** Regresión de **configuración de seguridad** (header demasiado estricto), no bug de lógica.
- **Alcance:** las 3 herramientas + (mismo root cause) la pestaña Contrato de la Ficha 360°. CRM360/Compliance/RRHH/Drive (datos) no afectados.
