# DRIVE-INTEGRATION-EXECUTION-PLAN.md

**Fecha:** 2026-05-29
**Estado del módulo:** 🟢 READY FOR CREDENTIALS (ver `docs/DRIVE-REMEDIATION-REPORT.md`)
**Snapshot base:** `docs/DRIVE-PRE-CREDENTIALS-SNAPSHOT.md` (commit `4d1dbff`)
**Modo:** documento de planificación — **nada se ejecuta** sin orden explícita.

---

## Resumen del GATE DRIVE INTEGRATION

Activación: el usuario entrega `FOLDER_ID + SERVICE_ACCOUNT_EMAIL + JSON`.

Ejecución secuencial sin pausas internas — pero con **gates de aprobación entre fases mayores**:

| Paso | Fase | Bloquea siguiente si falla | Aprobación previa requerida |
|------|------|----------------------------|----------------------------|
| 1 | Validación JSON | ✅ | ya implícita en entregar las creds |
| 2 | Configurar env vars Netlify | ✅ | implícita |
| 3 | Commit + push working tree Drive | ✅ | **🛑 requiere OK del usuario** |
| 4 | Deploy conjunto a producción | ✅ | **🛑 requiere OK del usuario** |
| 5 | Smoke tests funcionales | ⚠️ rollback si falla | — |
| 6 | Validación end-to-end | ⚠️ rollback si falla | — |
| 7 | Reporte final + actualizar memoria | — | — |

**Tiempo total estimado:** 25-35 minutos desde entrega de creds hasta reporte final.

---

## PASO 1 · Validación JSON

**Objetivo:** verificar integridad del JSON antes de tocar Netlify.

**Sin tocar:** Netlify env vars, git, código.

### Checklist de validaciones

| # | Validación | Criterio PASS | Si FAIL |
|---|-----------|---------------|---------|
| 1.1 | `JSON.parse(json)` no tira | objeto válido | abortar, pedir re-paste |
| 1.2 | `type === "service_account"` | igualdad estricta | abortar |
| 1.3 | `client_email` presente y formato email | regex `/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/` | abortar |
| 1.4 | `private_key` presente | longitud >100 chars | abortar |
| 1.5 | `private_key` empieza con `-----BEGIN PRIVATE KEY-----` | match prefijo | abortar |
| 1.6 | `private_key` termina con `-----END PRIVATE KEY-----\n` (o `\n` literal) | match sufijo | abortar |
| 1.7 | `project_id` presente | string no vacío | warning, continuar |
| 1.8 | `private_key_id` presente | string no vacío | warning, continuar |
| 1.9 | `client_email` informado coincide con el del JSON | igualdad case-insensitive | warning, continuar con el del JSON |
| 1.10 | `FOLDER_ID` formato Drive | alfanumérico + `-_`, longitud 25-50 | abortar |

### Comando práctico

```bash
# No ejecutar todavía — propuesta:
echo "$JSON_PASTED" | jq -e '
  .type == "service_account"
  and .client_email
  and .private_key
  and .project_id
  and .private_key_id
  and (.private_key | startswith("-----BEGIN PRIVATE KEY-----"))
' && echo OK || echo FAIL
```

### Serialización para Netlify

Netlify env vars no soportan multilínea real. Hay que serializar:

```bash
# Convertir a una sola línea preservando \n LITERALES dentro de private_key
ONE_LINE_JSON=$(echo "$JSON_PASTED" | jq -c '.')
echo "$ONE_LINE_JSON" | head -c 80   # verificar que empieza con {"type":"service_account",...
```

**Verificación crítica:** `jq -c` preserva los `\n` dentro de `private_key` como `\n` literales escapados. NO los convierte a saltos de línea reales — esa es la propiedad que necesitamos.

### Output esperado del PASO 1

```
✅ JSON parsed
✅ type = service_account
✅ client_email = <email>@<project>.iam.gserviceaccount.com
✅ private_key valid PEM (XXX chars)
✅ project_id = <project>
✅ FOLDER_ID format ok (XX chars)
✅ Serialized to single line (YYYY bytes)
→ Listo para PASO 2
```

---

## PASO 2 · Configurar env vars en Netlify producción

