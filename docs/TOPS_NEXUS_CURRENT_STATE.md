# TOPS_NEXUS_CURRENT_STATE — Auditoría CTO (estado real)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Autor:** CTO (auditoría estratégica)
**Base:** estado **real del repositorio** (git + archivos + staging), no afirmaciones de documentos.
**Alcance:** post CRM Comercial F2.1 + Clientify Inbound F2.2. Sin código, sin ramas, sin asumir.

---

## 0. Hallazgo dominante (leer primero)

> ### ⛔ Todo el trabajo de W-1…W-4 (Write-Path) y de F2.2 (Clientify Inbound) está **SIN COMMITEAR**.
> `HEAD = a76fff7` (último commit = *Capture Bridge*, 2026-06-06 04:41). Desde ahí:
> - **4 archivos modificados** sin commitear (`Opportunity360View.tsx`, `env.ts`, `crm-types.ts`, `webhook/route.ts`).
> - **~13 archivos fuente/migración NUEVOS untracked** (`stage-actions.ts`, `lead-actions.ts`, `leads-*.ts`, `clientify/webhook.ts`, `reconcile.ts`, rutas `webhook/[token]` y `sync-contacts`, bandeja `/comercial/leads`, migraciones **0047-0050**).
> - **~30 documentos** untracked.
>
> **Implicancia:** semanas de trabajo validado existen **solo en el working tree** — no en historial git, no en ningún commit, no pusheado. Un `git reset`/`checkout`/pérdida de disco = **pérdida total**. **Valor de negocio actual = 0** (nada commiteado, nada desplegado). Este es el riesgo #1 del proyecto hoy y condiciona toda recomendación.

---

## 1. Qué está TERMINADO (código existente y validado)

> "Terminado" = construido y validado en staging. **No** implica commiteado ni desplegado (ver §0 y §4).

| Frente | Evidencia real | Commit |
|---|---|---|
| Digital Twin Luján 3159 | rama `feature/mapa-premium-lujan-3159` @ `c1e4fb4` | ✅ commiteado |
| Digital Twin Magaldi 1765 | rama `feature/mapa-premium-magaldi-1765` @ `8f35e6a` | ✅ commiteado |
| Motor Capacidad + Dashboard | rama `feature/dashboard-vacancia-corporativo` @ `1f7d255` | ✅ commiteado |
| CRM dominio F2.1 (0041-0046, RLS, RBAC) + Ficha read-path + Capture Bridge | rama `feature/crm-comercial-f2-1` @ `a76fff7` | ✅ commiteado |
| **Write-Path F2.1 (W-1…W-4): 0047 + stage-actions + Ficha operativa** | archivos presentes · 29/29 staging | ⛔ **sin commitear** |
| **Clientify Inbound F2.2 (ingest/webhook/bandeja/promoción/reconciliación): 0048-0050 + rutas + UI** | archivos presentes · 66/66 staging | ⛔ **sin commitear** |

---

## 2. Qué está OPERATIVO (corriendo / en vivo)

| Capa | ¿Operativo? |
|---|---|
| Infra base (Supabase PROD, GitHub, Backup→Drive) | 🟢 **Sí** (productiva, previa a esta iniciativa) |
| Digital Twins / Capacidad / Dashboard | ⚪ **No** — en ramas, sin desplegar |
| CRM Comercial (read + write path) | ⚪ **No** — sin commitear/desplegar; el runtime apunta a **Supabase PROD que NO tiene `crm_*`** → cae a muestra local (RA-1) |
| Clientify Inbound (webhook/bandeja/pull) | ⚪ **No** — sin desplegar; webhook sin configurar en Clientify; sin `CLIENTIFY_WEBHOOK_SECRET` en prod |

> **Nada del aparato comercial está operativo en vivo.** La operación logística previa sí, sin impacto de este trabajo.

---

## 3. Qué está VALIDADO

