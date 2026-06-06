# CLIENTIFY_PAYLOAD_CAPTURE_RUNBOOK — G-3 · Captura del payload real

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Gate:** G-3 — verificar que el comportamiento real del webhook coincide con la arquitectura implementada.
**Estado:** procedimiento + harness auto-validador listos · **captura real pendiente** (requiere acción en la cuenta Clientify).

> **Por qué no lo captura el asistente:** capturar un webhook real exige configurar la URL de webhook en la **cuenta Clientify** y disparar un evento — una acción en la **UI de Clientify** (no accesible vía API) y bajo la regla permanente "no tocar Clientify PROD". Este runbook deja la captura **turnkey** y la **validación automática** contra el normalizador ya implementado (`src/lib/clientify/webhook.ts`).

---

## 1. Objetivo

Obtener **un payload real** que Clientify envía a un webhook (ante creación/actualización de contacto) y confirmar que el `normalizeLead` de Nexus lo mapea correctamente (identidad + campos). Esto cierra la incógnita de "forma real del payload" que hoy está **inferida** del tipo `ClientifyContact`.

---

## 2. Procedimiento (≈10 min, sin tocar Nexus)

### Paso 1 — Endpoint de captura neutro
1. Abrí **https://webhook.site** y copiá la **URL única** que te asigna (p. ej. `https://webhook.site/#!/<uuid>`).
   - webhook.site solo **muestra** lo que llega; no afecta a Nexus ni a Clientify.

### Paso 2 — Configurar el webhook en Clientify (temporal)
2. En Clientify → **Configuración → Webhooks** (o Automatizaciones → acción Webhook).
3. Pegá la URL de webhook.site como destino.
4. Suscribí el evento **contacto creado/actualizado** (el que use el embudo de Google Ads).
5. Guardá/activá.

### Paso 3 — Disparar un evento real
6. Creá o editá un **contacto de prueba** en Clientify (o esperá un lead real).
7. En webhook.site vas a ver llegar el **POST** con su **body JSON** y sus **headers**.

### Paso 4 — Registrar la evidencia
8. **Headers:** copiá la lista completa de headers (buscá si hay alguno tipo `X-*-Signature`, `X-Hub-Signature`, `Authorization`, etc. → confirma/【descarta】 firma; ver `CLIENTIFY_WEBHOOK_AUTH_RESEARCH.md`).
9. **Body:** copiá el JSON y guardalo, **redactando PII real** (reemplazá nombres/emails/teléfonos por valores ficticios; conservá los **nombres de campo** y la **estructura**), en:
   ```
   docs/comercial/fixtures/clientify-contact-REAL.json
   ```

### Paso 5 — Validar contra el normalizador
10. Ejecutá:
    ```bash
    npx tsx scripts/clientify-validate-payload.mts
    ```
    - Detecta `clientify-contact-REAL.json`, corre el `normalizeLead` real y reporta **paridad** con la referencia.
    - Si marca "campos que la REAL no mapeó" → hay una **diferencia de nombres de campo**; se ajusta `webhook.ts` (`extractObject`/`pick*`) y se re-valida. Cambio additivo, sin tocar la RPC.

### Paso 6 — Limpiar
11. **Quitá** el webhook de webhook.site en Clientify (era temporal). Borrá el contacto de prueba si corresponde.

---

## 3. Qué confirma esta captura

| Pregunta | Cómo se responde con la captura |
|---|---|
| ¿La forma del payload coincide con `ClientifyContact`? | El harness mapea identidad + campos; paridad sin brechas = coincide. |
| ¿El payload viene plano o envuelto (`data`/`object`)? | Se ve en el JSON; el normalizador soporta ambos. |
| ¿Clientify firma (headers de firma)? | Se ve en los headers (Paso 4.8) → confirma/descarta la decisión token-en-URL. |
| ¿Qué eventos/disparadores reales llegan? | El campo `event`/`object_type` del body. |

---

## 4. Resultado actual — forma real capturada (read-only, autorizada)

Se ejecutó `scripts/clientify-capture-real.mjs` (GET `/contacts/?page_size=1`, **solo lectura**, PII redactada) y se guardó `clientify-contact-REAL.json`. El harness validó el normalizador contra la **forma real**:

- **Harness:** ✅ **8/8** — REFERENCIA + **REAL** + ENVELOPED + sin-identidad. **REAL: paridad sin brechas** (mapea `clientify_id, full_name, email, phone, cuit, source, tags`).
- **Campos reales confirmados:** `id, first_name, last_name, emails[].email, phones[].phone, taxpayer_identification_number (CUIT), tags[], medium, channel, contact_source` + **`company_name` (string top-level)** — que nuestro tipo no tenía y el normalizador igualmente lee.
- **Observaciones honestas:**
  1. En el contacto de muestra, `contact_source`/`picture_url`/`birthday`/`gdpr_*` venían **null**. Si `contact_source` llega como **objeto** cuando está poblado, `normalizeLead` lo ignora y cae a `medium/channel` (source igual resuelve) — posible refinamiento additivo (leer `contact_source.name`).
  2. Esto confirma la **forma de datos** (el objeto contacto que el webhook envía), **no** el **envoltorio ni los headers** de la entrega real del webhook (firma). Eso requiere la **captura por webhook.site** (Pasos 1–6) y/o la respuesta del **ticket G-4**.

> El ciclo inbound es operable y validado en staging; G-3 (forma de datos) queda **confirmado contra datos reales**. La verificación de **envoltorio/headers de entrega** es el remanente pre-producción (runbook webhook.site + ticket G-4).

---

## 5. Alternativa read-only (si se autoriza tocar Clientify en modo lectura)

La `CLIENTIFY_API_KEY` está configurada. Un `GET /v1/contacts/?page_size=1` (no muta nada) devuelve un contacto real y su **forma de campos** — que es esencialmente lo que el webhook envía. Es la vía más rápida para confirmar la estructura **sin** configurar webhooks. **Requiere autorización explícita** (regla "no tocar Clientify PROD"); por defecto **no se ejecuta**.
