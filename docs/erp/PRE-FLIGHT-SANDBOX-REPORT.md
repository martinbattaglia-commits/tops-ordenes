# PRE-FLIGHT · SANDBOX REPORT

**Fecha:** 2026-05-29
**Pre-condición:** P0.3 — Verificar existencia de sandbox Supabase separado de producción.
**Estado:** 🟢 **PASS** (con observación de uso)
**Modo:** verificación · sin modificar nada.

---

## 1 · Resultado

| Aspecto | Estado | Evidencia |
|---------|--------|-----------|
| Existe proyecto sandbox separado | ✅ SÍ | `supabase/.temp/linked-project.json` ref `vrxosunxlhohmqymxots` |
| Sandbox tiene nombre identificable | ✅ SÍ | `"name":"tops-nexus-staging"` |
| Sandbox está aislado de producción | ✅ SÍ | URL distinta + `STAGING_PROJECT_REF` ≠ `SUPABASE_PROJECT_REF` |
| CLI linked al sandbox (no a prod) | ✅ SÍ | linked-project.json apunta a staging — protección anti-accidente |
| Sandbox accesible para tests | ⚠️ por confirmar | requiere validación live del usuario |
| Sandbox tiene datos representativos | ❓ desconocido | no documentado |

**Verdict:** 🟢 **PASS — sandbox existe, separado, identificado, CLI linked allá.**

---

## 2 · Evidencia objetiva

### 2.1 `supabase/.temp/linked-project.json`

```json
{
  "ref": "vrxosunxlhohmqymxots",
  "name": "tops-nexus-staging",
  "organization_id": "bzpogcxjwsfvtlebijuy",
  "organization_slug": "bzpogcxjwsfvtlebijuy"
}
```

Confirmado: **CLI está actualmente linked al sandbox**, NO a producción. Esto es **protección activa contra accidente** — si alguien ejecuta `supabase db push` sin pensar, aplica a sandbox, no a prod.

### 2.2 `.env.local` — variables de los 2 proyectos

```
NEXT_PUBLIC_SUPABASE_URL=https://arsksytgdnzukbmfgkju.supabase.co
SUPABASE_PROJECT_REF=arsksytgdnzukbmfgkju     ← PRODUCCIÓN
STAGING_PROJECT_REF=vrxosunxlhohmqymxots       ← SANDBOX
```

→ Dos proyectos Supabase distintos, claramente diferenciados por env var name.

### 2.3 Acceso documentado

`supabase/.temp/project-ref` contiene el ref activo:

```
vrxosunxlhohmqymxots
```

→ Toda invocación CLI sin `--project-ref` explícito apunta al sandbox.

---

## 3 · Inventario de proyectos Supabase

| Proyecto | Ref | URL | Uso |
|----------|-----|-----|-----|
| **tops-ordenes (prod)** | `arsksytgdnzukbmfgkju` | `https://arsksytgdnzukbmfgkju.supabase.co` | Producción — `nexus.logisticatops.com` |
| **tops-nexus-staging** | `vrxosunxlhohmqymxots` | (no documentada en .env) | Sandbox/staging |

---

## 4 · Observaciones de uso

### 4.1 Sandbox aislado físicamente

✅ Separación a nivel cuenta Supabase. Operaciones en sandbox NUNCA afectan datos de prod.

### 4.2 CLI linked a sandbox por default — POSITIVO

Cualquier comando `supabase migration up`, `supabase db push`, etc. ejecutado sin parámetros explícitos va al sandbox. Esto es **safety by default**.

### 4.3 Para aplicar 0014 a producción más adelante

Requiere re-link explícito:

```bash
# Sin ejecutar — propuesto
supabase link --project-ref arsksytgdnzukbmfgkju
# verifica:
supabase status   # debe mostrar arsksytgdnzukbmfgkju
# luego:
supabase migration up --linked
```

→ paso explícito, no accidental.

### 4.4 Re-link a sandbox después

```bash
# Sin ejecutar — propuesto
supabase link --project-ref vrxosunxlhohmqymxots
```

→ debería volver al estado actual.

---

## 5 · Tests recomendados antes de usar sandbox para FASE 1A

