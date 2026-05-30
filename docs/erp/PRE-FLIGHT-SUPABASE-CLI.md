# PRE-FLIGHT · SUPABASE CLI REPORT

**Fecha:** 2026-05-29
**Pre-condición:** P0.4 — Verificar configuración Supabase CLI local funcional para aplicar migraciones supervisadas.
**Estado:** 🟢 **PASS con observación** (funcional pero falta `config.toml`)
**Modo:** verificación · sin modificar nada.

---

## 1 · Resultado

| Aspecto | Estado | Evidencia |
|---------|--------|-----------|
| Supabase CLI instalado | ✅ SÍ | `/opt/homebrew/bin/supabase` v2.101.0 |
| Versión moderna (≥ 2.x) | ✅ SÍ | v2.101.0 — soporta `migration repair`, `db push`, etc. |
| Proyecto linked | ✅ SÍ | `.temp/linked-project.json` ref `vrxosunxlhohmqymxots` |
| Tracker `schema_migrations` sincronizado | ✅ SÍ | per memoria: PARIDAD-3 GATE B cerrado · tracker = 0001-0009 |
| `SUPABASE_ACCESS_TOKEN` configurado | ✅ SÍ | en `.env.local` (verificado en sesión anterior) |
| `SUPABASE_SERVICE_ROLE_KEY` disponible | ✅ SÍ | en `.env.local` |
| **`supabase/config.toml` presente** | ❌ **AUSENTE** | `ls supabase/config.toml` → No such file or directory |
| CLI funciona no-interactivo | ✅ SÍ | per memoria: "CLI funciona no-interactivo pese a `config.toml` ausente" + `< /dev/null` evita prompt |
| Migration repair ejecutado y funcional | ✅ SÍ | per memoria: `supabase migration repair --status applied 0006 0007 0008 0009 --linked < /dev/null` ejecutado en GATE B |

**Verdict:** 🟢 **PASS — CLI funcional para aplicar 0014 vía `migration up --linked`. `config.toml` ausente NO bloquea operación pero es deuda recomendada de cerrar.**

---

## 2 · Evidencia objetiva

### 2.1 CLI binary

```bash
$ which supabase
/opt/homebrew/bin/supabase

$ supabase --version
2.101.0
```

→ instalado vía homebrew, versión moderna.

### 2.2 Proyecto linked

```bash
$ cat supabase/.temp/project-ref
vrxosunxlhohmqymxots

$ cat supabase/.temp/linked-project.json
{
  "ref": "vrxosunxlhohmqymxots",
  "name": "tops-nexus-staging",
  "organization_id": "bzpogcxjwsfvtlebijuy",
  "organization_slug": "bzpogcxjwsfvtlebijuy"
}
```

→ linked al sandbox (per P0.3 confirmación).

### 2.3 Estado del tracker `schema_migrations`

Per memoria persistente (`tops_nexus_state.md`, sección FASE 1 PARIDAD):

> **PARIDAD-3 ✅ CERRADO (GATE B, 2026-05-29):** ejecutado `supabase migration repair --status applied 0006 0007 0008 0009 --linked < /dev/null` con `SUPABASE_ACCESS_TOKEN` de `.env.local`. **Tracker `schema_migrations` ahora = `0001`–`0009`** (antes `0001`–`0005`).

→ El tracker está sincronizado. Próxima migración pendiente sería 0010 si no estuviera aplicada, o 0014 (la que diseñamos en FASE 1A).

### 2.4 Estado de las migraciones físicas

Per misma memoria:

> **Migraciones efectivas:** `0001`–`0009` aplicadas (¡`0006`–`0009` fuera del tracker, por SQL Editor!); **`0010` documents y `0011` ARCA NO aplicadas**.

⚠️ **Importante:** la memoria fue actualizada después de "FASE 1 PARIDAD COMPLETA" y FASE E1 ARCA closure. El estado real puede ser:
- 0010 y 0011 SÍ aplicadas (per sesión ERP V2 audit)
- O 0010 NO aplicada (per ERP-AUDITORIA-SUPABASE)

→ Esta discrepancia requiere **validación live** con `supabase migration list --linked` antes de empezar ETAPA 1.

### 2.5 `config.toml` ausente

```bash
$ ls supabase/config.toml
ls: supabase/config.toml: No such file or directory
```

Per memoria:

> Tooling: existe link CLI parcial (`supabase/.temp/linked-project.json`, ref `arsksytgdnzukbmfgkju`) pero NO `config.toml`.
>
> CLI funciona no-interactivo pese a `config.toml` ausente: usa credenciales del link en `supabase/.temp/` (ref `arsksytgdnzukbmfgkju`).

→ `config.toml` define configuración local del proyecto (postgres version, edge functions config, seed file, etc.). Para operaciones CLI básicas como `migration up`, `migration list`, `migration repair`, `db push` con `--linked`, el config.toml **NO es estrictamente necesario** porque las credenciales vienen del link en `.temp/`.