**Objetivo:** dejar las 2 env vars seteadas en producción **sin redeployar todavía**.

**Sin tocar:** código, git, build.

### Pre-requisito

- `NETLIFY_AUTH_TOKEN` exportado desde `.env.local`
- `NETLIFY_SITE_ID` exportado desde `.env.local` (= `d84a7d34-b90c-4e61-aff6-678abf1ac432`)

### Comandos exactos (a ejecutar)

```bash
# No ejecutar todavía — propuesta:

cd /Users/martinbattaglia/CODE/tops-ordenes
export NETLIFY_AUTH_TOKEN=$(grep '^NETLIFY_AUTH_TOKEN=' .env.local | cut -d= -f2-)
export NETLIFY_SITE_ID=$(grep '^NETLIFY_SITE_ID=' .env.local | cut -d= -f2-)

# 2.1 — JSON serializado (marcado secret)
npx netlify env:set GOOGLE_SERVICE_ACCOUNT_JSON "$ONE_LINE_JSON" \
  --context production \
  --secret

# 2.2 — FOLDER_ID (no secret, es identificador semipúblico)
npx netlify env:set GOOGLE_DRIVE_ROOT_FOLDER_ID "$FOLDER_ID" \
  --context production

# 2.3 — Verificar que quedaron seteadas
npx netlify env:list --context production | grep -E "GOOGLE_SERVICE_ACCOUNT_JSON|GOOGLE_DRIVE_ROOT_FOLDER_ID"
```

### Verificaciones de PASO 2

| # | Verificación | Comando | Criterio PASS |
|---|-------------|---------|---------------|
| 2.a | env var creada | `netlify env:list` | aparece `GOOGLE_SERVICE_ACCOUNT_JSON` con valor `***` (oculta por --secret) |
| 2.b | env var creada | `netlify env:list` | aparece `GOOGLE_DRIVE_ROOT_FOLDER_ID` con valor visible |
| 2.c | Scope correcto | `netlify env:list --context production` | ambos presentes en production |

### Importante: PASO 2 NO afecta producción todavía

Setear env vars **NO redeploya**. El runtime activo sigue con las env vars del último deploy. Para que `process.env.GOOGLE_SERVICE_ACCOUNT_JSON` sea visible al runtime, hay que disparar PASO 4 (deploy).

**Excepción:** Netlify Functions invocadas tras setear env vars **a veces** las recogen sin redeploy (cold-start), pero no es garantía.

---

## PASO 3 · Commit + push del working tree Drive

**Objetivo:** trazabilidad — el deploy debe corresponder a un commit identificable.

**🛑 REQUIERE OK EXPLÍCITO DEL USUARIO** antes de ejecutar.

### Estrategia (de `DRIVE-PRE-CREDENTIALS-SNAPSHOT.md` opción A recomendada)

