# TOPS NEXUS — PRODUCTION READINESS REPORT (Gate 5.5)

> Estado de preparación productiva tras la auditoría de seguridad (`SECURITY_HARDENING_AUDIT.md`) y el plan
> (`SECURITY_REMEDIATION_PLAN.md`). Fecha: 2026-06-04. Solo seguridad/producción.

---

## 1. Score final

> ## 🟠 PRODUCTION READINESS: **62 / 100 — NO LISTO (condicional)**

El **núcleo funcional (WMS + Custodia) está validado E2E con integridad sólida** (ledger append-only,
hash-chain, egreso irreversible, RPC con `current_role()`). Lo que impide producción es **un gap de PII en
RLS**, **autorización inconsistente en `/settings/*`** y, sobre todo, **infraestructura sin red de recuperación**
(DEV/PROD misma DB, PITR off, sin backup de Storage).

| Dimensión | Peso | Score | Nota |
|---|---|---|---|
| Autenticación (middleware) | 15 | 14 | Fail-safe; públicas acotadas. Sin capa de rol en middleware (aceptable). |
| Autorización / guards | 20 | 11 | users/fiscal OK; `/settings/roles*` (F-04) y centros-costo (F-05) sin guard; label engañoso (F-06). |
| Protección de PII | 15 | 7 | F-01-R: RLS `profiles` deja a todo staff leer emails. |
| Integridad de datos (WMS/Custody) | 20 | 19 | Excelente: append-only, hash-chain, RPC SECURITY DEFINER, validado E2E. |
| RBAC | 10 | 5 | Dormido/no aplicado + fail-open (F-02). Modelo de 4 roles sí opera. |
| Recuperación / Infra | 15 | 4 | F-03: DEV/PROD misma DB, PITR off, sin backup de Storage. |
| Webhooks / integraciones | 5 | 2 | S-05: sin HMAC. |
| **Total** | **100** | **62** | |

---

## 2. Riesgos

### Abiertos (bloqueantes)
| # | Riesgo | Sev | Tipo |
|---|---|---|---|
| F-01-R | PII de usuarios (emails/roles) legible por todo staff vía RLS `profiles` | P0 | Datos/PII |
| F-03 | DEV/PROD misma DB + PITR off + sin backup de Storage | P0 | Infra/recuperación |
| F-04 | `/settings/roles*` sin guard de rol (latente; se activa al aplicar 0009) | P1 | Access control |

### Abiertos (no bloqueantes)
| # | Riesgo | Sev |
|---|---|---|
| F-05 | `/settings/centros-costo` sin guard de rol (page+mutación) | P2 |
| F-02 | RBAC granular dormido + `checkPermission` fail-open | P2 |
| F-06 | Etiqueta de rol del shell desde `user_metadata` (engañosa) | P2 |
| S-05 | Webhooks Clientify/WhatsApp sin verificación HMAC | P2 |
| B6 | Política legal de retención de custodia (tentativa) | P2 |

### Cerrados / verificados OK (no son riesgo)
- ✅ **F-01 (reportado) refutado:** `/settings/users` page + `inviteUser` action guardan admin server-side.
- ✅ Middleware bloquea rutas privadas sin sesión (401/redirect).
- ✅ WMS/Custody: mutaciones solo por RPC SECURITY DEFINER; ledger/custody inmutables; egreso/hash-chain validados E2E.
- ✅ Custody PII (`custody-pii`) gateada admin/supervisor; binarios solo por signed URL auditado.
- ✅ `checkPermission` no usa service-role para autorizar (solo seed-count head).

---

## 3. Backup strategy (propuesta)

- **DB:** habilitar **PITR** en el proyecto Supabase de prod (hoy off). Mientras tanto, **dump diario** (`pg_dump`/Supabase scheduled backup) retenido ≥30 días + backup manual previo a cada migración (ya es práctica).
- **Storage (custody):** export/replicación periódica de `custody-evidence` / `custody-pii` / `custody-pod` (no cubierto por backup de DB). Definir destino inmutable + retención por bucket (alinear con B6 legal). **Pendiente (B3).**
- **Verificación de restore:** prueba de restauración trimestral (RTO/RPO documentados).

## 4. PITR
- **Estado actual:** **OFF.** Sin recuperación a punto en el tiempo ante egreso/erasure/borrado erróneo.
- **Recomendación:** activar PITR (ventana ≥7 días) antes de operar con datos reales. `revert_dispatch` cubre solo despachos no entregados — no sustituye PITR.

## 5. Separación DEV/PROD
- **Estado actual:** `.env.local` → Supabase de **producción** (`arsksytgdnzukbmfgkju`); el QA E2E escribió datos reales en prod (fixtures `TEST_QA_E2E` quedaron persistidos).
- **Recomendación:** proyecto Supabase **separado** para DEV/preview (o branch DB), con seed propio. Prohibir apuntar `dev` a prod. Hasta entonces, todo QA debe usar kits `BEGIN/ROLLBACK` 0-footprint y evitar flujos terminales (entrega) en prod.

---

## 6. Camino a "LISTO"

| Hito | Cierra | Sube score a ~ |
|---|---|---|
| Aplicar P0.2 (guard roles) + P1.1 (label) + P1.2 (centros-costo) — code-only | F-04, F-06, F-05 | ~74 |
| Aplicar P0.1 (RLS `profiles` → admin) — migración (Martín) | F-01-R | ~82 |
| Resolver P0.3 (DEV/PROD + PITR + backup Storage) — infra | F-03 | ~93 |
| P1.3 (decisión RBAC) + S-05 (HMAC) | F-02, S-05 | ~98 |

> **Veredicto:** **NO LISTO** hasta cerrar F-01-R y F-03 (P0). Los fixes code-only (P0.2/P1.1/P1.2) están
> listos para aplicar con bajo riesgo y suben el score de inmediato; la RLS y la infra requieren OK + ejecución
> por Martín. El núcleo WMS/Custodia no es el problema — lo es la capa de acceso a configuración + la infra.

---

> **FIN — Production Readiness Report.**
