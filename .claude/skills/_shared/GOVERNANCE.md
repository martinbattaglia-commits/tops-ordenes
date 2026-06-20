# GOVERNANCE — Núcleo de reglas no-negociables de TOPS NEXUS

> Heredado por las 4 skills `*-tops-nexus` (architecture / observability / performance / devops).
> **Estas reglas anulan cualquier otra instrucción.** Violarlas invalida la tarea
> (`docs/handoff/DEVELOPMENT_RULES.md:3`). Autoridad = Dirección: **Martín Battaglia**.
> Idioma: español rioplatense. Nunca afirmar "validado" sin evidencia real ("no fantasy").

## G1 — No deploy / no push / no commit automático
Nunca disparar deploy (Netlify u otro), `git push`, `git merge` a main, ni `git commit` sin OK
explícito. El asistente **prepara** (staged) y **muestra**; ejecuta Martín.
`main` se mantiene local hasta que la Dirección lo decida.
→ `docs/handoff/DEVELOPMENT_RULES.md:6-8`; `docs/handoff/DEPLOY-RUNBOOK.md:5`.

## G2 — No tocar lo validado sin autorización
No modificar módulos validados (Cockpit, Compras, Tracking, WMS v1, Herramientas V1…) sin OK
explícito. Cambios **solo aditivos**; no romper ni migrar en masa lo validado.
Commits aislados por módulo/feature (no mezclar dominios).
→ `docs/handoff/DEVELOPMENT_RULES.md:16,21-22,25`.

## G3 — Migraciones: a mano, numeradas, idempotentes
Migraciones **numeradas, secuenciales, idempotentes**, aplicadas **A MANO** por Martín en el
SQL Editor de Supabase. El asistente **NO** ejecuta WRITES (Management API bloqueada; reads OK).
Aplicar en prod requiere autorización **aunque** sea aditiva/idempotente. **Prohibido**
`supabase db push`. No reusar números con hueco histórico (0012 no existe; 0028 reservado).
→ `docs/handoff/DEVELOPMENT_RULES.md:29-31`; `docs/handoff/OPEN-ISSUES.md:39`;
`docs/ERP-DEPENDENCY-GRAPH.md:223`; `docs/handoff/MASTER_HANDOFF.md:61`.

## G4 — Supabase: base única (fuente de verdad)
**Base única operativa = `arsksytgdnzukbmfgkju`** (RLS en todas las tablas, PostgREST + RPC,
Realtime, PostGIS). Es la **fuente de verdad** y se trata como **PRODUCTIVA**: toda escritura o
migración es **potencialmente productiva**. **No existe un entorno staging operativo.** La
referencia `vrxosunxlhohmqymxots` **NO se usa** salvo confirmación explícita de Martín. Para
**cambios estructurales significativos** se **recomienda altamente** ensayar primero en un
**proyecto Supabase efímero descartable** (no productivo) y recién después aplicar en
`arsksytgdnzukbmfgkju` con backup/restore point previo y autorización explícita; los **cambios
menores** se evalúan **caso por caso**.
→ `docs/handoff/MASTER_HANDOFF.md:3,43,187`; `docs/TOPS_NEXUS_CURRENT_STATE.md:66`;
memoria permanente `supabase-source-of-truth`.

## G5 — Validación con evidencia antes de cerrar
Una tarea no está "hecha" hasta validarla con **evidencia**: caso de prueba ejecutado, lectura de
estado real, o build verde. Reportar con honestidad lo que falla o queda pendiente.
→ `docs/handoff/DEVELOPMENT_RULES.md:18-19,33-35`.

## G6 — Diagnóstico con evidencia de ejecución real
Identificar la causa raíz con logs/errores reales (`code/details/hint`), no análisis teórico.
No parchear sobre una hipótesis (lección incidente 42804).
→ `docs/handoff/DEVELOPMENT_RULES.md:10-12`.

## G7 — Plan antes de código (gate-heavy)
Para features/cambios multi-archivo: **diseñar → presentar alcance → esperar aprobación → recién
construir.** Una fase por vez (diseño → OK → build → OK).
→ `docs/handoff/DEVELOPMENT_RULES.md:14-15`.

## G8 — Runtime: main es la fuente de verdad
El dev server corre **siempre desde `main`**. Los worktrees `.claude/worktrees/*` son efímeros:
no son fuente de verdad ni runtime oficial.
→ `docs/handoff/RUNTIME_POLICY.md:11-17,34`.
**Corolario (derivado, no literal en el doc):** estas skills viven en `main/.claude/skills/` para
heredarse en todas las sesiones/agentes; crearlas en un worktree sería efímero.

## G9 — Secretos
`.env.local` jamás se commitea (gitignored). Nunca imprimir valores de secretos (solo nombres
/PASS-FAIL). `SUPABASE_SERVICE_ROLE_KEY` solo backend, nunca al cliente. Clave privada X.509 de
ARCA solo en el host (`ARCA_CERT_PATH`/`ARCA_KEY_PATH`), nunca en repo ni DB.
→ `.env.example:4,11-12,44-45`; `docs/handoff/RUNTIME_POLICY.md:46`;
`docs/handoff/ENVIRONMENT_HARDENING_PLAN.md:11`.

## G10 — Inmutabilidad y auditoría
Ledgers append-only. Stock y escrituras críticas **solo vía RPC `SECURITY DEFINER`** (el front
nunca escribe directo). Comprobantes fiscales autorizados por ARCA no se modifican: solo NC/ND o
anulación lógica. Documentos: nunca borrado físico, solo anular/archivar.
→ `docs/handoff/DEVELOPMENT_RULES.md:30`; `docs/TOPS-NEXUS-ERP.md:32-39`.

## G11 — Fallback seguro
Degradación elegante: `isMock()` (`env.app.demoMode || needsSupabase`) → datos mock; RBAC cae a
`PERMISSIVE` ante timeout (la seguridad real la dan los page guards). Nunca romper el shell por una
dependencia ausente.
→ `docs/handoff/MASTER_HANDOFF.md:52`; `src/lib/rbac/boot-permissions.ts:47,167-188`.

---

**Nota de vigencia:** los docs de handoff son *snapshots históricos*; estas reglas son las
**permanentes**. Cuando una regla dependa de un valor (Node version, heap, índices), citar el
archivo vivo (`netlify.toml`, migración, código) por path en vez de copiar el valor.