```bash
# No ejecutar todavía — propuesta:

cd /Users/martinbattaglia/CODE/tops-ordenes

# 3.1 — Crear branch dedicada (opcional, recomendado)
git switch -c feature/drive-hardening-redteam

# 3.2 — Commit hardening (H1-H12)
git add src/lib/supabase/middleware.ts \
        docs/DRIVE-PREFLIGHT-AUDIT.md \
        docs/DRIVE-HARDENING-REPORT.md

git commit -m "$(cat <<'EOF'
feat(drive): preflight + hardening H1-H12

H1 (crítico): middleware whitelist reducida a 5 rutas reales
  + 401 JSON en APIs autenticadas (no redirect HTML)
H2: scopes mínimos drive.readonly + drive.file
H3: paginación con pageToken / 50 default / 200 max
H6: doc cleanup GOOGLE_APPLICATION_CREDENTIALS
H7: structured logging JSON + timed() wrapper + x-request-id
H8: resetDriveCache() exportada (sin endpoint admin)
H9: escapeDriveQuery con backslash + quote
H10: 401 → mensaje 'Sesión expiró' en frontend
H11: skeleton durante recentLoading
H12: requestId en ErrorPanel para soporte

Verificaciones:
  typecheck: exit 0
  build: ok 35 pages, /drive 4.94 kB, middleware 82.1 kB

Refs: docs/DRIVE-PREFLIGHT-AUDIT.md, docs/DRIVE-HARDENING-REPORT.md
EOF
)"

# 3.3 — Commit remediation (R1-R15)
git add src/lib/drive/client.ts \
        src/lib/rbac/check.ts \
        src/app/api/drive/list/route.ts \
        src/app/api/drive/ping/route.ts \
        'src/app/(app)/drive/DriveBrowser.tsx' \
        docs/DRIVE-FINAL-REDTEAM.md \
        docs/DRIVE-REMEDIATION-REPORT.md \
        docs/DRIVE-PRE-CREDENTIALS-SNAPSHOT.md \
        docs/DRIVE-INTEGRATION-EXECUTION-PLAN.md

git commit -m "$(cat <<'EOF'
fix(drive): red team remediation R1-R15 + bonus R6

Hallazgos red team cerrados:
  R1 (crítico): listChildren guard con isUnderRoot()
  R2 (crítico): getBreadcrumbs guard con isUnderRoot()
  R3 (alto):    rate-limit 60/min /list + 20/min /ping
  R4 (alto):    RBAC server-side compliance.view con fail-open
                documentado para FASE 1 (user_roles vacía)
  R15 (alto):   AbortController con identity-guard en DriveBrowser
  R6 (medio bonus): safeRequestId() sanitiza header del cliente

Nuevo: src/lib/rbac/check.ts (helper RBAC server-side)

Veredicto: READY FOR CREDENTIALS
Verificaciones: typecheck ok, build ok

Refs: docs/DRIVE-FINAL-REDTEAM.md, docs/DRIVE-REMEDIATION-REPORT.md
EOF
)"

# 3.4 — Push (con upstream)
git push -u origin feature/drive-hardening-redteam
```

### Verificaciones de PASO 3

| # | Verificación | Comando | Criterio PASS |
|---|-------------|---------|---------------|
| 3.a | Commits creados | `git log --oneline -3` | 2 commits con prefijos `feat(drive):` y `fix(drive):` |
| 3.b | Working tree limpio | `git status --short` | sin archivos modificados Drive (sí puede haber otros ajenos) |
| 3.c | Push exitoso | exit 0 del `git push` | branch existe en `origin` |

### Gotcha del push y deploy auto

Netlify está conectado a `origin/main` para auto-deploy (verificado en sesión previa). Push a `feature/drive-hardening-redteam` **NO dispara deploy automático** — eso es lo que queremos. El deploy se hace manual en PASO 4.

### Alternativa: si el usuario prefiere NO commitear

Saltar PASO 3 y ejecutar PASO 4 directo desde working tree. Trade-off: el deploy no queda asociado a un commit identificable en git → debugging futuro más difícil.

---

## PASO 4 · Deploy conjunto a producción

**Objetivo:** disparar 1 deploy con todo (hardening + remediation + integración Drive).

**🛑 REQUIERE OK EXPLÍCITO DEL USUARIO.** Es el primer paso destructivo de la cadena.

### Comando exacto

```bash
# No ejecutar todavía — propuesta:

cd /Users/martinbattaglia/CODE/tops-ordenes
export NETLIFY_AUTH_TOKEN=$(grep '^NETLIFY_AUTH_TOKEN=' .env.local | cut -d= -f2-)
export NETLIFY_SITE_ID=$(grep '^NETLIFY_SITE_ID=' .env.local | cut -d= -f2-)

# 4.1 — Build local fresco
npm run build

# 4.2 — Deploy con .next dir
npx netlify deploy --prod --dir=.next
```

### Verificaciones de PASO 4

| # | Verificación | Comando / Criterio | Criterio PASS |
|---|-------------|---------------------|---------------|
| 4.a | Build ok | exit code 0 | ✓ Compiled successfully en stdout |
| 4.b | Deploy ok | output `Deploy is live!` | sí |
| 4.c | Production URL responde | `curl -sI https://tops-ordenes.netlify.app/` | 307 → /login (middleware auth redirect) |
| 4.d | SW v2 sigue vivo | `curl -s https://tops-ordenes.netlify.app/sw.js \| head -15` | contiene `"tops-nexus-v2"` |
| 4.e | Env vars cargadas en runtime | indirecto vía smoke tests del PASO 5 | — |