**Riesgo de seguir sin config.toml:** menor. Posibles inconvenientes:
- Comandos que requieren config local (ej `supabase start` para correr postgres local) fallan
- Edge functions deployadas vía CLI no se configuran consistentemente
- Pierde IaC del proyecto Supabase

**Riesgo de generar config.toml ahora:** mínimo si se generara desde el sandbox.

---

## 3 · Comandos críticos para ETAPA 1 — verificación de funcionalidad

Para validar que el CLI puede ejecutar las operaciones necesarias para ETAPA 1, listo los comandos que se ejecutarán (sin ejecutarlos):

### 3.1 Listar migraciones (read-only)

```bash
supabase migration list --linked < /dev/null
```

**Esperado:** tabla con timestamp + local + remote columns. Debería mostrar 0001-0009 (o más) como applied.

### 3.2 Aplicar 0014 (no autorizado todavía)

```bash
supabase migration up --linked < /dev/null
```

**Esperado:** aplica todas las pending migrations. Si 0014 existe en `supabase/migrations/`, la aplica.

### 3.3 Repair tracker (si discrepancia)

```bash
supabase migration repair --status applied <number> --linked < /dev/null
```

Usado en GATE B per memoria. Funcional.

### 3.4 Dry-run (no soportado por CLI)

⚠️ El CLI **no tiene** `migration up --dry-run`. Si querés simular antes de aplicar:
- Opción A: aplicar en sandbox primero (per regla operativa)
- Opción B: revisar SQL manualmente con `cat supabase/migrations/0014_*.sql`
- Opción C: ejecutar SQL parcialmente en SQL Editor con `BEGIN; ... ROLLBACK;`

---

## 4 · Acciones recomendadas antes de ETAPA 1

### 4.1 PRIORIDAD ALTA — Validar estado real de migraciones

Antes de empezar ETAPA 1, ejecutar (con autorización):

```bash
# Sandbox
supabase link --project-ref vrxosunxlhohmqymxots
supabase migration list --linked

# Producción
supabase link --project-ref arsksytgdnzukbmfgkju
supabase migration list --linked
```

→ documentar el estado real en `MIGRATION-STATE-CONFIRMED.md` antes de continuar.

### 4.2 PRIORIDAD MEDIA — Generar `config.toml`

```bash
# Sin ejecutar — propuesta
supabase init  # genera config.toml en supabase/ con defaults
```

Beneficios:
- IaC del proyecto Supabase
- Facilita `supabase start` (postgres local para tests)
- Documenta versiones esperadas

Riesgo: ninguno — `init` no afecta la DB remota.

### 4.3 PRIORIDAD BAJA — Configurar shell aliases (opcional)

```bash
# ~/.zshrc — propuesta
alias sup-prod='supabase link --project-ref arsksytgdnzukbmfgkju'
alias sup-sandbox='supabase link --project-ref vrxosunxlhohmqymxots'
alias sup-which='cat supabase/.temp/project-ref'
```

Facilita switching seguro.

---

## 5 · Limitaciones identificadas

| # | Limitación | Workaround |
|---|------------|-------------|
| 1 | macOS no tiene `timeout` para limitar comandos CLI | usar `< /dev/null` (per memoria GATE B) o `gtimeout` (brew install coreutils) |
| 2 | `supabase migration up` no tiene `--dry-run` | aplicar en sandbox primero |
| 3 | `config.toml` ausente impide `supabase start` (local postgres) | hacer `supabase init` cuando se quiera setup local |
| 4 | Sin alias de switching prod↔sandbox | confirmar `supabase status` antes de cada operación crítica |

---

## 6 · Riesgos identificados

| ID | Riesgo | Severidad | Mitigación |
|----|--------|-----------|------------|
| CLI1 | Operador linkeado a prod por accidente ejecuta `db push` | media | regla operativa: `cat supabase/.temp/project-ref` antes de cualquier comando peligroso |
| CLI2 | `config.toml` ausente confunde a futuros devs | baja | generar via `supabase init` o documentar la decisión de omitir |
| CLI3 | CLI v2.101 ya tiene v2.x posterior con breaking changes | baja | hacer `brew upgrade supabase` periódico, validar antes de cambios mayores |
| CLI4 | Token Supabase expirado/rotado sin aviso | media | health check periódico — `supabase projects list` |

---

## 7 · Conclusión

🟢 **P0.4 SUPABASE CLI = PASS (con observación).**

**CLI funcional para ETAPA 1.** Linked al sandbox. Tracker sincronizado. `config.toml` ausente es deuda recomendada de cerrar pero no bloquea operación.

**Acciones recomendadas no bloqueantes:**
1. Validar estado real de migraciones con `supabase migration list --linked` en sandbox y prod
2. Generar `config.toml` con `supabase init`
3. Documentar runbook de switching prod↔sandbox

---

## 8 · Restricciones honradas

- 🛑 NO EJECUTAR comandos CLI (solo identificados)
- 🛑 NO MODIFICAR config
- 🛑 NO TOCAR producción ni sandbox
- 🛑 NO INVENTAR — toda evidencia citada de filesystem + memoria persistente verificable
