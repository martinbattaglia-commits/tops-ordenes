# PRE-DEPLOY ENVIRONMENT CHECKLIST — TOPS NEXUS

**Fecha:** 2026-06-07
**Regla:** Todos los ítems marcados **PASS obligatorio** deben estar en PASS **antes** de cualquier deploy. Un solo FAIL = **NO DEPLOY**.
**No mostrar secretos:** validar solo presencia (nombres), nunca valores.

---

## 0. Gate automático

```bash
npm run env:check        # debe terminar en RESULT: PASS (exit 0)
```
Si `env:check` devuelve FAIL → **detener**. No avanzar al deploy.

En CI/Netlify, `env:check` lee `process.env` (variables del panel del proyecto), no solo `.env.local`.

---

## 1. Integraciones — PASS obligatorio

| Integración | Variable(s) de gating | Estado |
|-------------|------------------------|:------:|
| **Clientify** | `CLIENTIFY_API_KEY` (+ `CLIENTIFY_BASE_URL`) | ☐ PASS |
| **Tracking**  | `NEXT_PUBLIC_MAPBOX_TOKEN` (+ `TRACKING_INGEST_TOKEN`) | ☐ PASS |
| **CCTV**      | `HIKVISION_HOST`, `HIKVISION_USER`, `HIKVISION_PASSWORD` | ☐ PASS |
| **Supabase**  | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | ☐ PASS |
| **OCR**       | `OPENAI_API_KEY` (+ `OPENAI_OCR_MODEL`) | ☐ PASS |

> Estas 5 son el alcance obligatorio aprobado. Resultado actual local (`main`): **las 5 PASS**.

---

## 2. Runtime / política

| Check | Cómo | Estado |
|---|---|:--:|
| Server corre desde `main` | `lsof -nP -iTCP:3030 -sTCP:LISTEN` → cwd = `…/tops-ordenes` | ☐ PASS |
| `.env.local` cargado | log de Next: `Environments: .env.local` | ☐ PASS |
| `predev` (guard/heal) presente | `package.json` scripts | ☐ PASS |
| Build limpio | `npm run build` | ☐ PASS |
| Typecheck limpio | `npm run typecheck` | ☐ PASS |

---

## 3. Validación funcional (sesión logueada)

| Módulo | Verificar en navegador | Estado |
|---|---|:--:|
| Clientify | `/comercial/pipeline` sin "no configurado" | ☐ PASS |
| Tracking | `/operaciones/tracking` → mapa en vivo | ☐ PASS |
| CCTV | `/cctv` → cámaras / NVR Online | ☐ PASS |
| OCR | Centro Documental procesa una factura | ☐ PASS |
| Supabase | login + datos reales cargan | ☐ PASS |

---

## 4. Fuera de alcance (NO bloquean este deploy — incidente separado)

| Integración | Nota |
|---|---|
| Google Drive | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` no presentes ni en `main`; aprovisionar aparte (secreto montado). |
| ARCA / Facturación | `ARCA_*` no en `.env.local`; opera en sandbox/mock o requiere certificados productivos. |

---

## 5. Variables de entorno del entorno de producción (Netlify)

> Recordatorio: `.env.local` es **solo local**. En producción, las mismas claves deben existir en el **panel de variables de Netlify** del sitio. `env:check` en CI las valida vía `process.env`.

| Grupo | ¿Configurado en Netlify? |
|---|:--:|
| Supabase (URL/ANON/SERVICE_ROLE) | ☐ |
| Clientify | ☐ |
| Mapbox / Tracking | ☐ |
| Hikvision / CCTV | ☐ |
| OpenAI / OCR | ☐ |

---

## Firma de release

```
ENV CHECK (npm run env:check) = PASS  ☐
RUNTIME desde main            = PASS  ☐
VALIDACIÓN FUNCIONAL          = PASS  ☐
NETLIFY ENV VARS              = PASS  ☐
```
**Solo con los 4 en PASS → autorizar deploy review.**
