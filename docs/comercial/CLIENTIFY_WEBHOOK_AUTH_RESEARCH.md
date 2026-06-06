# CLIENTIFY_WEBHOOK_AUTH_RESEARCH — F2.2-0 · Mecanismo de autenticación de webhooks

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Frente:** F2.2-0 (cierre de infraestructura, sin código)
**Pregunta:** ¿Clientify **firma** sus webhooks salientes (HMAC/signature) o expone algún mecanismo de autenticación verificable? De eso depende cómo aseguramos `POST /api/clientify/webhook`.

---

## 1. Conclusión (TL;DR)

> ## ❗ Clientify **NO firma** sus webhooks. No hay HMAC, ni header de firma, ni secret configurable en la entrega.
>
> Los webhooks de Clientify son un **POST saliente simple** a una URL que vos configurás, disparado ante **create / update / delete** de contacto u oportunidad. La seguridad recae enteramente en el **secreto de la URL**.
>
> **Implicancia de diseño:** el plan original "verificar `x-clientify-signature` con HMAC" del placeholder **no es implementable** (Clientify no provee la firma). La autenticación del webhook en Nexus pasa a basarse en un **token secreto en la URL** + HTTPS + idempotencia (+ allowlist de IPs opcional). Esto **resuelve D-3** de la arquitectura.

**Nivel de confianza:** **Alto** para "no hay firma nativa", con un **caveat**: la sección *WebHooks* del portal de desarrolladores es una SPA (Postman) que no se pudo extraer íntegra de forma automatizada. **Gate previo a producción:** confirmar por **ticket a soporte de Clientify** que no planean firmar (y, si lo ofrecen en algún plan, activarlo).

---

## 2. Qué se investigó (fuentes)

| Fuente | Tipo | Qué dice (relevante) |
|---|---|---|
| **ayuda.clientify.com — "¿Cómo conectar Clientify con Webhooks?"** (art. 5990763) | **Oficial (help center)** | Webhooks = envían info del **contacto/oportunidad** a una **URL designada** "tan pronto como suceda un cambio" (creación/actualización/eliminación). Explica configurar la URL, habilitar/deshabilitar, y **probar con webhook.site**. **Ninguna mención** a firma, HMAC, secret, token ni header de seguridad. |
| **developer.clientify.com** (portal API, Postman) | **Oficial (API ref)** | Confirma auth de **API** = `Authorization: Token <api_token>` (token vía `POST /v1/api-auth/obtain_token/`). Tiene secciones *Automations* y *WebHooks* (gestión vía API), pero el contenido es SPA y **no fue extraíble** automáticamente. Sin evidencia de firma de entrega. |
| **apitracker.io/a/clientify** | Terceros | "Webhooks management API: Yes" · "Sandbox environment: —" (sin sandbox declarado). |
| Búsqueda web amplia (firma/secret/header de webhook Clientify) | Terceros | **Cero** resultados de un esquema de firma de webhooks de Clientify. Los resultados de HMAC corresponden a otras plataformas (Shopify, Qlik, etc.). |

> El indicio más fuerte: el propio tutorial oficial recomienda **probar con webhook.site** (que muestra el request crudo) y describe el flujo **sin ningún paso de verificación de firma**. Si Clientify firmara, el tutorial incluiría cómo validar.

---

## 3. Cómo funcionan realmente los webhooks de Clientify (modelo confirmado)

```
Cambio en Clientify (contacto/oportunidad creado/actualizado/eliminado)
        │
        ▼
POST  https://<tu-url-configurada>            ← URL fija que vos pegás en Clientify
        body: JSON con los datos del objeto
        headers: estándar HTTP (Content-Type), SIN firma ni token propio
```
- **Disparadores:** create / update / delete de contacto y oportunidad (y, según automatizaciones, otros eventos vía el paso "webhook" de un workflow).
- **Entrega:** POST con JSON. Sin `x-clientify-signature` ni equivalente.
- **Seguridad provista por Clientify:** **ninguna más allá de HTTPS y el secreto de la URL.**

---

## 4. Consecuencia para el diseño de seguridad del webhook en Nexus

