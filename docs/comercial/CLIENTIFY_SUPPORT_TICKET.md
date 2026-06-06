# CLIENTIFY_SUPPORT_TICKET — G-4 · Consulta a soporte Clientify

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Gate:** G-4 — confirmar oficialmente el comportamiento del webhook (firma, IPs, sandbox, payload).
**Estado:** ticket **listo para enviar** · respuesta pendiente.

> Cierra la incógnita que la investigación (`CLIENTIFY_WEBHOOK_AUTH_RESEARCH.md`) dejó marcada como "confirmar con soporte": el help center no menciona firma de webhooks, pero la sección WebHooks del portal de desarrolladores (SPA) no fue extraíble. Esta confirmación es el **gate pre-producción** de la autenticación del webhook.

---

## 1. Ticket — texto listo para enviar (ES)

> **Asunto:** Webhooks salientes — firma/seguridad, IPs de origen, sandbox y esquema de payload
>
> Hola equipo de Clientify,
>
> Estamos integrando los webhooks de Clientify con nuestro sistema (recepción de eventos de **contactos** para ingestar leads). Necesitamos confirmar algunos puntos técnicos para asegurar la integración:
>
> 1. **Firma de webhooks:** ¿Clientify **firma** los webhooks salientes (p. ej. HMAC con un secreto compartido)? Si es así, ¿qué **header** envía (nombre exacto) y con qué **algoritmo** (HMAC-SHA256, base64/hex)? ¿Dónde se configura el secreto?
> 2. **Headers de seguridad:** ¿se puede configurar un **header personalizado** (p. ej. un token) o **basic auth** en la URL de destino del webhook?
> 3. **IPs de origen:** ¿desde qué **rango(s) de IP** salen los webhooks? (para poder restringir por allowlist).
> 4. **Reintentos:** ¿cuál es la política de **reintentos** ante respuestas no-2xx (cantidad, backoff)? ¿Hay deduplicación o un `id` de entrega?
> 5. **Esquema del payload:** ¿tienen documentación del **JSON** que envía el webhook de contacto (campos, si viene plano o envuelto en `data`/`object`) y la lista de **eventos** disponibles (creado/actualizado/eliminado)?
> 6. **Sandbox:** ¿existe un **entorno de pruebas / tenant sandbox** para validar la integración sin afectar datos productivos?
>
> Gracias.
> Equipo TOPS Nexus — Logística TOPS (Verotin S.A.)

---

## 2. Seguimiento (completar al recibir respuesta)

| # | Pregunta | Respuesta de Clientify | Impacto en la arquitectura |
|---|---|---|---|
| 1 | ¿Firma webhooks? (header/algoritmo) | _pendiente_ | Si **sí** → agregar verificación HMAC (mejor que token-en-URL). Si **no** → token-en-URL queda confirmado como primario. |
| 2 | ¿Header personalizado / basic auth? | _pendiente_ | Alternativa/refuerzo a token-en-URL. |
| 3 | ¿Rango de IPs? | _pendiente_ | Si publican IPs → habilitar **allowlist** (capa extra). |
| 4 | ¿Reintentos / dedup? | _pendiente_ | Ajustar códigos HTTP del handler; confirma que la idempotencia (`clientify_id`) es suficiente. |
| 5 | ¿Esquema del payload / eventos? | _pendiente_ | Validar/ajustar `normalizeLead` (cruza con la captura real G-3). |
| 6 | ¿Sandbox? | _pendiente_ | Habilita E2E real (Clientify→webhook) sin tocar PROD; relevante para outbound F2.2-6. |

---

## 3. Hipótesis actual (a confirmar)

- **Firma:** se asume **NO** (help center sin mención; tutorial prueba con webhook.site sin verificación). → **token-en-URL primario** ya implementado (F2.2-2).
- **Sandbox:** apitracker indica "Sandbox: —" (no declarado). → validación inbound vía fixtures + staging.
- Si soporte contradice estas hipótesis, los cambios son **additivos** (agregar verificación HMAC / allowlist) y no rompen lo construido.

---

## 4. Cierre de G-4

- ✅ Ticket redactado y listo para enviar (sección 1).
- ⏳ **Pendiente:** envío por parte del equipo + registro de respuestas (sección 2).
- **No bloquea** el avance en staging; es gate **pre-producción** del webhook.
