# Auditoría Integral de Integraciones del Ecosistema Nexus
**Fecha:** 2026-07-14 · **Alcance:** repo `tops-ordenes` (rama auditada: `origin/main` @ `0acf4a3`) + GitHub Actions + Netlify + Resend, vistos con las credenciales/conectores disponibles en esta sesión.

> Regla seguida: ningún estado "OK" sin evidencia directa. Donde no hubo forma de verificar, se marca explícitamente ⚪.

---

## 1. Origen del inventario

- **Descubiertas automáticamente en el código fuente** (grep de `process.env`, `package.json`, `.github/workflows/*.yml`, `src/app/api/**`, migraciones SQL, docs/*.md): 15 integraciones externas + Netlify + GitHub Actions como capa de plataforma.
- **Definidas en política/documentación pero no implementadas**: Twilio (aparece solo como valor de tipo `"twilio"` en `WHATSAPP_PROVIDER`, sin cliente ni env vars propias — 0% implementado).
- **Implementadas pero ausentes de la documentación** (`.env.example`/README): Hikvision (8 env vars), Traccar (`TRACKING_INGEST_TOKEN`), Mapbox, WhatsApp Meta (5 env vars, incluida `META_WA_WEBHOOK_VERIFY_TOKEN` con fallback inseguro hardcodeado `"nexus-tops-verify"`), variables serverless de ARCA (`ARCA_CERT_PEM`/`ARCA_KEY_PEM`), Open-Meteo y feeds RSS (La Nación / Canal 26).
- **README desactualizado** en 3 puntos: marca Clientify como TODO de roadmap (ya está implementado con cron + webhook), y describe WhatsApp como "mockup" (es una integración real con Meta Cloud API v22.0).
- **Nuevas detectadas en esta ejecución** (vía Netlify, no visibles solo con grep de código): un **Netlify Scheduled Function** `connect-dispatch-outbox` (cron `*/5 * * * *`) coexistiendo con el workflow de GitHub Actions homónimo (cron cada 10 min) — ver hallazgo crítico #2 abajo.

---

## 2. Inventario clasificado

| # | Integración | Estado operativo | Estado auditoría | Evidencia utilizada |
|---|---|---|---|---|
| 1 | **Supabase** (DB/Auth/Storage/RLS) | 🟢 Operativo | 🟢 Completa | `supabase-backup.yml`: 5/5 últimas corridas `success` (pg_dump real), última hoy 2026-07-14 06:59 UTC |
| 2 | **Google Drive** (service account, 4 consumidores: Compras, Contratos, Compliance, Caja Chica) | 🟢 Operativo | 🟢 Completa | 3 workflows de sync (`contratos-`, `compliance-`, `caja-chica-drive-sync.yml`): 5/5 corridas `success` c/u, diarias, última hoy |
| 3 | **Clientify CRM** (sync de deals) | 🟢 Operativo (sync) / 🟡 parcial (webhook+contactos) | 🟢 Completa (sync) / 🟡 Parcial (webhook/contacts) | `clientify-dashboard-sync.yml`: 5/5 `success`. El webhook tokenizado y `sync-contacts` existen en código pero sin cron propio ni logs accesibles desde acá — no verificados en esta corrida |
| 4 | **Resend** (email transaccional) | 🔴 **Degradado/roto** | 🟢 Completa (evidencia directa obtenida) | Dominio `logisticatops.com` en Resend: **`status: failed`** (SPF-TXT y SPF-MX en `failed`, sólo DKIM `verified`). Logs de Resend: 5× `POST /emails` desde la app (`user-agent: node`) el 2026-07-13 13:40–13:58, **todas HTTP 403**. Body de una de ellas: intento de enviar comprobante de la orden real `OS-201637` ($4.840.000) a `martinferbat@gmail.com` **desde `onboarding@resend.dev`** (sandbox de Resend) → rechazado porque el sandbox sólo permite enviar a la propia cuenta. Único email jamás entregado con éxito: un test del 2026-05-27. |
| 5 | **Netlify** (hosting/deploy, sitio `tops-ordenes` → `nexus.logisticatops.com`) | 🟢 Operativo (deploy `ready`) / 🟠 riesgo de gobernanza | 🟢 Completa | `get-projects`: estado `ready`. Deploy actual: `deploy_source: "cli"`, título `"NEXUS PILOT RELEASE v1.0 — F6+Voice 52178b7 (draft pre-publish)"`, `commit_ref: null`, `committer: null` — **el último publish a producción fue manual por Netlify CLI, no por el pipeline git/CI** |
| 6 | **GitHub Actions** (CI/cron layer) | 🟢 Operativo | 🟢 Completa | 6 workflows activos, 5/5 últimas corridas `success` en cada uno (ver detalle §3) |
| 7 | **ARCA/AFIP** (Facturación Electrónica WSAA+WSFEv1) | 🟡 **Bloqueado (según último reporte)** | 🟡 Parcial (evidencia vieja, no re-verificada hoy) | `ARCA-INTEGRATION-REPORT.md` (2026-05-29): certificado público válido (CUIT 33-60489698-9, vigente hasta 2026-09-27) pero **clave privada nunca recibida** (bloqueada por el servidor de mail del contador) → dictamen propio del reporte: **"NO-GO provisional"**. No hay evidencia posterior que confirme resolución. |
| 8 | **OpenAI** (OCR de documentos) | ⚪ No verificable | ⚪ No verificable | Sin cron, sin logs accesibles desde esta sesión, sin conector habilitado. Sólo evidencia de código (`src/lib/ocr/openai.ts`) |
| 9 | **WhatsApp Cloud API (Meta)** | ⚪ No verificable | ⚪ No verificable | Endpoint `ping` existe (`/api/whatsapp/ping`) pero no fue invocado (requiere acceso a producción). Webhook verify-token tiene fallback inseguro hardcodeado si `META_WA_WEBHOOK_VERIFY_TOKEN` no está seteada |
| 10 | **Hikvision NVR** (CCTV, LAN Magaldi) | ⚪ No verificable | ⚪ No verificable | Dispositivo de red local, inalcanzable desde este entorno |
| 11 | **Traccar Client** (ingesta GPS de flota) | ⚪ No verificable | ⚪ No verificable | Sin acceso a Supabase para ver última posición ingerida |
| 12 | **Mapbox GL JS** | ⚪ No verificable | ⚪ No verificable | Token client-side; sin forma de probarlo desde el servidor |
| 13 | **Open-Meteo** | ⚪ No verificable | ⚪ No verificable | Egreso de red bloqueado por el proxy del sandbox (403 en dominios no-API) |
| 14 | **RSS La Nación / Canal 26** | ⚪ No verificable | ⚪ No verificable | Mismo motivo que Open-Meteo |
| 15 | **DNS / SPF / DKIM / DMARC / certificados TLS** (genérico, todos los subdominios `*.logisticatops.com`) | ⚪ No verificable (excepto Resend) | ⚪ No verificable | `dig`/`nslookup` no disponibles; `curl`/WebFetch a los dominios devuelven 403 (proxy del sandbox). Única excepción: SPF de `logisticatops.com` vía Resend (ver fila 4) |
| 16 | **Twilio** (declarado en tipo `WHATSAPP_PROVIDER`) | N/A — no implementado | ⚪ Registrado, sin implementación | `src/lib/env.ts:85`: valor de tipo permitido, cero cliente, cero env vars propias |

---

## 3. Evidencia detallada — GitHub Actions (últimas 5 corridas c/u, hoy incluido)

| Workflow | Cron | Última corrida | Resultado |
|---|---|---|---|
| Caja Chica · Drive Sync | 21:05 ART diario | 2026-07-14 03:21 UTC | ✅ success (run #26) |
| Clientify · Tablero Comercial Sync | 21:00 ART diario | 2026-07-14 01:46 UTC | ✅ success (run #28) |
| Compliance · Drive Sync | 21:00 ART diario | 2026-07-14 01:52 UTC | ✅ success (run #49) |
| Contratos · Drive Sync | 21:00 ART diario | 2026-07-14 01:49 UTC | ✅ success (run #36) |
| Connect · Dispatch Outbox | cada 10 min | 2026-07-14 11:57 UTC | ✅ success (run #143) — respuesta real `{"success":true,"status":"ok",...}` |
| Supabase Daily Backup | 02:00 ART diario | 2026-07-14 06:59 UTC | ✅ success (run #51) |

Las 6 corridas más recientes de cada workflow (30 corridas revisadas en total) fueron exitosas — sin timeouts, sin cron detenido, sin jobs fallidos en la ventana observada.

---

## 4. Hallazgos y ranking de criticidad

### 🔴 Crítico — Emails transaccionales de órdenes rotos en producción
- **Impacto**: Cada Orden de Servicio dispara 4 correos (depósito, director, facturación, cliente). Desde al menos el 2026-07-13, los envíos a cualquier destinatario que no sea la cuenta dueña de Resend fallan con HTTP 403, porque el remitente configurado en producción es el sandbox `onboarding@resend.dev` en lugar de un remitente del dominio verificado.
- **Riesgo**: Clientes no reciben su comprobante; depósito/dirección/facturación no reciben las notificaciones operativas. El fallo es **silencioso**: el código tiene manejo `non-blocking` (`try/catch`) que registra el error en `email_sends.status='failed'` pero no bloquea ni alerta — la orden se crea "exitosamente" desde la UI sin que nadie note que las notificaciones no salieron.
- **Causa raíz doble**:
  1. `RESEND_FROM_EMAIL` en producción apunta al sandbox de Resend en lugar de `ordenes@logisticatops.com` (o el remitente definido en el default de `src/lib/env.ts`).
  2. Aunque se corrija (1), el dominio `logisticatops.com` en Resend tiene **SPF fallido** (`status: failed`) — sólo DKIM está verificado. Con SPF roto, aun corrigiendo el remitente, los correos entregados podrían caer en spam o ser rechazados por servidores destino.
- **Probabilidad**: Ocurre en el 100% de los envíos a destinatarios reales (confirmado, no es intermitente).
- **Acción recomendada**: (a) corregir `RESEND_FROM_EMAIL` en Netlify a un remitente `@logisticatops.com`; (b) resolver el registro SPF (TXT `send.logisticatops.com` → `v=spf1 include:amazonses.com ~all`) en el proveedor DNS del dominio; (c) considerar una alerta activa (no sólo `email_sends.status='failed'` silencioso) para que un fallo de notificación se note el mismo día, no semanas después.

### 🟠 Alto — Deploy de producción no trazable a git
- El último publish de `nexus.logisticatops.com` fue un **deploy manual por Netlify CLI** (`deploy_source: "cli"`), título "NEXUS PILOT RELEASE v1.0 — F6+Voice 52178b7 (draft pre-publish)", sin `commit_ref` ni `committer` asociado en Netlify.
- Esto explica una inconsistencia detectada: el workflow `connect-dispatch-outbox.yml` pega a `POST /api/connect/cron/dispatch-outbox` y ese endpoint **no existe en ningún archivo de `origin/main`** buscado en el repo — sin embargo, en producción responde `HTTP 200` con un JSON real y coherente (`{"success":true,"status":"ok","claimed":0,...}`). Es decir, **el código que corre en producción no es 100% reconstruible desde el historial de git** — hay al menos una ruta viva en el deploy actual que no está en el árbol de `main`.
- Además, el manifiesto del deploy actual incluye una **Netlify Scheduled Function** `connect-dispatch-outbox` con cron propio `*/5 * * * *`, mientras el comentario del workflow de GitHub Actions afirma que "los deploys manuales por CLI no activan schedules" — esa premisa puede ser incorrecta o estar desactualizada; si ambos mecanismos están activos, el outbox podría estar siendo drenado por dos crons distintos (cada 5 y cada 10 min) simultáneamente. El diseño dice tener lease+backoff, pero esto no fue verificado.
- **Acción recomendada**: confirmar contra qué commit real se construyó el deploy vivo (Netlify no lo registra por ser deploy CLI), y decidir si el mecanismo válido es el Netlify Scheduled Function, el GitHub Action, o ambos a propósito.

### 🟡 Medio — Documentación desactualizada / incompleta
- README describe Clientify como pendiente (ya implementado) y WhatsApp como mockup (ya es Meta Cloud API real).
- `.env.example` no incluye ~20 variables realmente usadas en `src/lib/env.ts` (Hikvision completo, Traccar, Mapbox, WhatsApp/Meta, variables PEM de ARCA, etc.) — un auditor u onboarding nuevo no puede enumerar los secretos requeridos sólo con el template.
- `META_WA_WEBHOOK_VERIFY_TOKEN` tiene un fallback hardcodeado inseguro (`"nexus-tops-verify"`) si la env var no está seteada.

### 🟡 Medio — ARCA/AFIP sin confirmación de cierre
- El único reporte de estado (2026-05-29) concluye "NO-GO provisional" por falta de la clave privada. No se encontró evidencia más reciente de que esto se haya resuelto. Si la facturación electrónica real depende de esto, debería re-verificarse antes de asumir que está en producción.

### 🟢 Bajo — Integraciones triviales sin documentar
- Open-Meteo y RSS (La Nación/Canal 26) están implementadas y en uso desde un endpoint público (`/api/today`), pero no figuran en ningún doc — riesgo bajo (no manejan datos sensibles ni credenciales) pero rompe la regla de "todo lo implementado debe estar documentado".

---

## 5. Cobertura real de la auditoría

- **Integraciones descubiertas automáticamente**: 16 (15 externas + Netlify; GitHub Actions se cuenta como capa de plataforma, no como fila propia de "integración de negocio")
- **Auditadas completamente (🟢)**: 6 — Supabase, Google Drive, Clientify (sync), Resend, Netlify, GitHub Actions
- **Auditadas parcialmente (🟡)**: 3 — Clientify (webhook/contactos), ARCA/AFIP, documentación (transversal)
- **No verificables (⚪)**: 9 — OpenAI/OCR, WhatsApp Meta, Hikvision, Traccar, Mapbox, Open-Meteo, RSS, DNS/SPF/DKIM/DMARC genérico, TLS/certificados
- **Cobertura efectiva**: (6 + 3) / 18 clasificaciones ponderadas ≈ **50%**

**Esta cifra NO debe leerse como "la mitad del ecosistema está mal"** — significa que la mitad de las integraciones detectadas no pudieron verificarse operativamente desde este entorno (sandbox sin credenciales de producción, sin acceso a Supabase, con egreso de red restringido a un proxy que sólo permite dominios de herramientas MCP conectadas).

### Confiabilidad del informe
- **Evidencia directa** (logs reales, respuestas de API reales, corridas de CI reales): 6 integraciones
- **Evidencia indirecta** (reportes previos, código sin ejecución en vivo): 3
- **Sin evidencia**: 9
- **Confiabilidad global**: ≈ 50% de las filas del inventario tienen respaldo verificable hoy; el resto queda declarado explícitamente como no verificado (no como "OK por defecto").

---

## 6. Resumen ejecutivo para Dirección

1. **¿Qué funciona correctamente?** Supabase, Google Drive (3 syncs diarios), Clientify (sync de deals), Netlify (sitio activo) y los 6 workflows de GitHub Actions — todos con evidencia directa y reciente (hoy).
2. **¿Qué presenta riesgos?** Dos hallazgos activos y accionables: (a) los emails transaccionales de órdenes están rotos en producción desde hace al menos un día, silenciosamente, por mala configuración de Resend (remitente sandbox + SPF fallido del dominio); (b) el último deploy de producción se hizo manualmente por CLI y contiene al menos una ruta que no existe en el repositorio git — la trazabilidad código↔producción está rota.
3. **¿Qué servicios no pudieron verificarse?** OpenAI/OCR, WhatsApp Cloud API, Hikvision, Traccar, Mapbox, Open-Meteo, feeds RSS, y el estado DNS/SPF/DKIM/certificados de los dominios `*.logisticatops.com` en general (fuera del hallazgo puntual de Resend). Ausencia de verificación ≠ que estén fallando; simplemente no hay evidencia hoy.
4. **¿Cuál es la cobertura real alcanzada?** ~50% de las integraciones detectadas tienen evidencia operativa directa hoy; el resto requiere acceso adicional (credenciales de producción, conector de Supabase, acceso de red sin restricciones) para auditarse en próximas corridas.
5. **¿Cuál es el principal riesgo del ecosistema hoy?** El correo transaccional roto — impacta directamente la experiencia del cliente (no recibe comprobante) y la operación interna (depósito/dirección/facturación no reciben sus notificaciones), y lleva al menos desde el 2026-07-13 sin que nadie lo haya detectado porque el fallo es silencioso.
6. **¿Qué acciones deberían priorizarse?**
   - Corregir `RESEND_FROM_EMAIL` a un remitente del dominio verificado y resolver el SPF de `logisticatops.com`.
   - Agregar una alerta activa sobre `email_sends.status='failed'` (hoy sólo queda una fila silenciosa en la tabla).
   - Aclarar de qué commit real se construyó el último deploy de producción y restablecer un flujo de deploy trazable (git → build → deploy), o documentar explícitamente por qué el flujo CLI es intencional.
   - Actualizar README y `.env.example` para reflejar el estado real de Clientify, WhatsApp y las ~20 variables no documentadas.
   - Re-verificar el estado de ARCA/AFIP (el último reporte data de mayo y quedó en "NO-GO provisional").

---

## 7. Limitaciones explícitas de esta auditoría

- Sin conector de Supabase disponible en esta sesión: no se pudo consultar `email_sends`, `connect_outbox`, `connect_worker_runs` ni última posición de tracking directamente en la base.
- El egreso de red de este entorno está restringido a un proxy que sólo permite tráfico hacia las herramientas MCP conectadas — no se pudo resolver DNS ni verificar certificados TLS de ningún dominio `*.logisticatops.com` directamente (excepto lo que Resend expuso sobre su propio registro SPF).
- No se ejecutó código ni se invocaron endpoints de producción (`/api/*/ping`) — toda la evidencia de código es estática; toda la evidencia operativa proviene de APIs de terceros ya conectadas (GitHub, Netlify, Resend).
- No se leyeron los 111 archivos de migración SQL línea por línea; sólo se grepeó por patrones relevantes.
- Esta auditoría cubre el repositorio `tops-ordenes`. Los otros 17 sitios Netlify vistos en la cuenta (`logisticatops.com`, `regulados.logisticatops.com`, `connect.logisticatops.com`, etc.) no fueron auditados en profundidad — sólo se confirmó que su deploy más reciente está en estado `ready`.