Como no hay firma que verificar, el endpoint se protege por capas (defensa en profundidad):

| Capa | Mecanismo | Estado |
|---|---|---|
| **1 · Secreto en la URL (PRIMARIO)** | Un **token de alta entropía** en la ruta o query: `/api/clientify/webhook/<token>` o `?t=<token>`. Comparado **timing-safe** contra `CLIENTIFY_WEBHOOK_SECRET`. Rechazo `401` si no coincide. | **Recomendado** |
| 2 · Transporte | **HTTPS** obligatorio (la URL es secreta solo si el canal es cifrado). | Dado por Netlify |
| 3 · Idempotencia | Upsert por `clientify_id`; descartar reentregas/orden viejo por timestamp. Evita daño aun si el token se filtra y alguien reenvía un payload viejo. | Diseño F2.2-1 |
| 4 · Allowlist de IPs (opcional, defensa extra) | Si Clientify publica su rango de IPs de salida, restringir en el handler/edge. **A confirmar con soporte.** | Opcional |
| 5 · Validación de forma | Validar el payload (Zod) antes de procesar; payload no reconocible → `200` + log `skipped` (no reintentos). | Diseño F2.2-2 |
| 6 · Reconciliación | El **pull `sync-deals`** (cron con `CRON_SECRET`) es el **canal confiable de respaldo**: aunque se pierda/duplique un webhook, la reconciliación corrige. | Diseño F2.2-5 |

> **El token-en-URL no es tan fuerte como HMAC** (no prueba integridad del payload ni frena replays por sí solo), por eso se **complementa** con idempotencia + reconciliación. Es la mitigación correcta dado que Clientify no ofrece firma. **Se documenta como degradación conocida, no como agujero silencioso.**

### 4.1 Higiene del token-en-URL
- Token ≥ 32 bytes aleatorios (URL-safe). Generado una vez, guardado en `CLIENTIFY_WEBHOOK_SECRET`.
- **Nunca** logear la URL completa con el token. Rotación documentada (cambiar env + URL en Clientify).
- El token va en **path** (no en query) para reducir fugas por logs de proxies/referrers.

---

## 5. Alternativa arquitectónica considerada (y por qué no)

| Opción | Veredicto |
|---|---|
| Poner un **intermediario que firme** (Make/Zapier/Workato entre Clientify y Nexus) | Agrega dependencia y costo; no aporta integridad real (el primer salto Clientify→intermediario sigue sin firma). **Descartado** para F2.2. |
| **Solo pull** (sin webhook) | Más simple y robusto, pero pierde la baja latencia del lead entrante. **Se mantiene el webhook como best-effort + pull como backbone** (lo mejor de ambos). |
| **mTLS / token en header** | Clientify no permite configurar headers personalizados en la entrega (no documentado). **No disponible.** |

---

## 6. Acciones que dispara esta investigación

1. **Actualizar la arquitectura (D-3 / §3.3):** el mecanismo pasa de "HMAC primario + fallback" a **"token-en-URL primario"** (HMAC no disponible en Clientify). *(Aplicado en `CLIENTIFY_INTEGRATION_ARCHITECTURE.md`.)*
2. **Renombrar la semántica de la env:** `CLIENTIFY_WEBHOOK_SECRET` = token secreto de la URL (no clave HMAC). *(Ver `CLIENTIFY_INTEGRATION_PREREQUISITES.md`.)*
3. **Gate pre-producción:** ticket a soporte Clientify confirmando (a) que no firman, (b) si publican rango de IPs de salida para allowlist, (c) si existe sandbox/tenant de prueba.

---

## 7. Fuentes

- Clientify Help Center — *¿Cómo conectar Clientify con Webhooks?* (art. 5990763): https://ayuda.clientify.com/es/articles/5990763-como-conectar-clientify-con-webhooks
- Clientify API (developer portal): https://developer.clientify.com/ (auth `Token`, secciones Automations/WebHooks)
- API Tracker — Clientify: https://apitracker.io/a/clientify

> Investigación de F2.2-0. Sin código. Conclusión sujeta a confirmación final por soporte de Clientify antes de producción.
