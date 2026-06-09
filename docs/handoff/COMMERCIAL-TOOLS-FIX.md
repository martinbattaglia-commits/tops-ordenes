# COMMERCIAL-TOOLS-FIX — TOPS NEXUS

**Fecha:** 2026-06-08 · Fix aplicado: herramientas comerciales en blanco en prod.
**Cambio único, config-only.** No toca código, CRM360, Compliance, RRHH, Drive, Digital Twin.

---

## Cambio aplicado
`netlify.toml`, bloque `[[headers]] for = "/*"`:
```diff
-    X-Frame-Options = "DENY"
+    X-Frame-Options = "SAMEORIGIN"
```
**Es la única línea modificada.** El resto de `netlify.toml` (build command, Node 22, heap, plugin, headers de sw.js/manifest/icons, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS) queda **idéntico**.

## Por qué resuelve el bug
- Las herramientas se embeben con `<iframe src="/tools/<slug>/index.html">` (same-origin).
- `DENY` ordenaba al browser no renderizar el recurso en **ningún** frame → iframe en blanco en prod.
- `SAMEORIGIN` **permite** el framing del **mismo origen** (las herramientas dentro de la app) y **sigue bloqueando** que un sitio externo enmarque la app (anti-clickjacking).
- Queda alineado con `next.config` (que ya declaraba `SAMEORIGIN` a propósito) → elimina el conflicto DENY↔SAMEORIGIN.

## Alcance del fix
Resuelve en prod (tras redeploy):
- `/comercial/herramientas/cotizador` (Cotizador Logístico TOPS)
- `/comercial/herramientas/propuesta-anmat` (Propuesta Comercial ANMAT)
- `/comercial/herramientas/propuesta-general` (Propuesta Comercial Cargas Generales)
- Pestaña **Contrato** de la Ficha 360° (mismo root cause; templates `contrato-anmat` / `aceptacion-condiciones`)

## Seguridad
- `SAMEORIGIN` mantiene la protección anti-clickjacking contra orígenes externos.
- Sin CSP `frame-ancestors` involucrada (no se agregó ni quitó CSP).
- No se desactiva ningún otro header de seguridad.

## Despliegue
1. Commit (netlify.toml + docs de herramientas).
2. Push a `main` (FF desde `3b12c26`).
3. Redeploy automático de Netlify.
4. Validación → `COMMERCIAL-TOOLS-VALIDATION.md`.

## Verificación de que es el único cambio
`git diff netlify.toml` → 1 línea (DENY→SAMEORIGIN). `git diff --name-only` (trackeados) → solo `netlify.toml`.