### Rollback strategy

Si el deploy falla o el smoke test inmediato rompe:

```bash
# Rollback a deploy anterior identificable
npx netlify deploy:list --site=$NETLIFY_SITE_ID | head -10
# Identificar deploy ID anterior
npx netlify rollback --id=<deploy-id-anterior>
```

Último deploy verde conocido (de la memoria persistente): `6a18f8129b4ea974e33aa309` (SW v2 deploy del 2026-05-28).

---

## PASO 5 · Smoke tests funcionales

**Objetivo:** validar que las creds funcionan + que los hardenings aplican en runtime real.

**Solo lectura — no destructivo.**

### 5.1 — Ping (sin auth, debe 401 desde middleware)

```bash
# Sin sesión: middleware bloquea
curl -s -i https://tops-ordenes.netlify.app/api/drive/ping | head -10
```

**Esperado:** `HTTP/2 401` con body `{"ok":false,"error":"Auth required"}`

**Si no:** middleware no aplicó. Revisar deploy.

### 5.2 — Sesión válida + ping

Requiere obtener cookie de sesión activa. Más fácil: hacerlo desde browser DevTools en sesión iniciada.

```javascript
// En browser DevTools (autenticado)
const reqId = "smoke-ping-" + Date.now();
fetch('/api/drive/ping', {
  headers: { 'x-request-id': reqId }
}).then(r => r.json()).then(d => console.log({reqId, ...d}));
```

**Esperado:**
```json
{
  "ok": true,
  "serviceAccountEmail": "<sa-email>@<project>.iam.gserviceaccount.com",
  "rootFolderId": "<FOLDER_ID>",
  "rootFolderName": "<nombre-real-de-la-carpeta>",
  "rootShared": true,
  "checkedAt": "2026-05-29T...",
  "requestId": "smoke-ping-..."
}
```

**Verificaciones:**

| # | Validación | Criterio |
|---|-----------|----------|
| 5.2.a | Status HTTP | 200 |
| 5.2.b | `rootFolderName` | string no nulo, coincide con el nombre real |
| 5.2.c | `rootShared` | true (SA puede leer la carpeta) |
| 5.2.d | `requestId` | echo del que enviamos |
| 5.2.e | header `x-request-id` | echo en respuesta |

### 5.3 — List root

```javascript
fetch('/api/drive/list', {
  headers: { 'x-request-id': 'smoke-list-root' }
}).then(r => r.json()).then(d => console.log({
  ok: d.ok,
  entries: d.entries.length,
  nextPageToken: d.nextPageToken,
  requestId: d.requestId,
  sample: d.entries.slice(0, 3).map(e => ({n: e.name, t: e.mimeType}))
}));
```

**Esperado:** lista de hijos directos del root con sample legible.

### 5.4 — Bounded search

```javascript
fetch('/api/drive/list?search=test', {
  headers: { 'x-request-id': 'smoke-search' }
}).then(r => r.json()).then(d => console.log({
  ok: d.ok,
  entries: d.entries.length,
  rootScoped: d.rootScoped,
  bounded: d.bounded
}));
```

**Esperado:** `rootScoped: true`, `bounded: true`.

### 5.5 — Scope guard (R1)

```javascript
// Pasar folderId inválido / fuera de scope
fetch('/api/drive/list?folderId=NotAFolderInOurScope12345', {
  headers: { 'x-request-id': 'smoke-scope' }
}).then(r => r.json()).then(d => console.log({
  status: 'expecting 403',
  ok: d.ok,
  error: d.error
}));
```

**Esperado:** 403 con `error: "Folder fuera del scope autorizado"`.

### 5.6 — Rate limit (R3)

```javascript
// Disparar 65 requests en paralelo
const r = await Promise.all(
  Array.from({length: 65}, (_, i) =>
    fetch('/api/drive/list', {
      headers: { 'x-request-id': `smoke-rl-${i}` }
    }).then(res => res.status)
  )
);
console.log({
  total: r.length,
  status200: r.filter(s => s === 200).length,
  status429: r.filter(s => s === 429).length
});
```