| Validación | Resultado | Dónde |
|---|---|---|
| CRM dominio (0041-0046) | 46/46 | staging |
| Write-Path 0047 (W-1) | 29/29 | staging |
| W-2 contrato action↔RPC | 9/9 | staging |
| W-4 lazo de vacancia | 12/12 | staging |
| F2.2-1 ingesta | 16/16 | staging |
| F2.2-2 webhook (unit+integración) | 19/19 | staging |
| F2.2-3 bandeja (DB) | 7/7 | staging |
| F2.2-4 promoción | 14/14 | staging |
| F2.2-5 reconciliación | 10/10 | staging |
| Forma de datos Clientify | confirmada (read-only real) | Clientify PROD (lectura) |

**Total ≈ 162 asserts en staging, 0 fallos.** Toda la validación es **en staging** (`vrxosunxlhohmqymxots`); **nada validado en PROD ni en deploy**. La capa HTTP de las rutas Next nunca se ejerció contra staging (runtime→PROD; sin claves supabase-js de staging) — cubierta por build + lógica.

---

## 4. Qué sigue siendo DISEÑO (no construido)

| Ítem | Estado |
|---|---|
| **Clientify Outbound** (Nexus→Clientify: mover etapa, cerrar deal) | Diseñado (arquitectura), **no construido**. Requiere consolidar el cliente de escritura huérfano (T-1). |
| **Mirror deals→oportunidades** (`sync-deals` con persistencia) | Pull existe sin persistir; diseño asociado a outbound. |
| **Reconciliación seed Digital Twin** (D/S → PB reales · RA-4) | Documentado, **no ejecutado**. La "vacancia oficial" del seed ≠ realidad auditada. |
| **Routing de owner por servicio/equipo** | Solo least-loaded; falta tabla equipo→usuario. |
| **Portal cliente / KPIs ejecutivos en vivo** (Fase E) | Diseño/future. |
| **Camino a producción** (aplicar 0041-0050 a PROD + merge + deploy + smoke) | No iniciado. |

---

## 5. Riesgos abiertos (priorizados, estado real)

| # | Riesgo | Sev. |
|---|---|---|
| **CR-1** | **Trabajo W-1…F2.2 sin commitear** → pérdida total ante cualquier `reset`/disco. Valor = 0 hasta commitear+desplegar. | 🔴 Crítica |
| **CR-2** | **`main` local (`c3fb359`) diverge de `origin/main` (`7d74aa3`)** → la integración debe partir del remoto real, no del hash local. Riesgo de merge sorpresa. | 🟠 Alta |
| RA-1 | App runtime → Supabase PROD sin `crm_*`; todo el CRM cae a fallback local. | 🟠 Alta (resuelve al desplegar a un entorno con `crm_*`) |
| RA-2 | 5+ ramas aisladas sin estrategia de merge ejecutada. | 🟠 Media |
| RA-4 | Seed Digital Twin desalineado de la realidad (vacancia "oficial"). | 🟠 Media |
| G-2…G-6 | Gates pre-prod Clientify (entrega real, ticket soporte, config webhook/cron). | 🟡 Baja-Media |
| RA-6 | Nada probado en deploy (Netlify). | 🟠 Media |

---

## 6. Lectura ejecutiva (CTO)

El proyecto tiene un **activo enorme y validado** (CRM + capacidad + Clientify inbound, ~162 tests verdes) **inmovilizado en dos formas**: (a) **sin commitear** (riesgo de pérdida, valor cero) y (b) **sin desplegar** (no monetiza la vacancia comercializable de ~3.770 m² / ≈38%). La brecha del proyecto **no es construir más**, es **consolidar y poner en vivo lo ya construido**. Ver `TOPS_NEXUS_NEXT_PHASES.md` y `TOPS_NEXUS_PRIORITY_MATRIX.md`.

*Auditoría basada en el estado real del repositorio al 2026-06-06. Sin código, sin ramas, sin supuestos.*
