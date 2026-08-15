# WAIVER · `T-C1-05` · PR #66 · FASE A

> **CUSTODY continúa técnicamente en rojo: 450/451.**
> La única falla se informa `WAIVED BY DIRECTION`; esta dispensa no la
> convierte en PASS y no reutiliza ningún waiver de Nexus Link.

## Decisión expresa de Dirección

- Fecha: `2026-08-15`.
- Expediente: PR #66 · Clientes nativos, Compras y Órdenes de Servicio · FASE A.
- Rama local/publicación: `candidate/clientes-ordenes-precios-rbac-r1` (clon correctivo aislado).
- Rama de publicación: `candidate/clientes-ordenes-precios-rbac-r1`.
- Base/HEAD: `2ee31f815695cbfb88a6a87e8194e12d9cbbaa58`.
- Segundo padre preservado: `0d5379751ed554f8d384d0f6b73f54c95ef2c8d8`.
- Resultado autorizado: exactamente **450/451**, una sola falla y ninguna otra.
- Test: `T-C1-05`.
- Aserción autorizada: línea 268, «sólo cambia el ÚNICO archivo autorizado del harness vanilla».

Dirección sustituyó y dejó sin efecto para PR #66 la condición anterior de
449/451 con dos fallas. Esta resolución es nominativa: no continúa
implícitamente una dispensa previa y no extiende las identidades cerradas de
los waivers de Nexus Link.

## Identidad funcional post-remediación autorizada

```text
tree_funcional        = bb705716e86302cdddf3f3549695c24ce2cbdd60
fingerprint_funcional = c8fe78c4328b1a71379400476ef3f4a56b843840ec3da7f3f95f7a025595002a
rutas_funcionales     = 119
pathlist_nul_sha256   = 9ea943a192643504a38cbea301cfbe3973678dfffca474e491db356ab3e6e370
```

Dirección autorizó después las remediaciones acotadas del destinatario de
correo, continuidad temporal y autorización NULL-bypass, el preflight
adversarial integral, una C4 FINAL 6/6 y el correctivo productivo acotado de
`0243` que preserva dos excepciones históricas mediante `NOT VALID`. Las
decisiones exigieron recalcular la
identidad y mantuvieron de forma literal `CUSTODY 450/451 — WAIVED BY
DIRECTION`. Las identidades previas quedan preservadas como checkpoints y son
sucedidas por esta identidad de 119 paths; los nueve paths DB fueron
revalidados y sus hashes actuales se enumeran abajo.

El tree y fingerprint anteriores son los del candidato funcional corregido,
congelado antes de agregar o actualizar esta evidencia. Para resolver la
autorreferencia inevitable, `docs/waivers/**` queda excluido exclusivamente de
esa identidad funcional. El tree final que transporte el waiver se congela y
verifica por separado antes de C4 y del commit. Cualquier modificación de los
119 paths funcionales invalida automáticamente esta dispensa.

## Única falla autorizada

```text
Test Files  1 failed | 20 passed (21)
Tests       1 failed | 450 passed (451)
Assertion   tests/custody-db/t-c1-05-append-only-vanilla.test.ts:268
Código      VANILLA_NO_AUTORIZADO
```

La falla alcanza exactamente estos nueve paths. Todos pertenecen al DB
Harness de FASE A: prueban migraciones y rollbacks, o mantienen sus
manifiestos, clausura y conteos fail-closed.

| # | Path | SHA-256 | Categoría y justificación |
|---:|---|---|---|
| 1 | `tests/db/harness/clientes-closure.ts` | `41be224434bf791641267ff0f84425ba62369d8f85b3b3f31cc646415a74299f` | DB Harness · clausura exacta de migraciones y rollbacks de Clientes. |
| 2 | `tests/db/scripts/expected-suite.mjs` | `2c0dbd89b1ac4955c5195598a44b8382e5e904d9ead45b7609a782f6d139e302` | Manifiesto del DB Harness · conteo exacto de 851 casos. |
| 3 | `tests/db/t-a0-10-manifest.test.ts` | `63615059f97b9f1448eaf8a5838e16b29433ef819013c28d7d5d471494883d9e` | DB Harness · verifica el manifiesto y las guardas estructurales de FASE A. |
| 4 | `tests/db/t-a0-13-run-report.test.ts` | `0eef665c6500b478228ccf79fff337b88b5b1418eed7caeea25a5c9b58bc3c7d` | DB Harness · reporte 851, fallos y residuos fail-closed. |
| 5 | `tests/db/t-cli-a1-01-clients-search.test.ts` | `083c2331728b5693dd18c9197d6e778869ffed7fcc0cbf31f108dae7517c0815` | DB Harness · migración de búsqueda e identidad de Clientes. |
| 6 | `tests/db/t-cli-a1-02-clients-master-rollback.test.ts` | `beec93a69ee7aa3a21fa3ce56323a745d2df8cec5e928d10fd51efb681dccc1b` | DB Harness · rollback y reaplicación del maestro nativo. |
| 7 | `tests/db/t-cli-a2-01-atomic-mutations.test.ts` | `0aee9e098393dc0fcabaf2dd8c9de6f2e90811b38de07c579af744dd1c5071e3` | DB Harness · CUIT, CAS, concurrencia, auditoría atómica y autorización fail-closed. |
| 8 | `tests/db/t-pr66-01-order-pricing.test.ts` | `28aafbe9824d634817e7d6acbfda0b376cc8f92d4b8a992a8ac2e7de481469cf` | DB Harness · migraciones/rollbacks de tarifarios, OS y matriz adversarial de autorización. |
| 9 | `tests/db/t-pr66-a1-purchase-order-integrity.test.ts` | `1bf6f42f55a55efaed773e4417bcd58a40a33055d832cdb528cdb756ec6a5b76` | DB Harness · migración/rollback de OC, conciliación y preservación prod-shaped de dos excepciones legacy bajo `NOT VALID`. |

`tests/db/harness/manifest.ts` también cambia, pero es el único path que el
invariante vanilla autoriza y no integra la lista de nueve violaciones.

## Evidencia congelada

| Control | Resultado |
|---|---|
| Correctivo `0243` · PostgreSQL 17 prod-shaped | **7/7 PASS**; preserva exactamente dos deltas `0.20/0.40`, aborta una tercera anomalía, rechaza `INSERT/UPDATE` nuevos incompatibles y prueba rollback lógico |
| Focales adversariales NULL/ACL | **97/97 PASS**, incluidas guardas estructurales y controles positivos |
| Unitarias | **3654 PASS**, una omisión manual histórica |
| Typecheck | **PASS** |
| Lint | **PASS**, seis warnings históricos de `react-pdf` |
| Build | **PASS**, 110/110 páginas |
| DB Harness | **851/851 PASS**, 40 archivos, cero residuos |
| Linaje | **230 entradas; 209 ejecutables; 21 no ejecutables; reproducible** |
| CUSTODY | **450/451 — una falla WAIVED BY DIRECTION** |
| Resto de CUSTODY | **20/20 archivos PASS; T-C4-01 49/49 PASS** |

## Invalidación automática y límites

El waiver queda automáticamente inválido si cambia el tree o fingerprint
funcional, aparece un décimo path `VANILLA_NO_AUTORIZADO`, aparece otra falla,
o algún path alcanzado pertenece a Link, Sidebar, `0245`, RBAC de encargados,
Custodia funcional o Tracking.

No dispensa lógica funcional, seguridad, aislamiento, migraciones, rollback,
linaje, manifiestos ni regresiones. No autoriza FASE B, merge, migraciones
productivas, deploy, Supabase productivo, Netlify ni producción.
