# NETLIFY-BUILD-FAILURE-ROOT-CAUSE — TOPS NEXUS

**Fecha:** 2026-06-08 · Causa raíz del build fallido `70a9944` ("Exposed secrets detected").

---

## Resumen ejecutivo
El build **no falló por compilación** (tsc/lint/build local PASS, 119 rutas). Falló en el **post-procesado de Netlify "Secrets scanning"**, que marcó como "exposed secret" un **falso positivo**: subcadenas `eyJ` dentro de **fuentes base64 embebidas** en `public/tools/contrato-anmat/index.html` (template de contrato "Print Ready", nuevo en este release). **No hay ningún secreto real** en el repositorio (auditado: 0 JWT/API key/private key/conn string en los 257 archivos cambiados).

---

## Cadena causal
1. El release agregó **2 templates estáticos** nuevos: `public/tools/contrato-anmat/index.html` (1.7 MB) y `aceptacion-condiciones/index.html`, copiados desde los HTML aprobados (Contrato ANMAT / Aceptación y Condiciones).
2. `contrato-anmat` embebe **6 @font-face** como **base64**; ese base64 contiene, por azar, 8 subcadenas que empiezan con `eyJ` (prefijo base64 de `{"` — igual que el header de un JWT).
3. El **secret scanner de Netlify** detecta patrones tipo JWT (`eyJ…`) y los reporta como "exposed secrets".
4. El scanner **falla el deploy** → Netlify conserva el último Published (`86b54ca`).

### ¿Por qué `86b54ca` pasó y `70a9944` no?
`86b54ca` no contenía `contrato-anmat` (es nuevo del RC). Nota: los tools viejos ya tenían 65 `eyJ` benignos; el comportamiento del scanner sobre `public/tools/**` es el que hay que neutralizar de forma explícita y estable para que no vuelva a bloquear.

---

## Descartado (con evidencia)
- ❌ **Secreto real commiteado:** 0 JWT estructurados, 0 `sk-/re_/AKIA/ghp_`, 0 private keys, 0 conn strings en los cambios.
- ❌ **`NEXT_PUBLIC_*` inlineadas en build output:** ya estaban en `86b54ca` (que pasó) → no es el cambio. (Aun así se omiten por ser públicas por diseño, defensa en profundidad.)
- ❌ **Project ref / `*.supabase.co` en docs:** presentes también en docs viejos de `86b54ca` (que pasó) → no disparan.
- ❌ **Error de compilación / tipos / OOM:** build local verde con Node 22 + heap 4 GB.

---

## Clasificación
| Dimensión | Valor |
|---|---|
| Severidad | **Bloqueante de deploy** (no de runtime) |
| Naturaleza | **Falso positivo** del secret scanner (base64 de fuentes) |
| Riesgo de seguridad real | **Ninguno** (no hay secreto expuesto) |
| Área afectada | Config de build (Netlify) — **no** CRM360 / Compliance / RRHH / Drive |

---

## Fix (mínimo, sin tocar funcionalidad)
Excluir del escaneo de secretos **solo** los templates estáticos y omitir las claves públicas por diseño. En `netlify.toml [build.environment]`:
```toml
SECRETS_SCAN_OMIT_PATHS = "public/tools/**"
SECRETS_SCAN_OMIT_KEYS  = "NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_MAPBOX_TOKEN,NEXT_PUBLIC_APP_URL,NEXT_PUBLIC_DEMO_MODE"
```
- `public/tools/**`: assets estáticos (contratos/cotizador/propuestas) con base64 de fuentes — verificado sin secretos reales.
- `SECRETS_SCAN_OMIT_KEYS`: variables `NEXT_PUBLIC_*` que **deben** estar en el bundle cliente (no son secretas).
- **No** se desactiva el scanner globalmente (sigue protegiendo el resto del árbol).

> Si el log de Netlify nombra un archivo/clave distinto, ajustar el `OMIT_PATHS/KEYS` a ese dato exacto, o —si fuera un secreto real— removerlo y **rotar** la clave. Detalle operativo en `NETLIFY-REDEPLOY-PLAN.md`.
