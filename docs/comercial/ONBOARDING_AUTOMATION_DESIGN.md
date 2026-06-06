# ONBOARDING_AUTOMATION_DESIGN

**Módulo:** CRM Comercial — Automatización de Onboarding
**Fase:** 1 — Diseño (sin código)
**Fecha:** 2026-06-04
**Relacionado:** [MASTER_PLAN](./COMMERCIAL_MODULE_MASTER_PLAN.md) · [DATA_MODEL](./CLIENTIFY_NEXUS_DATA_MODEL.md) · [PIPELINE](./COMMERCIAL_PIPELINE_DESIGN.md) · [KPI](./COMMERCIAL_KPI_DASHBOARD.md)

> **Estado actual:** no existe ningún flujo ni tabla de onboarding. Lo que sí existe es el backbone operativo al que el onboarding hace handoff: `clients` (con `activo boolean`, `0004`), `orders` (OS), `logistics_orders` (PED, `0030`), la cadena de custodia (`custody_*`, `0036-0039`) y `documents` (con tipos `'contrato'`/`'presupuesto'`, `0010`). El onboarding es el **puente automatizado** entre "deal Ganado" y "cliente operando".

---

## 1. Objetivo

Cuando una oportunidad pasa a **Ganado** (contrato firmado), disparar automáticamente:

1. **Alta del cliente activo** (`clients.activo = true`).
2. **Creación del checklist de onboarding** con tareas estándar: RNE, croquis, plancheta, accesos, documentación.
3. **Handoff a operación** (preparar al cliente para WMS / pedidos / facturación).
4. **Notificación** a los responsables (operaciones, comercial).

Que el equipo no tenga que crear nada a mano: pasar a Ganado **es** iniciar el onboarding.

---

## 2. Disparador (trigger)

```
crm_opportunities.estado: 'negociacion' → 'ganado'
        │ (server action de transición, ver PIPELINE §5.3)
        │  guarda: crm_contracts.status = 'firmado'
        ▼
  [ TRANSACCIÓN ]
    1. crm_opportunities.actual_close = today, probabilidad = 100
    2. insert crm_stage_history (to_stage='ganado')
    3. clients.activo = true                       (alta cliente)
    4. insert crm_onboarding (status='pendiente')
    5. insert crm_onboarding_tasks  (las 5 tareas estándar)
    6. outbound: cerrar Deal Clientify (status=2 Won)
    7. notificar (operaciones + owner)
        ▼
  /comercial/onboarding/[id]  (checklist activo)
```

**Implementación:** server action transaccional en la capa app (patrón del repo, no trigger de DB puro) para poder orquestar el sync outbound a Clientify y las notificaciones, que requieren llamadas de red fuera de Postgres. La parte de DB (pasos 1–5) va en una transacción; los pasos 6–7 son best-effort post-commit con reintento (estilo `projectToSupabase` no-bloqueante en `clients.ts`).

---

## 3. Checklist estándar (`crm_onboarding_tasks`)

Las 5 tareas que pide el handoff maestro, más metadata de responsable y documento:

| `tipo` | Título | Responsable sugerido | Documento esperado | Bloqueante para operar |
|---|---|---|---|---|
| `rne` | Registro Nacional de Establecimiento (RNE) | Comercial / Cliente | Certificado RNE → `documents` | Sí (ANMAT) |
| `croquis` | Croquis del depósito / layout asignado | Operaciones | Plano/croquis → `documents` | Sí |
| `plancheta` | Plancheta de habilitación | Operaciones | Plancheta → `documents` | Sí (ANMAT) |
| `accesos` | Alta de accesos (usuarios Nexus, portal cliente) | Admin / RBAC | — (alta en `profiles`/`user_roles`) | No |
| `documentacion` | Documentación contractual y fiscal completa | Comercial | Contrato firmado, datos fiscales | Sí |

**Reglas por tipo de servicio:**
- `service_type='anmat'` → RNE y plancheta son **obligatorias** (regulatorio).
- `service_type='general'` → RNE/plancheta pueden marcarse `na` (no aplica).
- `service_type='oficinas'` → checklist reducido (accesos + documentación).

El checklist se genera filtrando las tareas según `crm_opportunities.service_type`.

---

## 4. Estados y progreso

### 4.1 Onboarding (`crm_onboarding.status`)
| Estado | Significado |
|---|---|
| `pendiente` | creado, sin tareas iniciadas |
| `en_curso` | al menos una tarea iniciada |
| `bloqueado` | una tarea bloqueante vencida o trabada |
| `completado` | todas las tareas bloqueantes en `completado`/`na` |

