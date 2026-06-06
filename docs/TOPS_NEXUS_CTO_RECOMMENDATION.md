# TOPS_NEXUS_CTO_RECOMMENDATION — Recomendación única (30 días)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Autor:** CTO
**Base:** estado real del repositorio (`TOPS_NEXUS_CURRENT_STATE.md`).

---

## Pregunta

> *Si solo pudiéramos ejecutar UN frente más durante los próximos 30 días, ¿cuál debería ser?*

## Respuesta

> # 🎯 SALIDA A PRODUCCIÓN del stack comercial ya validado
> **(CRM Comercial F2.1 + Clientify Inbound F2.2), con la consolidación git como Paso 0 inmediato.**

No construir nada nuevo. **Poner en vivo lo que ya está construido y validado.**

---

## Por qué (justificación, basada en el repo)

1. **El valor ya está construido, pero rinde cero.** Hay ~**162 asserts verdes en staging** (CRM dominio, write-path, lazo de vacancia, ingesta, webhook, bandeja, promoción, reconciliación). Nada de eso genera valor: **no está commiteado y no está desplegado**. El cuello de botella del proyecto es de **entrega**, no de ingeniería.

2. **Hay dinero ocioso esperando este sistema.** El propio aparato comercial existe para monetizar ~**3.770 m² comercializables (≈38% de vacancia) + coworking 100%**. Cada mes sin el CRM en vivo es capacidad vendible gestionada sin la herramienta que se construyó para venderla.

3. **Riesgo existencial sobre el activo (CR-1).** Todo W-1…W-4 y F2.2 está **sin commitear** (`HEAD=a76fff7`). Un `reset`/pérdida de disco borra semanas de trabajo validado. Salir a producción **obliga** a commitear, integrar y respaldar — convirtiendo un activo frágil en uno durable.

4. **Construir más agrava el problema.** Outbound (P3), portal (P6) o routing por equipo (P5) **aumentan el inventario de valor dormido** sin realizar ninguno. La disciplina correcta es **cerrar el lazo construido → vivo** antes de abrir lazos nuevos.

5. **El camino está definido y es reversible.** El roadmap ya fija los **criterios de salida** (validación verde, merge decidido, seed reconciliado, autorización, smoke, rollback). El backup **Supabase→Drive es productivo** → hay plan de rollback. El único bloqueante real es una **decisión de Dirección**, no una incógnita técnica.

6. **Es alcanzable en 30 días.** Con foco: Paso 0 consolidación (horas) → merge de ramas + reconciliar `main` (CR-2) → aplicar 0041-0050 a PROD con autorización → deploy Netlify → smoke → configurar webhook Clientify + `CLIENTIFY_WEBHOOK_SECRET` + cron `sync-contacts`. **P2 (seed Twin)** y **P4 (gates Clientify)** corren en paralelo como soporte.

---

## Qué NO recomiendo (y por qué)

- **Outbound Clientify (P3):** alto valor, pero **secundario al inbound ya cerrado** y agrega esfuerzo (consolidar T-1 + sandbox) sin desbloquear ingreso. Después de estar en vivo.
- **Portal / KPIs en vivo (P6):** depende de tener el CRM en producción.
- **Owner routing por equipo (P5):** bajo impacto; least-loaded ya es justo.

---

## Condición innegociable (Paso 0, dentro de las restricciones actuales)

**Commitear de inmediato** todo el trabajo W-1…F2.2 en `feature/crm-comercial-f2-1` y **reconciliar `main` local↔`origin/main`**. Esto **no** toca `main`, ni produce merge, ni despliega — respeta las restricciones vigentes — y elimina el riesgo crítico CR-1 hoy, antes incluso de pedir la autorización de salida.

---

## En una línea

> **El proyecto no necesita más código; necesita que el código validado deje de ser invisible (commit) e inútil (deploy). Un solo frente en 30 días: ponerlo en producción.**

*Recomendación de auditoría. No construir, no programar, no asumir. Decisión de salida a producción sujeta a autorización de Dirección.*