**Esperado:** ~60 responden 200, ~5 responden 429.

### 5.7 — Recientes con bounded

```javascript
fetch('/api/drive/list?recent=1', {
  headers: { 'x-request-id': 'smoke-recent' }
}).then(r => r.json()).then(d => console.log({
  ok: d.ok,
  recent: d.entries.length,
  sample: d.entries.slice(0,3).map(e => ({n:e.name, m:e.modifiedAt}))
}));
```

**Esperado:** archivos modificados recientemente, ninguno tipo folder.

### 5.8 — Verificar logs structured

```bash
# Tirar tail de los logs de Netlify Functions
npx netlify functions:log <function-name> --site=$NETLIFY_SITE_ID | tail -30
```

**Esperado:** entries JSON con campos `mod:"drive"`, `op:"listChildren"`, `ms:<N>`, `ok:true`, etc.

---

## PASO 6 · Validación funcional end-to-end

**Objetivo:** confirmar que la UI usa todo bien, no solo las APIs.

### 6.1 — Compliance Engine pill

1. Abrir https://tops-ordenes.netlify.app/anmat (autenticado)
2. **Esperado:** pill verde "Drive conectado" en el header del Compliance Alert Engine
3. Hover → tooltip con el email de la SA

**Si la pill dice "Conectar Drive" en amarillo:** Drive no detectado → revisar env vars + redeploy.

### 6.2 — Drive TOPS browser

1. Abrir https://tops-ordenes.netlify.app/drive
2. **Esperado:**
   - Header "Drive TOPS" con subtitle `N carpetas · M archivos en este nivel`
   - Listado de carpetas (folders primero, sort por modifiedTime)
   - Sidebar "Recientes" con archivos modificados
   - Sidebar "Service Account" con el email

### 6.3 — Navegación interna

1. Click en una carpeta de la lista
2. **Esperado:**
   - Breadcrumb se actualiza: `Drive raíz › <nombre-carpeta>`
   - Listado se actualiza con hijos directos
   - Botón "Cargar más" aparece si hay >50 ítems

### 6.4 — Búsqueda

1. Tipear término en el buscador
2. **Esperado:**
   - Loading spinner inicia
   - Debounce 280ms
   - Resultados aparecen con chip "Solo en carpeta TOPS" en verde
   - Si la query devuelve resultados fuera del scope: filtrados correctamente

### 6.5 — Búsqueda rápida (validar R15)

1. Tipear "TOPS NEXUS" en 200ms
2. **Esperado:**
   - Solo 1 request final visible en Network tab
   - Las anteriores aparecen como `(canceled)` en Chrome DevTools
   - Resultados corresponden a "TOPS NEXUS", no a versiones intermedias

### 6.6 — Manejo de error

1. Cerrar sesión en otra pestaña, volver a la pestaña Drive
2. Click en cualquier carpeta
3. **Esperado:** ErrorPanel con mensaje "Tu sesión expiró. Volvé a iniciar sesión." + `ref:` en footer

---

## PASO 7 · Reporte final + actualizar memoria

**Objetivo:** generar evidencia final + persistir aprendizajes.

### 7.1 — Generar `docs/DRIVE-INTEGRATION-REPORT.md`

Tabla obligatoria (del prompt original del usuario):

```markdown
| Validación        | Resultado   |
| ----------------- | ----------- |
| JSON              | PASS / FAIL |
| Env Vars          | PASS / FAIL |
| Drive API         | PASS / FAIL |
| Root Folder       | PASS / FAIL |
| Ping Endpoint     | PASS / FAIL |
| Drive Listing     | PASS / FAIL |
| Compliance Engine | PASS / FAIL |
```

**+** evidencia objetiva (HTTP responses, screenshots, log lines) para cada PASS.

### 7.2 — Actualizar `tops_nexus_state.md` (memoria persistente)

Añadir nueva sección:

