# RELEASE-CLOSURE — TOPS NEXUS 1.0

| Campo | Valor |
|---|---|
| **Fecha** | 2026-06-08 |
| **Commit productivo** | `70a9944` (merge RC release + login PR #13) sobre `main` |
| **`origin/main` == HEAD** | ✅ SÍ (`70a9944`) — código del release en `main` |
| **RC base** | `1430204` (feat(release): RC TOPS NEXUS) |
| **URL productiva** | https://tops-ordenes.netlify.app |
| **Build local del árbol mergeado** | ✅ tsc PASS · lint PASS · `next build` PASS (119 rutas) |

---

## Estado del release

### ✅ Verificado por el asistente (hechos)
- **Git:** `main` (`origin/main`) actualizado a `70a9944`. Push fast-forward `86b54ca..70a9944` ejecutado.
- **Integridad del merge:** la modernización del login (PR #13) que estaba en `main` quedó **integrada sin conflictos**; nada se perdió.
- **Build del árbol final:** tsc + lint + build verdes localmente (119 rutas, `/login` compila, solo 5 warnings cosméticos de a11y en PDFs).
- **Infra productiva alcanzable:** `tops-ordenes.netlify.app` responde vía Netlify; el auth gate funciona correctamente:
  - `/` → 307 → `/login`
  - `/login` → **200**
  - `/comercial/oportunidades` → 307 → `/login`

### ⏳ Pendiente de confirmación del usuario (no verificable por el asistente)
> El asistente **no tiene acceso al dashboard de Netlify ni sesión autenticada de prod** (todas las rutas internas hacen 307 a login). Por honestidad, estos ítems **no** se declaran PASS hasta tu confirmación.

- [ ] **Netlify = Published** para el commit `70a9944` (confirmar en el dashboard; el build se disparó con el push).
- [ ] **Smoke test autenticado** (login real en prod) — marcar cada uno:

| Módulo / verificación | Resultado (usuario) |
|---|---|
| Acceso / Login | ☐ |
| Navegación (sidebar 59 links) | ☐ |
| CRM360 — Kanban por defecto | ☐ |
| CRM360 — Búsqueda en vivo | ☐ |
| CRM360 — Contratos por servicio + estado documental | ☐ |
| CRM360 — Títulos sin URL de API | ☐ |
| Digital Twin — Magaldi / Luján (color desde crm_units) | ☐ |
| Digital Twin — Deep links (precarga unidad) | ☐ |
| Reservas — atómica (2º intento → "Unidad ya reservada") | ☐ |
| RRHH — empleados / documentos / recibos | ☐ |
| Compliance — score / fichas / navegación | ☐ |
| Drive — carpetas / búsqueda / root correcto | ☐ |
| Facturación — pendientes / emitidos / KPIs | ☐ |

---

## Hallazgos remanentes (no bloqueantes)
1. **Rama remota divergente:** `origin/claude/gracious-pasteur-6efdde` quedó con 4 commits viejos de RRHH (SHAs distintos, de un worktree paralelo). No se tocó; no afecta prod (se pusheó directo a `main`). → limpieza opcional.
2. **Migración 0069 (`clientify_deal_name`):** opcional, **no aplicada**. El front degrada con fallback comercial (nunca URL). Aplicar + sumar al SELECT + poblar en sync = trabajo 1.1.
3. **5 warnings a11y** `jsx-a11y/alt-text` en `<Image>` de `@react-pdf/renderer` (falso positivo; no DOM).
4. **Clientify API key (runtime prod):** verificar que la key de Netlify sea válida (el token del MCP dio 401 en sesión; es independiente).
5. **Conteos antes/después del filtro de pipelines:** pendiente SQL read-only (CRM360-KANBAN-DEFAULT-REPORT.md).

---

## Backlog 1.1 (post-release)
- Aplicar 0069 + exponer `clientify_deal_name` en SELECT + poblar `name` del Deal en el sync → mostrar nombre real del deal.
- Silenciar a11y de react-pdf en `.eslintrc` (override para `src/lib/compras/pdf/**`, `src/lib/custody/**`).
- Limpiar/retirar la rama remota divergente `claude/gracious-pasteur-6efdde`.
- Registrar conteos de pipelines (evidencia).
- Revisar dominio productivo definitivo (custom domain) si aplica.

---

## Declaración

**TOPS NEXUS 1.0** — código en producción (`main` @ `70a9944`), build verde, infra productiva activa.

La declaración formal **TOPS NEXUS 1.0 — PRODUCTIVO** queda **emitida y sujeta a** las dos confirmaciones del usuario marcadas arriba (Netlify **Published** + smoke test autenticado **PASS**). Con ambas en verde, el release se considera **CERRADO**.

> Firma de cierre (usuario): ____________________  ·  Fecha: __________
> Netlify Published ☐   ·   Smoke test PASS ☐   →   **1.0 PRODUCTIVO CONFIRMADO**

Rollback documentado en `ROLLBACK-PLAN.md` / `FINAL-DEPLOY-RUNBOOK.md §6`.
