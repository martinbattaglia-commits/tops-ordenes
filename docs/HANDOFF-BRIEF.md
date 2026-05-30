# BRIEF — Proyecto TOPS NEXUS (handoff)

## Qué es
ERP vertical interno de **Logística TOPS / Verotin S.A.** (reemplaza Neuralsoft).
- **Stack:** Next.js 14.2.18 (App Router), Supabase, deploy en Netlify desde `main`.
- **Repo:** `/Users/martinbattaglia/CODE/tops-ordenes`
- **URL viva actual:** https://tops-ordenes.netlify.app
- **Dominio objetivo:** `ordenes.logisticatops.com` (bloqueado por DNS, ver abajo)
- **Usuario:** Martín Battaglia, presidente/CEO. Email: martin.battaglia@logisticatops.com

## Reglas de trabajo (no negociables)
- **Migraciones de DB**: las aplica MANUALMENTE Martín en el dashboard de Supabase. Nunca automatizar.
- **Cambios de DNS**: los hace Martín / el diseñador (sin acceso a panel).
- **Secrets/credenciales**: nunca van al repo ni a la DB.
- **No crear cuentas** en nombre del usuario.
- Estilo de comunicación: español, directo, **bias a la acción** (Auto Mode). Martín se pone ansioso con demasiadas preguntas — dar pasos concretos.

## Estado actual
- Build verde, producción sana (rutas 307→`/login`→200, auth gate OK).
- Integraciones activas: Supabase, Clientify (MCP), Hikvision/CCTV, OpenAI, Resend.
- **Último fix (hecho):** bug de scroll del shell. El panel principal derecho no scrolleaba con la ruedita (solo el sidebar). Causa: wrapper exterior `min-h-screen` sin altura acotada → `<main>` nunca activaba su `overflow-y:auto`. Fix en `src/components/shell/Shell.tsx`: wrapper → `h-[100dvh] overflow-hidden`, sidebar → `h-full`. `tsc` limpio. **Sin commitear aún** — pendiente decidir commit en rama actual o ver en preview local.

## Pendientes (en orden)
1. **Commit del fix de scroll** (rama actual) — esperando decisión de Martín.
2. **Dominio custom (BLOQUEADO en terceros):** se mandó draft a Santiago (diseñador, maneja DNS) pidiendo cargar en la zona DNS (servida por nameservers **Hostmar** `ns3/ns4.hostmar.com`, panel DonWeb): (a) registro TXT de verificación + CNAME para `ordenes.logisticatops.com`; (b) records de Resend (SPF/DKIM/MX/DMARC). Cuando Santiago confirme → verificar propagación (`dig`) + conectar dominio en Netlify + confirmar SSL.
3. **Google Drive real (opcional, no bloqueante):** la sección `/workspace` es un launcher de links (el "APIs No conectado" es POR DISEÑO, no bug). La integración real (`src/lib/drive/client.ts`) usa Service Account con scopes `drive.readonly` + `drive.file` (lectura + guardado de PDFs en carpetas compartidas). Martín debe crear el Service Account en Google Cloud + compartir carpeta + bajar JSON key; luego cargar 2 env vars en Netlify: `GOOGLE_SERVICE_ACCOUNT_JSON` (el JSON completo) y `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
4. **Fase 2 · Backup GCS** (sin commitear; necesita secret de service-account en GitHub).
5. **Fase 3 · OCR F2** (código en prod, INACTIVO): validar contra 3-5 facturas reales → aplicar migración `0015` en Supabase (crea bucket `supplier-invoices`) → setear `OPENAI_API_KEY` en Netlify. Plan de pruebas en `docs/OCR-F2-PLAN-PRUEBAS-FACTURAS-REALES.md`. Criterio Go: Proveedor+CUIT ≥90%, Fecha ≥95%, Neto/IVA/Total consistentes ≥95%, cero falsos "Alta".
6. **Fase 4 · Facturación fiscal ARCA** (código en prod inactivo; lo más delicado — certs, firma, migraciones, env vars ARCA).

## Notas técnicas útiles
- Sidebar config en `src/components/shell/Sidebar.tsx` (array `DOMAINS`).
- Tokens de diseño: `bg-bg-page`, `bg-bg-surface`, `text-fg-primary/secondary`, `text-tops-blue-700`, `text-tops-red`, `border-stroke-soft`.
- `DEMO_MODE` (`NEXT_PUBLIC_DEMO_MODE=1`) permite probar OCR real sin escribir en DB.
