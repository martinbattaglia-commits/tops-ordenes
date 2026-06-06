# TOPS_NEXUS_NEXT_PHASES — Ranking de próximos frentes (CTO)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Base:** estado real del repositorio (ver `TOPS_NEXUS_CURRENT_STATE.md`).

> Premisa CTO: la brecha del proyecto **no es construir más** sino **consolidar y poner en vivo** lo ya construido y validado. El ranking lo refleja.

---

## 1. Frentes candidatos (estado real)

| ID | Frente | Qué es |
|---|---|---|
| **P0** | **Consolidación git** | Commitear W-1…W-4 + F2.2 (hoy sin commitear) · reconciliar `main` local↔`origin/main` · ordenar ramas. |
| **P1** | **Salida a Producción** del stack comercial | Estrategia de merge a `main` · aplicar 0041-0050 a Supabase PROD (con autorización) · deploy Netlify · smoke · config Clientify webhook+secret+cron · plan de rollback. |
| **P2** | **Reconciliación seed Digital Twin** (RA-4) | Alinear códigos D/S provisionales → PB reales para que la vacancia "oficial" = realidad auditada. |
| **P3** | **Clientify Outbound** (F2.2-6/F2.4) | Nexus→Clientify (mover etapa, cerrar deal). Requiere consolidar cliente de escritura (T-1) + sandbox. |
| **P4** | **Cierre de gates pre-prod Clientify** (G-3/G-4) | Captura de entrega real (webhook.site) + ticket soporte + refinamiento HMAC/allowlist si aplica. |
| **P5** | **Owner routing por servicio/equipo** | Tabla equipo→usuario + regla por servicio (hoy least-loaded). |
| **P6** | **Portal cliente / KPIs ejecutivos en vivo** (Fase E) | Producto nuevo sobre el CRM ya operativo. |

> Existen además ramas en vuelo no comerciales (`feature/arca-production-fase-e`, `feature/nexus-fullstack`, `feature/ui-redesign`) — fuera del foco de este review, pero a integrar en la estrategia de `main`.

---

## 2. Ranking (mayor a menor valor estratégico)

| # | Frente | Impacto negocio | Complejidad técnica | Notas |
|---|---|---|---|---|
| **1** | **P0 · Consolidación git** | **Alto** (protege todo el activo; valor=0 mientras siga sin commitear) | **Muy baja** | Dentro de las restricciones (no toca main/prod/deploy). Inmediato. |
| **2** | **P1 · Salida a Producción** | **Muy alto** (convierte ~162 tests verdes en capacidad real de vender los ~3.770 m² ociosos) | **Alta** (merge 5 ramas, 10 migraciones a PROD, deploy, smoke, cutover, rollback) | Requiere **autorización de Dirección** (gate, no técnico). Depende de P0. |
| **3** | **P2 · Reconciliación seed Twin** | **Alto** (la vacancia que se muestra/vende debe ser la real; hoy el seed miente) | **Media** | Independiente; mejora la confianza del dato. |
| **4** | **P4 · Cierre gates Clientify** | **Medio** (de-risk del inbound antes de vivo) | **Baja** | Mayormente acción externa (ticket + captura). |
| **5** | **P3 · Clientify Outbound** | **Alto** (cierra bidireccional; sincroniza Clientify con la verdad de Nexus) | **Alta** (consolidar T-1, sandbox, mapeo de etapas dinámicas) | Mejor **después** de estar en vivo (inbound). |
| **6** | **P5 · Owner routing por equipo** | **Bajo** (mejora de reparto; least-loaded ya es justo) | **Baja** | Oportunista. |
| **7** | **P6 · Portal cliente / KPIs vivo** | **Alto a futuro** | **Alta** | Requiere el CRM ya en producción y maduro. |

---

## 3. Impacto de negocio (detalle)

- **P1 (producción)** es el único frente que **genera valor monetizable**: hoy hay capacidad ociosa comercializable (~3.770 m², ≈38% + coworking 100%) y un sistema comercial completo **dormido**. Mientras no esté en vivo, el ROI de todo lo construido es **cero**.
- **P0** no genera valor por sí solo pero **es precondición** y **elimina el riesgo de perderlo todo**.
- **P2** protege la **credibilidad del dato** que se usará para vender (no vender lo que no hay / no perder lo que sí).
- **P3 (outbound)** evita que Clientify y Nexus diverjan una vez operando — valioso pero **secundario al inbound ya cerrado**.

---

## 4. Complejidad técnica (detalle)

- **P0:** trivial (commits en rama de feature). Riesgo casi nulo.
- **P1:** alta — toca PROD (migraciones), merge multi-rama (con `main` divergente CR-2), deploy y cutover de auth/runtime. Reversible con backup Supabase→Drive (ya productivo).
- **P2:** media — reconciliar seed vs realidad auditada; sin tocar el motor (usa capa local).
- **P3:** alta — consolidar el cliente de escritura huérfano (T-1), mapeo de etapas dinámicas de Clientify, requiere sandbox para no tocar Clientify PROD en escritura.
- **P4/P5:** baja.

---

## 5. Dependencias entre frentes

```
P0 (consolidación git)
   └─► P1 (producción)  ──┬─► P3 (outbound, mejor con inbound ya en vivo)
                          └─► P6 (portal/KPIs en vivo)
P2 (seed Twin) ──► precondición de "vacancia oficial" confiable en P1 (puede ir en paralelo)
P4 (gates Clientify) ──► precondición de calidad del inbound en P1 (acción externa, en paralelo)
P5 ── independiente (oportunista)
```

- **P0 bloquea todo** (no se integra/despliega lo que no está commiteado).
- **P1 depende de P0** y de la **autorización de Dirección** (CR-2 + criterios de salida del roadmap).
- **P2 y P4** son **paralelizables** y conviene cerrarlos **antes o junto con P1** (dato confiable + inbound de-riskeado).
- **P3 y P6 dependen de P1** (estar en vivo).

> Conclusión del ranking: **P0 ya (inmediato, sin fricción), P1 como el gran frente de los próximos 30 días** (con P2/P4 en paralelo como soporte). Ver matriz y recomendación única.
