# CLIENTIFY_INBOUND_CLOSURE — Cierre formal del ciclo Clientify Inbound (F2.2)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Estado:** ✅ **CICLO INBOUND CERRADO (nivel staging)** · inbound-only · sin outbound · sin producción

> Declara cerrado el frente F2.2 (Clientify Integration · inbound): recibir leads reales de Clientify, operarlos y promoverlos a oportunidad, con resiliencia por pull. Todo validado en staging; la salida a producción es transversal y queda como gate aparte.

---

## 1. El ciclo, completo

```
Google Ads / Web ─► Clientify ─webhook(token-en-URL)─► crm_ingest_lead ─► crm_leads
                                                          │ dedup · owner least-loaded · log
                                                          ▼
                              Bandeja /comercial/leads (filtros · ownership · dup · reasignar · calificar)
                                                          │ "Promover"
                                                          ▼
                              crm_promote_lead ─► crm_opportunities (calificado) ─► Write-Path F2.1
                                                          ▲
                              Reconciliación pull (sync-contacts) ── recupera webhooks perdidos
```

---

## 2. Sub-fases (todas cerradas)

| Sub-fase | Entregable | Validación staging |
|---|---|---|
| **F2.2-0** | Infra (auth research: no-HMAC→token-en-URL · env · consolidación specced) | — |
| **F2.2-1** | RPC `crm_ingest_lead` (dedup, least-loaded, log) — `0048` | 16/16 |
| **F2.2-2** | Handler webhook `[token]` + normalización | 19/19 |
| **F2.2-3** | Bandeja `/comercial/leads` + helper `0049` | 7/7 + build |
| **F2.2-4** | RPC `crm_promote_lead` — `0050` + `promoteLead` + botón (G-1) | 14/14 + build |
| **F2.2-5** | Reconciliación pull `/api/clientify/sync-contacts` | 10/10 + build |

**Total: 66 asserts de validación en staging · 0 fallos.** tsc/lint/build verdes en cada UI/route.

---

## 3. Migraciones (additivas, solo staging)

| Migración | Aporte |
|---|---|
| `0048_crm_ingest_lead.sql` | ingesta idempotente (DEFINER) |
| `0049_crm_list_commercial_users.sql` | comerciales activos PII-safe (bandeja) |
| `0050_crm_promote_lead.sql` | promoción lead→oportunidad (INVOKER) |

> Reutilizan `crm_leads`/`crm_opportunities`/`clientify_sync_log`/RBAC de F2.1 (ya validadas). **No** modifican tablas/enums/RLS existentes.

---

## 4. Propiedades garantizadas

- **Autenticación:** webhook por token-en-URL timing-safe (Clientify no firma — confirmado por investigación; ticket G-4 lo ratificará).
- **Idempotencia:** `clientify_id` unique en toda la cadena (webhook y pull).
- **Deduplicación:** persona por `clientify_id→email→phone`; conflicto → crear+marcar (nunca pierde ni mergea en conflicto). CUIT = cuenta (enlaza a `clients` en la promoción).
- **Ownership:** least-loaded entre comerciales activos; reasignable.
- **Resiliencia:** pull de contactos recupera webhooks perdidos (divergencia visible y corregida).
- **Seguridad:** ingesta DEFINER de superficie mínima (máquina); bandeja/promoción INVOKER bajo RLS (R-G2 intacto); PII-safe (sin email en owners).
- **Forma de datos:** confirmada contra Clientify real (read-only, G-3): `id/first_name/last_name/emails[]/phones[]/taxpayer_id(CUIT)/tags/medium/channel/company_name`.

---

## 5. Lo que queda fuera del inbound (próximos frentes)

- **Outbound** (Nexus→Clientify: mover etapa/cerrar deal) → F2.2-6/F2.4 (requiere consolidar el cliente de escritura T-1).
- **Mirror deals→oportunidades** (`sync-deals` con persistencia) → asociado a outbound.

## 6. Gates pre-producción (no bloquean staging)

| Gate | Estado |
|---|---|
| G-2/G-5 · capa HTTP + 0048-0050 viven solo en staging (runtime→PROD) | ⏳ transversal con salida a prod |
| G-3 · entrega real del webhook (envoltorio/headers/firma) vía webhook.site | ⏳ datos ✅, entrega pendiente |
| G-4 · ticket a soporte Clientify (firma/IPs/sandbox) | ⏳ redactado, pendiente envío |
| G-6 · routing por servicio/equipo (hoy least-loaded) | 🟡 mejora additiva |
| Webhook config en entorno real + `CLIENTIFY_WEBHOOK_SECRET` + cron `sync-contacts` | ⏳ con la salida a prod |

> La respuesta del ticket G-4 y la captura de entrega real se incorporan como **refinamientos additivos** (verificación HMAC / allowlist / ajuste de normalizador), sin reabrir lo construido.

---

## 7. Declaración de cierre

**El ciclo Clientify Inbound queda formalmente cerrado a nivel staging:** Comercial puede recibir un lead real de Clientify, verlo en la bandeja, deduplicado y asignado, calificarlo, promoverlo a oportunidad y operarlo con el Write-Path F2.1 — con un backbone de reconciliación que recupera webhooks perdidos. Producción / `main` / Netlify / Clientify PROD (escritura): **intactos**.

*Sin commits. Frente F2.2 (inbound) CERRADO.*
