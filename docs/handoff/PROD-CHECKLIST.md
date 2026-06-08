# PROD-CHECKLIST — TOPS NEXUS

**Fecha:** 2026-06-08 · Validación de preparación para Deploy Productivo.
**Branch:** `claude/gracious-pasteur-6efdde` · **Remote:** `origin` (github.com/martinbattaglia-commits/tops-ordenes)
**Regla permanente:** el asistente NO commitea/mergea/deploya ni escribe en prod. Todo lo marcado `[ ]` lo ejecuta el usuario.

---

## 1. Git
| Check | Estado |
|---|---|
| Branch correcta | ✅ `claude/gracious-pasteur-6efdde` |
| Relación con `main` | ✅ **7 commits adelante, 0 detrás** → merge limpio posible |
| Conflictos | ✅ **0** |
| ⚠️ **Trabajo sin commitear** | **58 archivos modificados + 177 sin trackear** (142 docs, **19 fuentes**, 12 migraciones) |

> 🔴 **BLOQUEANTE para un deploy completo:** los 7 commits adelantados son solo RRHH (R1–R6).
> Todo el trabajo de CRM360 / crm_units / compliance / command-center / contratos / buscador
> está **en el working tree, sin commitear**. Si se deploya el HEAD actual, **eso NO viaja**.
>
> Fuentes sin trackear (deben commitearse): `OpportunitiesView.tsx`, `opportunity-title.ts`,
> `pipeline-filter.ts`, `units-data.ts`, `compliance/`, `rrhh/` (components), `legajo/`,
> `command-center.ts`, `rbac/guard.ts`, `rbac/cockpit-visibility.ts`, `anmat/[id]/`, `clientes/`,
> `compras/proveedores/[id]+actions`, `tesoreria/bancos/[slug]/`, `AccesoRestringido.tsx`.
> Más 58 modificados (mapas, Opportunity360View, pages, etc.).

- [ ] Revisar `git status` completo y commitear TODO el trabajo del release (ver DEPLOY-RUNBOOK §2).
- [ ] Confirmar que NO se commitean secretos (ver §hygiene).

### Higiene (ya endurecida)
- ✅ `.gitignore` actualizado: `.env.local.*`, `.env*.bak`, `.next.trash-*/` ahora ignorados.
- ✅ Verificado: `.env.local.pre-drive-root.bak` y `.env.local.pre-fix.bak` → **IGNORED** (no se commitearán; evita fuga de secretos).
- [ ] (Opcional) borrar manualmente los `.bak` de env y los `.next.trash-*` para limpiar el worktree.

## 2. Build / dependencias
| Check | Estado |
|---|---|
| `tsc --noEmit` | ✅ PASS |
| `next lint` | ✅ PASS (0 err, 5 warn cosméticos) |
| `next build` | ✅ PASS (79 páginas, 119 rutas, sin warnings) |
| Lockfile | ⚠️ `package.json` + `package-lock.json` **modificados** → deben commitearse para que Netlify (`npm install`) resuelva igual |
| Node local vs prod | Local v25 · **Netlify NODE_VERSION=22** (target). Verificar build en 22 (lo hace Netlify) |

- [ ] `npm ci` reproducible con el lockfile commiteado.

## 3. Supabase (`arsksytgdnzukbmfgkju`)
| Migración | Rol | Estado esperado |
|---|---|---|
| 0052/0053 (crm mirror, ingest_deal) | obligatoria | confirmar aplicada |
| 0056–0064 (RRHH R1–R5) | obligatoria | confirmar aplicada (RRHH validado) |
| 0065 (compliance_core) | obligatoria | confirmar aplicada (Compliance validado) |
| 0066/0067/0068 (crm_units, seed, reserve) | obligatoria | **aplicadas** (memoria); reconfirmar |
| **0069 (clientify_deal_name)** | **OPCIONAL** | **NO aplicada** — el front degrada con fallback; aplicar solo si se quiere el nombre real del deal |

- [ ] Confirmar en SQL Editor que las **obligatorias** existen (tablas/RPC: `crm_opportunities`, `crm_units`, `crm_reserve_units`, RRHH, compliance).
- [ ] Las 12 migraciones sin trackear deben commitearse al repo (versionado; no afecta la ejecución que es manual).
- [ ] 0069: decisión GO/aplazar (no bloquea).

## 4. Netlify
| Check | Valor | Estado |
|---|---|---|
| Build command | `npm run build` | ✅ (`netlify.toml`) |
| Publish | `.next` | ✅ |
| NODE_VERSION | `22` | ✅ |
| NODE_OPTIONS | `--max-old-space-size=4096` | ✅ |
| Variables de entorno | ver lista | [ ] verificar en panel |

- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `NEXT_PUBLIC_APP_URL` (dominio prod)
- [ ] `RESEND_*`, `OPENAI_*`, `META_WA_*`, `HIKVISION_*`, `ARCA_*`, `TRACKING_INGEST_TOKEN` según módulos activos
- [ ] `npm run env:check` sin faltantes (el predev guard lo corre en dev)

## 5. Clientify
| Check | Estado |
|---|---|
| `CLIENTIFY_API_KEY` válida en prod | ⚠️ **VERIFICAR** — el token del MCP devolvió `401 Invalid token` en esta sesión |
| `CLIENTIFY_BASE_URL`, `CLIENTIFY_WEBHOOK_SECRET`, timeouts/retries | [ ] presentes |
| Sincronización | CRM360 lee `crm_opportunities` (ya sincronizado); no bloquea el deploy |

- [ ] Confirmar que la API key de runtime en Netlify es válida (distinta del token del MCP).

## 6. Drive TOPS
| Check | Estado |
|---|---|
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` correcto | ⚠️ **VERIFICAR** — existen backups `.env.local.pre-drive-root.bak` → el root fue cambiado recientemente |

- [ ] Confirmar que el folder root de Drive en la env de prod es el correcto (no un valor de prueba/staging).

---

## Resumen de bloqueantes
1. 🔴 **Commitear el trabajo del release** (58 mod + 19 fuentes + 12 migraciones + docs) antes de mergear/deployar.
2. 🟠 Verificar **Clientify API key** prod (401 en sesión).
3. 🟠 Verificar **Drive root** prod (fue modificado).
Resto: ✅ verde o decisión no bloqueante (0069).