Para validar que el sandbox es funcionalmente equivalente a producción (al nivel de schema), ejecutar (en sandbox):

| Test | Comando (a ejecutar — no incluído acá) | Resultado esperado |
|------|------------------------------------------|---------------------|
| Schema migrations aplicadas | `supabase migration list --linked` | 0001–0009 applied (igual que prod per memoria GATE B) |
| RLS habilitada en tablas críticas | `SELECT tablename FROM pg_tables WHERE schemaname='public'` + `SELECT relname FROM pg_class WHERE relrowsecurity=true` | clients, orders, etc. con RLS |
| Tablas ARCA presentes/ausentes | `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%invoice%'` | match esperado con mig 0011 |
| Buckets storage | `SELECT id FROM storage.buckets` | attachments, pdfs, signatures, po-pdfs, po-signatures, invoices |
| Roles + permissions seedeados | `SELECT count(*) FROM roles, permissions, role_permissions` | 7 + 22 + 64 (per memoria) |

Estos tests son **opcionales** para cerrar P0.3, pero **obligatorios** antes de ejecutar 0014 en sandbox (ETAPA 1).

---

## 6 · Riesgos identificados

| ID | Riesgo | Severidad | Mitigación |
|----|--------|-----------|------------|
| SBX1 | Sandbox tiene drift de schema vs prod → 0014 funciona en sandbox pero falla en prod | media | sincronizar sandbox con prod antes de tests críticos |
| SBX2 | CLI re-linkeado accidentalmente a prod → comandos peligrosos se ejecutan en vivo | media | regla operativa: confirmar `supabase status` antes de cualquier `db push` |
| SBX3 | Sandbox con datos sensibles reales sin RLS → leak | baja | si sandbox tiene snapshot de prod, validar RLS también |
| SBX4 | Sandbox stale → bugs reportados ahí no se reproducen en prod | baja | refresh periódico |

---

## 7 · Recomendaciones operativas

### 7.1 Procedimiento estándar para operaciones críticas

```
ANTES de cualquier `supabase db push` o `migration up`:
  1. supabase status                    # ver linked actual
  2. Si linked a prod: confirmar con 2do humano
  3. Ejecutar primero en sandbox (link a sandbox, db push, smoke tests)
  4. Si OK: link a prod, repetir, smoke tests prod
```

### 7.2 Banner en terminal (sugerido, no obligatorio)

Agregar a `~/.zshrc` o equivalente:

```bash
function supabase_warn() {
  local linked=$(cat supabase/.temp/project-ref 2>/dev/null)
  if [ "$linked" = "arsksytgdnzukbmfgkju" ]; then
    echo "⚠️  WARNING: CLI linked to PRODUCTION ($linked)"
  fi
}
```

Recordatorio visual al ejecutar comandos.

### 7.3 Documentar runbook

Crear `docs/runbooks/SUPABASE-SANDBOX-OPERATIONS.md` con:
- Cómo refrescar sandbox desde prod (pg_dump + pg_restore)
- Cómo aplicar migration en sandbox vs prod
- Quién tiene acceso a cada uno

---

## 8 · Conclusión

🟢 **P0.3 SANDBOX = PASS.**

**Existe.** Aislado. CLI linked allá por safety.

**Recomendaciones operativas** para asegurar uso correcto durante ETAPA 1 documentadas en este reporte.

---

## 9 · Acciones siguientes (no bloqueantes para GATE 0)

| # | Acción | Quién | Cuándo |
|---|--------|-------|--------|
| 1 | Confirmar sandbox tiene mismo schema que prod (tests §5) | DevOps/Dev | antes de ETAPA 1 |
| 2 | Documentar runbook sandbox vs prod operations | Dev | antes de ETAPA 1 |
| 3 | Refrescar datos sandbox si están stale | DevOps | opcional |
| 4 | Agregar banner zsh para visibilidad | Cada dev | opcional |

---

## 10 · Restricciones honradas

- 🛑 NO MODIFICAR sandbox ni prod
- 🛑 NO EJECUTAR queries (incluso readonly)
- 🛑 NO TOCAR config
- 🛑 NO INVENTAR — evidencia de `supabase/.temp/linked-project.json` y `.env.local`
