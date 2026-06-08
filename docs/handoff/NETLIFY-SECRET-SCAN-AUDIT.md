# NETLIFY-SECRET-SCAN-AUDIT — TOPS NEXUS

**Fecha:** 2026-06-08 · Auditoría del escaneo de secretos del build fallido.
**Build fallido:** `70a9944` · **Published estable:** `86b54ca` · **Motivo Netlify:** "Exposed secrets detected".
**Sin imprimir valores de secretos.** Evidencia por archivo y patrón.

---

## Método
Como `86b54ca` **pasó** el escaneo y `70a9944` = `86b54ca` + trabajo del RC, el disparador está en lo **nuevo** del RC. Se escaneó el árbol trackeado con `git grep` y los **257 archivos cambiados** vs `86b54ca` buscando formatos de secreto reales, redactando todo valor.

## Resultados del escaneo

| Patrón | Coincidencias | ¿Nuevo vs 86b54ca? | Veredicto |
|---|---|---|---|
| JWT real (`eyJ.eyJ.firma`, estructura a.b.c) | **0** en todo el repo | — | sin secretos JWT |
| `sk-…` / `re_…` / `AKIA…` / `ghp_…` / `xox…` | **0** en cambios | — | sin API keys |
| `BEGIN … PRIVATE KEY` | solo en 2 docs **viejos** (ARCA, DRIVE plan) — ya en 86b54ca | NO | no es el disparador |
| `postgres://…:…@` (conn string con pass) | **0** | — | sin conn strings |
| `service_role` (palabra) | solo en docs **viejos** (ERP, DRIVE, E2E) — ya en 86b54ca | NO | palabra, no valor |
| Project ref `arsksytgdnzukbmfgkju` / `*.supabase.co` | en docs **viejos y nuevos** | parcial | no dispara (86b54ca pasó con ellos) |
| `eyJ` (subcadena base64, **sin** estructura JWT) | tools HTML | contrato-anmat = **NUEVO** | **candidato — falso positivo** |

## Hallazgo central: `public/tools/contrato-anmat/index.html`
- Único archivo **nuevo** (vs 86b54ca) que matchea un patrón "tipo secreto": **8 ocurrencias de `eyJ`**.
- **Son subcadenas dentro de blobs base64** (precedidas por 40+ chars base64), del set de **6 @font-face / 12 refs woff** embebidas en el HTML "Print Ready" (1.7 MB).
- **0 estructura JWT** (`a.b.c`) → **no son tokens**. No coinciden con ningún valor de env (son fragmentos de fuentes).

## Prueba de que `eyJ`-en-tools es benigno (no es lo que falla por env-matching)
Los tools **viejos** (en `86b54ca`, que **pasó**) ya contienen muchísimos `eyJ` sin estructura JWT:
| Tool (viejo, pasó) | `eyJ` total | JWT estructurados |
|---|---|---|
| cotizador | 18 | 0 |
| propuesta-anmat | 39 | 0 |
| propuesta-general | 8 | 0 |
→ 65 `eyJ` benignos ya estaban desplegados sin fallar. `contrato-anmat` (8 `eyJ`, 0 JWT) es **el mismo patrón benigno**.

## Conclusión del scan
- **No hay ningún secreto real** (JWT/API key/private key/conn string) en el código, docs, migraciones ni scripts del RC. Los scripts usan solo `process.env` (sin literales).
- El **único** match nuevo es base64 de fuentes en `public/tools/contrato-anmat/index.html` → **falso positivo**.
- Causa raíz y fix → `NETLIFY-BUILD-FAILURE-ROOT-CAUSE.md` / `NETLIFY-REDEPLOY-PLAN.md`.

> **Para confirmación EXACTA:** el log de Netlify (sección "Secrets scanning") nombra el archivo y la clave detectada. Si nombra `public/tools/**` → este audit lo cubre. Si nombra otro archivo/clave → ajustar el fix según ese dato (ver redeploy plan).