```markdown
**DRIVE INTEGRATION COMPLETADA (2026-05-29):**
- Service account: <email>@<project>.iam.gserviceaccount.com
- Root folder: <nombre> (ID: <FOLDER_ID>)
- Deploy ID: <deploy-id-de-Netlify>
- Permisos: lector sobre carpeta TOPS
- Endpoints activos: /api/drive/ping, /api/drive/list (auth + rate-limit + RBAC compliance.view)
- Frontend: /drive con browser, /anmat con pill "Drive conectado"
- Pendientes: ver R5-R14 en docs/DRIVE-FINAL-REDTEAM.md (no bloqueantes)
```

### 7.3 — Marcar task #10 como completed

```bash
# Vía TaskUpdate del agent SDK
```

---

## Matriz de aprobaciones requeridas

| Paso | Acción | Aprobación previa |
|------|--------|-------------------|
| 1 | Validar JSON | implícita al entregar |
| 2 | env vars Netlify | implícita al entregar |
| 3 | git commit + push | **🛑 explícita del usuario** |
| 4 | deploy --prod | **🛑 explícita del usuario** |
| 5 | smoke tests | implícita (solo lectura) |
| 6 | validación UI | implícita (solo navegación) |
| 7 | reporte + memoria | implícita |

**Bloqueos por defecto:** PASOS 3 y 4 requieren OK explícito. PASOS 1, 2, 5, 6, 7 son seguros (no destructivos en producción).

**Alternativa de aprobación combinada:** el usuario puede aprobar la cadena entera con una sola autorización (`"ejecutá todo del 1 al 7 sin pausar"`).

---

## Plan de rollback por paso

| Paso | Si falla | Acción de rollback |
|------|----------|--------------------|
| 1 | JSON inválido | abortar, pedir re-paste. No hay cambios. |
| 2 | env var no se setea | `netlify env:unset GOOGLE_SERVICE_ACCOUNT_JSON`. No hay cambios productivos. |
| 3 | commit / push falla | abortar. Working tree restaurable. |
| 4 | deploy rompe build | `netlify rollback --id=<prev>` |
| 4 | deploy verde pero runtime error | revisar logs, hot-fix o rollback |
| 5 | smoke test falla post-deploy | diagnóstico: env vars no aplicadas, scope wrong, etc. Rollback condicional. |
| 6 | UI funcional rota | corregir front-end + redeploy. Si crítico: rollback. |
| 7 | reporte | no rollback necesario |

---

## Salidas esperadas del GATE

Si todo OK:

- ✅ `docs/DRIVE-INTEGRATION-REPORT.md` con tabla 7 filas todas PASS
- ✅ env vars `GOOGLE_SERVICE_ACCOUNT_JSON` (secret) + `GOOGLE_DRIVE_ROOT_FOLDER_ID` en producción
- ✅ Deploy nuevo identificable + URL única
- ✅ Smoke tests verdes en producción
- ✅ /drive listando contenido real autenticado
- ✅ /anmat con pill "Drive conectado"
- ✅ memoria persistente actualizada
- ✅ task #10 cerrada

Si algo falla:

- ❌ rollback al deploy previo conocido
- ❌ env vars NO se borran (quedan persistentes para próximo intento)
- ❌ reporte parcial documentando el fallo + causa raíz + plan de re-intento

---

## Restricciones honradas en este documento

- 🛑 NO DEPLOY — todos los comandos van con prefijo "No ejecutar todavía"
- 🛑 NO MERGE — sin operaciones sobre `main`
- 🛑 NO PUSH — sin transferencia a remote
- 🛑 NO COMMIT — sin cambios al working tree
- 🛑 NO PRODUCCIÓN — sin tocar env vars de Netlify
- 🛑 NO CARGAR CREDENCIALES — el plan referencia variables ficticias (`$JSON_PASTED`, `$FOLDER_ID`)
- 🛑 NO INVENTAR — comandos, hashes y nombres de archivos son verificables en working tree

---

## Listo para recibir credenciales

Cuando entregues:

```
FOLDER_ID:
<id>

SERVICE_ACCOUNT_EMAIL:
<email>

JSON:
<contenido>
```

ejecuto PASOS 1, 2, 5, 6, 7 de corrido y **paro en PASO 3/4** para pedir OK explícito.

Si querés que tampoco pare entre 3 y 4 (deploy automático tras commit), avisame en el mismo mensaje con el equivalente a `"PASO 3 y 4 autorizados"`.