`progress_pct` = tareas completadas / tareas aplicables × 100. Se recalcula en cada cambio de tarea (trigger o en la server action).

### 4.2 Tarea (`crm_onboarding_tasks.status`)
`pendiente → en_curso → completado`, o `na` (no aplica). `completado` exige `document_id` cuando el tipo espera documento (RNE, croquis, plancheta).

---

## 5. Handoff a operación

Al completar el onboarding (todas las bloqueantes ok):

```
crm_onboarding.status = 'completado'
        ▼
  - clients.activo = true (ya hecho en el trigger; se confirma)
  - cliente habilitado para:
      · WMS (recepciones, inventario, picking, packing, despacho)
      · Pedidos (logistics_orders / PED)
      · Órdenes de servicio (orders / OS)
      · Facturación (ARCA, ya productivo)
  - (opcional) crear primera OS/PED "de arranque" si el contrato lo define
```

**No se crea infraestructura WMS automáticamente** (cubículos, ubicaciones) — eso queda como tarea operativa manual referenciada desde el checklist (`croquis`/`plancheta`), porque depende del relevamiento físico (`0023_lujan_cubiculos`, `0020_wms_physical_model`).

---

## 6. Documentación (integración con `documents`)

- Cada tarea con documento referencia `documents.id` (FK `crm_onboarding_tasks.document_id`).
- Se reutilizan los tipos de `document_type_t` (`0010:22-34`): `'contrato'`, `'presupuesto'`; se sugiere agregar valores `'rne'`, `'croquis'`, `'plancheta'` al enum vía migración de seed (patrón `0021`).
- El almacenamiento sigue el patrón existente de `documents` (blobs + auditoría `documents_audit`, RLS multi-tenant por `client_id`).
- Los PDFs de contrato/propuesta ya generados (hoy `window.print()`) se persisten como documentos al cerrar el deal — cerrando el lazo que hoy queda en localStorage.

---

## 7. Notificaciones

Reutilizar la infraestructura existente:
- **Email:** `src/lib/email.ts` (ya usado por compras).
- **WhatsApp:** `api/whatsapp/send` (ya existe, `ping`/`send`/`webhook`).
- Destinatarios: owner comercial + rol `operaciones`. Evento: "Onboarding iniciado para {cliente}".

> Respetar PII: no exponer emails de terceros; usar `profiles_public` para resolver nombres (mandato `0040`).

---

## 8. Diagrama de secuencia (Ganado → Operando)

```
Vendedor          Nexus (server action)      Supabase            Clientify     Operaciones
   │  pasa a Ganado     │                        │                   │              │
   │───────────────────►│                        │                   │              │
   │                    │ valida contrato firmado│                   │              │
   │                    │───── BEGIN tx ─────────►│                   │              │
   │                    │  activo=true            │                   │              │
   │                    │  crm_onboarding + tasks │                   │              │
   │                    │◄──── COMMIT ────────────│                   │              │
   │                    │ cerrar Deal (Won) ──────┼──────────────────►│              │
   │                    │ notificar ──────────────┼───────────────────┼─────────────►│
   │◄── onboarding id ──│                         │                   │              │
   │                    │                         │                   │   completa checklist
   │                    │◄── update task ─────────│◄──────────────────┼──────────────│
   │                    │ recalcula progress      │                   │              │
   │                    │ si 100% → cliente operativo (WMS/PED/OS/ARCA habilitados)  │
```

---

## 9. Brechas y orden

| Brecha | Fase |
|---|---|
| `crm_onboarding` + `crm_onboarding_tasks` | F2.1 |
| Server action transaccional de "Ganado" | F2.6 |
| Valores de enum `documents` para rne/croquis/plancheta | F2.6 |
| Notificaciones email/WhatsApp del onboarding | F2.6 |
| (Opcional) creación de OS/PED de arranque | F2.6+ |

---

## 10. Criterios de aceptación (cuando se construya)

1. Pasar una oportunidad a Ganado crea el onboarding y las tareas aplicables en una sola acción.
2. El cliente queda `activo=true` automáticamente.
3. El Deal se cierra como Won en Clientify (idempotente).
4. ANMAT exige RNE+plancheta; General las marca `na`.
5. `progress_pct` refleja el avance real y bloquea la marca de "completado" si falta una bloqueante.
6. Ningún paso toca PROD/Netlify/Supabase PROD sin autorización (restricción del handoff maestro).
