# WAIVER · `T-C1-05` · expediente `NEXUS-LINK-NOTIFICATIONS-MEDIA-001`

> **Custody continúa técnicamente en rojo: 450/451.**
> Esta dispensa no convierte el resultado en PASS, no modifica Custodia y no
> cubre ninguna falla distinta de la única aserción nominada abajo.

## Decisión vigente de Dirección

- Fecha: `2026-08-15`.
- Base canónica: `origin/main` =
  `5e88b3cac3623178c2e7c4f49ebaf766f468fd62`.
- Rama correctiva: `candidate/link-0239a-acl-corrective`.
- Expediente: `NEXUS-LINK-NOTIFICATIONS-MEDIA-001` · FASE B · correctivo ACL
  post-migración.
- Test: `tests/custody-db/t-c1-05-append-only-vanilla.test.ts`.
- Resultado válido: **450/451** global; **29/30** en `T-C1-05`.
- Migración: `0239a_nexus_link_revoke_trigger_execute.sql`.
- SHA-256 de la migración:
  `6be16e2f73065ca4f390ba4abf31ac5272a7f4889c19c783d0a7f3978683e0cb`.

El anterior resultado 449/451 queda como evidencia histórica. La aserción
*«no se tocó ningún path de WhatsApp, Connect ni Sidebar»* ahora pasa porque
PR #67 ya fue integrada en la base canónica. Queda expresamente retirada de la
dispensa y no puede volver a invocarse como waiver de este correctivo.

## Identidad exacta dispensada

La identidad vinculante es la tupla:

```text
base          = 5e88b3cac3623178c2e7c4f49ebaf766f468fd62
rama          = candidate/link-0239a-acl-corrective
huella_delta  = c39db12e47c937dc341689b012d1784ba25b096da0bbcdf2c8aed39cf8085f49
rutas         = 9 (excluye docs/waivers/ para evitar autorreferencia)
migracion_sha = 6be16e2f73065ca4f390ba4abf31ac5272a7f4889c19c783d0a7f3978683e0cb
```

La huella se reproduce desde el worktree exacto con:

```bash
git diff --name-only 5e88b3cac3623178c2e7c4f49ebaf766f468fd62 -- \
  | grep -v '^docs/waivers/' | LC_ALL=C sort \
  | while IFS= read -r p; do
      printf '%s\0%s\n' "$p" "$(shasum -a 256 "$p" | cut -d' ' -f1)"
    done \
  | shasum -a 256
```

Si cambia cualquier componente de esta identidad, la dispensa deja de aplicar
y debe repetirse la reconciliación.

## Única aserción dispensada

**`T-C1-05` · «sólo cambia el ÚNICO archivo autorizado del harness vanilla».**

El invariante histórico de Custodia autoriza solamente
`tests/db/harness/manifest.ts`. El correctivo ACL agrega seis aserciones SQL y
una adversarial al archivo ya existente de Nexus Link; por el contrato
fail-closed del DB Harness también debe actualizar su inventario exacto. Los
tres paths que hacen fallar esta aserción son:

| Path | SHA-256 | Motivo acotado |
|---|---|---|
| `tests/db/scripts/expected-suite.mjs` | `1b8a618a2bdb3a22a485b12807eefa779813f521e9966b8b22e4ba397ef4ee2d` | Conteo exacto de `t-link-b2-01`: 37 → 44 |
| `tests/db/t-a0-13-run-report.test.ts` | `13e6e1ff600e34c658f9cd36da843195385ea532ff259a6eb5cde4fc8b9c90e2` | Total derivado del DB Harness: 721 → 728 |
| `tests/db/t-link-b2-01-upload-lifecycle.test.ts` | `fff91d047f76764fe876d13ef9f871a3cbaff909556092f39783d813c2fa84e8` | ACL, invocación directa, trigger legítimo y mutantes `REPLICA`/evento incorrecto sobre PostgreSQL real |

Estos cambios pertenecen exclusivamente a Nexus Link. No alteran código,
manifiestos, configuración ni expectativas del arnés de Custodia.

## Evidencia vigente

| Control | Resultado |
|---|---|
| DB Harness | **728/728 PASS**, 35 archivos, reporte fresco, cero residuos |
| Prueba PostgreSQL focal | **44/44 PASS** |
| Linaje `T-C4-01` | **49/49 PASS** |
| Custody sobre `origin/main=5e88b3c…` | **450/451**, sólo la aserción nominada |
| Resto de Custody | **20/20 archivos PASS** |

## Límite fail-closed

Esta dispensa cubre una aserción y nada más. No cubre:

- una segunda falla en `T-C1-05`;
- ninguna falla en otro test de Custodia;
- una divergencia de base, rama, huella o SHA de migración;
- una regresión del DB Harness, del trigger, de ACL o de linaje;
- el resultado histórico forzado contra `b6f2eaa`.

Ante cualquiera de esos casos el candidato debe detenerse. El check de
Custody se reporta **ROJO — dispensado**, nunca verde.
