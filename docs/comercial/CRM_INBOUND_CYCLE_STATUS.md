# CRM_INBOUND_CYCLE_STATUS — Evaluación del ciclo inbound (post F2.2-4)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Propósito:** evaluar el estado global del ciclo inbound Clientify → Nexus antes de decidir F2.2-5.

---

## 1. El ciclo inbound, de punta a punta

```
Clientify ─webhook(token-en-URL)─► crm_ingest_lead ─► crm_leads ─► Bandeja /comercial/leads
   (F2.2-2)                          (F2.2-1)                        (F2.2-3: filtros, ownership,
                                                                      dedup, reasignación, calificación)
                                                                              │  "Promover"
                                                                              ▼
                                                          crm_promote_lead ─► crm_opportunities ─► Write-Path F2.1
                                                          (F2.2-4)            (estado=calificado)   (advance/reserve/…)
```

---

## 2. Estado por sub-fase

| Sub-fase | Entregable | Validación staging | Estado |
|---|---|---|---|
| **F2.2-0** | Infra (auth research, env, consolidación specced) | — | ✅ cerrado |
| **F2.2-1** | RPC `crm_ingest_lead` (dedup, least-loaded, log) | 16/16 | ✅ cerrado |
| **F2.2-2** | Handler webhook token-en-URL + normalización | 19/19 | ✅ cerrado |
| **F2.2-3** | Bandeja de leads (UI) | 7/7 + build | ✅ cerrado |
| **F2.2-4** | RPC `crm_promote_lead` + action | 14/14 | ✅ cerrado |

**Total validado:** 56 asserts en staging, 0 fallos. tsc/lint/build verdes en cada UI.

---

## 3. Lo que funciona (validado)

- **Ingesta resiliente:** webhook autenticado por token → normalización defensiva → upsert idempotente → dedup de persona (clientify_id/email/phone, conflicto→crear+marcar) → owner least-loaded → `clientify_sync_log`.
- **Operación comercial:** la bandeja lista leads reales, filtra, muestra owner y posibles duplicados, reasigna y califica bajo RLS.
- **Promoción:** lead calificado → oportunidad (`calificado`) con herencias completas + enlace a `clients` por CUIT + `stage_history` inicial, idempotente y con guardas. De ahí toma el Write-Path F2.1 ya validado (W-1…W-4).

> El dominio inbound está **completo a nivel lógico y validado en staging** de Clientify-edge hasta el handoff al Write-Path.

---

## 4. Brechas abiertas (honestas)

| # | Brecha | Severidad | Nota |
|---|---|---|---|
| **G-1** | ~~Glue de UI de promoción~~ → **CERRADA.** La bandeja ya tiene el botón **"Promover"** (leads `calificado`) con mini-form de `service_type` (+ m² opc.) → `promoteLead` → redirige a la Ficha 360°. tsc/lint/build verdes. | ✅ Resuelta | El ciclo inbound es **clickable end-to-end** desde la UI. |
| **G-2** | **Capa HTTP nunca ejercida contra staging:** runtime apunta a **PROD** (sin `crm_*`/0048-0050) y no hay claves supabase-js de staging; rutas auth-gated. Todo validado a nivel RPC/DB + build + unit. | 🟠 Media | El verdadero E2E (Clientify→webhook vivo→DB con `crm_*`) depende de la decisión de salida. |
| **G-3** | **Forma de datos confirmada contra Clientify real** (GET read-only autorizado, PII redactada → `clientify-contact-REAL.json`). Harness **8/8**, paridad sin brechas; hallazgo: `company_name` real (ya mapeado). **Remanente:** envoltorio/headers de la **entrega** del webhook (firma) → captura webhook.site (runbook) + ticket. | 🟢 Datos cerrado · 🟡 entrega pendiente | `CLIENTIFY_PAYLOAD_CAPTURE_RUNBOOK.md` |
| **G-4** | **Ticket a soporte Clientify redactado y listo para enviar** (firma/IPs/sandbox/payload). Pendiente: envío + registro de respuestas. | 🟢 Redactado · ⏳ envío | `CLIENTIFY_SUPPORT_TICKET.md` |
| **G-5** | **0048-0050 solo en staging.** El stack inbound no está en la base que usa la app. | 🟠 Media | Transversal con la decisión de salida a producción. |
| **G-6** | **Routing por servicio/equipo** sigue siendo least-loaded (no hay tabla equipo→usuario). | 🟡 Baja | Mejora additiva futura. |

---

## 5. Recomendación antes de F2.2-5

**Cerrar G-1 primero (glue de UI de promoción) — pequeño y cierra el lazo clickable**:
- Botón "Promover a oportunidad" en la bandeja para leads `calificado`, con un mini-form de `service_type` (+ m²/depósito opcionales) → `promoteLead` → redirige a la Ficha 360°.
- Con eso, Comercial puede ejecutar **todo el ciclo inbound desde la UI**: ver lead entrante → calificar → promover → operar en la Ficha.

**Luego F2.2-5 (pull de reconciliación)** agrega resiliencia (backbone ante webhook perdido/duplicado), que es valioso pero **no bloquea** el ciclo (el webhook ya ingiere).

**Gates pre-producción** (independientes, no bloquean el avance en staging): capturar payload real (G-3), ticket a soporte Clientify (G-4), y la decisión de aplicar 0048-0050 + configurar webhook en el entorno productivo (G-2/G-5).

> **Veredicto:** el ciclo inbound está **lógicamente completo y validado en staging**. Falta una **glue de UI pequeña (G-1)** para que sea operable end-to-end por Comercial, y los **gates de salida** (entorno real + payload + soporte). Recomiendo G-1 → F2.2-5.
