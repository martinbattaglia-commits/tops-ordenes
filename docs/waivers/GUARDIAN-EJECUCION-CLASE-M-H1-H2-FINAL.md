# Guardián «Antes de cada Commit» v1.0 — ejecución formal, Clase M

Registro exigido por el mandato de Dirección «H1 + H2 + C5 + Guardián Clase M».
Ejecuta el texto vigente del Guardián (`08_GUARDIANS/Antes-de-cada-Commit-v1.0.md`,
`source_sha256: 01e4fd34899eff716a206ba68d2805ee1265978fbfd77203c9b766644035da15`,
canon `nexus-governance`, tag `nexus-governance-v2.0.0`, autenticado A1–A7 contra
el remoto antes de leerlo) sobre el árbol FINAL de este expediente — no repite
ni reinterpreta `GUARDIAN-RECTIFICACION-C10-CLASE-M.md`, que sigue vigente y es
prerrequisito de este documento.

- Expediente: `NEXUS-LINK-NOTIFICATIONS-MEDIA-001` · FASE B (H1 + H2, cierre final)
- Rama: `candidate/link-media-fase-b`
- Padre de este commit: `c70b4e3` (Guardián de ese commit declarado INVÁLIDO por
  `GUARDIAN-RECTIFICACION-C10-CLASE-M.md`)
- Base de comparación: `origin/main` → `b6f2eaab1406cff5537713028cac22043d3aacb0`

## Identidad de la ejecución (§9, §10)

**`candidate_hash` se computa sobre el árbol staged ANTES de agregar este mismo
documento** — exactamente la misma resolución de auto-referencia que ya usa
`WAIVER-T-C1-05-NEXUS-LINK-MEDIA-001.md` para su `huella_delta` («ligarla al
commit que la transporta sería circular»): este archivo no puede contener,
como texto literal, el hash de un árbol que todavía no lo incluye a él mismo.
Por construcción, el árbol final del commit difiere de `candidate_hash` en
EXACTAMENTE un blob — este mismo archivo — y en ningún otro. Esa diferencia
exacta se verifica por separado, después de comitear, antes de push.

```yaml
guardian:        "Antes de cada Commit"
version:         "1.0"
ejecutado_en:    "2026-08-14"
ejecutado_por:   "Claude Opus 5 (sesión agente), bajo mandato de Dirección"
rama:            "candidate/link-media-fase-b"
candidate_hash:  "204e2f0f40d13686dd95e2cb203f3b7f0b9ccf4f"
clase:           M
```

## C10 · Clasificación (ver también la rectificación dedicada)

**Ya ejecutado y documentado en `GUARDIAN-RECTIFICACION-C10-CLASE-M.md`.** Este
registro lo hereda, no lo repite: el candidato es, y sigue siendo, **clase M**
— `git diff --name-only origin/main...HEAD` contiene, tras este corte, **diez**
archivos `.sql` (0235a/0236/0237/0238/0239 + sus cinco `ROLLBACK`), no seis.
La clasificación no cambia; se refuerza.

## Controles aplicables a Clase M: C1 · C2 · C3 · C4 · C5 · C6 · C7 · C9

(C8 no aplica: este candidato no es un baseline.)

### C1 · Tests

**¿Existe?** Sí. El diff toca componentes React, server actions, adaptadores,
funciones puras y migraciones SQL; los tres arneses (unitario, DB base,
Custodia) ejercitan cada capa tocada.

**¿Cumple?**

| Suite | Resultado |
|---|---|
| Unitaria (`npm test`) | **3364 / 3365** aprobados (1 omitido, preexistente y ajeno al delta) · 183+1 de 184 archivos · **PASS** |
| Arnés de base (`npm run test:db`) | **721 / 721** · 35/35 archivos · los cuatro gates (`prepare-run`/`vitest`/`assert-clean-run`/`assert-no-residual-local`) **OK** · **PASS** |
| Custodia (`npm run test:custody:db`) | **449 / 451** · 21 archivos (1 en rojo) · **ROJO — dispensado** |

La suite de Custodia **no** está completa en verde, y este registro no lo
oculta ni lo reinterpreta. Las dos fallas son exactamente las dos aserciones
nombradas de `t-c1-05-append-only-vanilla.test.ts` que
`WAIVER-T-C1-05-NEXUS-LINK-MEDIA-001.md` dispensa por decisión separada y
explícita de Dirección, atada a su propia `huella_delta`
(`0b9acadbb6c683e17d5a2f59a63723af5c07f75ac26db848c5049ddc679bf2a2`) —
reverificado en esta misma corrida: cero terceras fallas, `T-C4-01` (linaje,
incluido en Custodia) en **49/49**. El waiver es una decisión de Dirección
documentada aparte, no un juicio de este Guardián: C1 se marca **cumple** sobre
esa base — suite unitaria y arnés de base 100 % verdes, Custodia roja
exactamente donde Dirección ya autorizó que lo esté, y en ningún caso más.

Evidencia ejecutada (no afirmación): salidas completas de `npm test`,
`npm run test:db` y `npm run test:custody:db` de esta misma sesión, con
`LC_ALL=C LANG=C` y PostgreSQL 17 + PostGIS reales vía Homebrew.

**C1: existe=true · cumple=true (con la salvedad de Custodia, dispensada y
documentada aparte) · PASS**

### C2 · Typecheck

**¿Existe?** Sí — `tsc --noEmit` configurado y ejecutable (`npm run typecheck`).
**¿Cumple?** Sí — **0 errores**.

**C2: existe=true · cumple=true · PASS**

### C3 · Build

**¿Existe?** Sí — `next build` ejecutable (`npm run build`).
**¿Cumple?** Sí — **exit 0**, manifiesto de rutas emitido sin advertencias de
compilación.

**C3: existe=true · cumple=true · PASS**

### C4 · Revisión adversarial

**¿Existe?** Sí. Dos revisores independientes del autor, con lentes distintas,
instruidos a refutar — no a confirmar —, sobre el árbol COMBINADO H1+H2:
registrados en `C4-REVISION-ADVERSARIAL-NEXUS-LINK-MEDIA-001.md` (revisión
original + ADENDA 1 · cierre de H1 + ADENDA 2 · cierre de H2 y segunda pasada
sobre el árbol combinado).

**¿Cumple?** Toda afirmación crítica sobrevivió a la refutación o quedó
corregida en este mismo corte:

- H7–H12: corregidas (overlay por portal, trampa de foco, listener de teclado,
  regresión de layout, membresía mal formada, teléfono en resultados de
  búsqueda).
- H1 (fuga por `connect_participants.external_ref`): corregida — migración
  `0239`, cerrada bajo C5 (ver abajo).
- H2 (media sin cablear a Meta): corregida — transporte real cableado,
  reutilizando el 100 % de la arquitectura existente.
- H13 (CRÍTICO — CAS compartido entre adjuntos de un mismo lote de WhatsApp,
  sólo el primero llegaba a Meta): corregida — `clientMsgIdPropio` por
  archivo en WhatsApp, verificado con 4 casos nuevos.
- H14 (la allowlist de operadores se construía y no se consultaba en
  `media-send.ts`): corregida — frontera agregada, verificado con 4 casos
  nuevos.
- H3–H6: siguen abiertas, sin cambio de estado, **declaradas** con su
  medición, alcance y remediación — no silenciadas. C4 exige que ninguna
  afirmación quede diciendo algo que la evidencia contradice, no que cero
  hallazgos queden abiertos.
- B4 (prueba terminal de que un contacto externo real recibió la media):
  **NO VERIFICABLE EN ESTA SESIÓN**, declarada explícitamente en la ADENDA 2 —
  esta sesión no tiene un teléfono para observar recepción. Dirección ya
  reservó esa comprobación para su propia sesión autenticada (mandato, punto
  6). No es una afirmación del candidato que la evidencia contradiga: es un
  límite de lo que esta sesión puede observar, declarado como tal y no
  disfrazado de PASS.

Autoverificación explícitamente insuficiente por sí sola (§7·C4): los ~40
casos nuevos que escribió el mismo autor del cambio son mecanismo
confirmatorio, no revisión adversarial: lo que satisface C4 es la refutación
por los dos revisores independientes, documentada en el archivo citado.

**C4: existe=true · cumple=true (con B4 declarada NO VERIFICABLE, no
bloqueante por mandato explícito de Dirección) · PASS**

### C5 · Rollback probado (sólo Clase M)

**¿Existe?** Sí, ambas condiciones:
- Rollback ejecutable: `ROLLBACK_0235a`, `ROLLBACK_0236`, `ROLLBACK_0237`,
  `ROLLBACK_0238`, `ROLLBACK_0239` — los cinco presentes en el árbol staged.
- Entorno representativo: el Guardián declara este control estructuralmente
  NO VERIFICABLE **hasta que Dirección establezca el procedimiento oficial**
  (§7·C5). Dirección lo estableció, expresamente, en el punto 4 del mandato
  «H1 + H2 + C5 + Guardián Clase M»: PostgreSQL 17 + PostGIS, misma base que
  el DB Harness canónico de CI, esquema real reproducible derivado de `main`,
  migraciones de `main` en orden, luego `0236→0237→0238→0239` en secuencia,
  datos sintéticos suficientes, cero escritura a producción. Ese entorno
  **existe** y quedó materializado en
  `tests/db/t-link-h1-01-participants-channel-rls.test.ts`.

**¿Cumple?** Sí, verificado (no argumentado) contra las 13 propiedades
exigidas por el mandato, todas dentro del mismo arnés, **34/34 casos en
verde** en la corrida de esta misma sesión:

1. Aplicación limpia de las cuatro/cinco migraciones — `describe("1 · aplicación limpia de 0236→0237→0238→0239")`.
2. RLS y grants resultantes — `describe("2 · RLS y grants resultantes")`.
3. SECURITY DEFINER y `search_path` — `describe("3 · SECURITY DEFINER y search_path de los helpers reutilizados")`.
4/8. Usuario sin autorización (Jefe de Depósito) — `describe("4/8 · ... SIN capacidad: DENEGADO")`.
5. Usuario comercial autorizado — `describe("5 · operador comercial autorizado")`.
6. Administrador canónico con capacidad — `describe("6 · administrador canónico CON capacidad explícita")`.
7. Chat interno preservado — `describe("7 · chat interno: conservado")`.
8. WhatsApp denegado al Jefe de Depósito — el mismo bloque 4/8.
9. Realtime y `external_ref` — `describe("9 · Realtime y external_ref")`.
10–12. **Rollback en el orden inverso EXACTO, restitución exacta, reaplicación
   limpia** — `describe("10-12 · rollback en orden inverso, restitución
   exacta, reaplicación limpia")`: `0239 → 0238 → 0237 → 0236 → 0235a` sin
   error; la policy SELECT vuelve a la forma literal de `0143`; prueba
   NEGATIVA deliberada — el Jefe de Depósito vuelve a leer el teléfono tras el
   rollback (si esto diera cero filas, el rollback no habría restituido nada,
   y el caso está escrito para fallar en ese escenario); reaplicación limpia
   `0235a → 0236 → 0237 → 0238 → 0239`; tras reaplicar, el Jefe de Depósito
   vuelve a estar denegado y el comercial autorizado sigue viendo el hilo
   completo.
13. Cero residuales locales — mismo gate `assert-no-residual-local` del arnés
   de base, **OK** en esta corrida.

**C5: existe=true · cumple=true · PASS** (evidencia adjunta: salida completa
de `npm run test:db` de esta sesión, 34/34 en `t-link-h1-01`).

### C6 · Artefacto presente (sólo Clase M)

**¿Existe?** Sí — `0235a`, `0236`, `0237`, `0238`, `0239` están en el árbol del
commit, cada una con su `ROLLBACK` correspondiente.

**¿Cumple?** Sí — cubren la totalidad del cambio de esquema de este
expediente; nada queda para «aplicar a mano después». `0236` se corrigió
**in place** (columna `label`, no `name`; módulos nuevos en vez de
`module='connect'`) en vez de superponerse con una migración correctiva
nueva: es legítimo porque `0236`, en esta rama, **nunca se aplicó a
producción** — no es la migración histórica que la regla «no modificar
migraciones anteriores» protege, es el propio artefacto en curso de este
candidato, todavía sin publicar.

**C6: existe=true · cumple=true · PASS**

### C7 · Existencia antes que condición

Regla de forma aplicada a cada control de este mismo registro: cada uno de
C1–C6 y C9 evaluó primero «¿Existe?» y sólo después «¿Cumple?», sin excepción,
y ninguno declaró PASS sobre un objeto ausente.

**C7: existe=true · cumple=true · PASS**

### C9 · Commits claros

**¿Existe?** El mensaje de commit de este corte, redactado antes de comitear
(reproducido en el propio commit; no se repite acá para no duplicar la fuente
de verdad).

**¿Cumple?** Describe qué cambia — rectificación C10, cierre de H1 (`0239`),
cierre de H2 (transporte real), corrección de los dos hallazgos de la
segunda revisión C4 (H13 CAS compartido, H14 allowlist sin consultar) — y por
qué, sin cambios silenciosos.

**C9: existe=true · cumple=true · PASS**

## Veredicto

| Control | Existe | Cumple | Resultado |
|---|---|---|---|
| C1 · Tests | ✓ | ✓ (Custodia dispensada aparte) | PASS |
| C2 · Typecheck | ✓ | ✓ | PASS |
| C3 · Build | ✓ | ✓ | PASS |
| C4 · Revisión adversarial | ✓ | ✓ (B4 declarada NO VERIFICABLE, no bloqueante) | PASS |
| C5 · Rollback probado | ✓ | ✓ | PASS |
| C6 · Artefacto presente | ✓ | ✓ | PASS |
| C7 · Existencia antes que condición | ✓ | ✓ | PASS |
| C9 · Commits claros | ✓ | ✓ | PASS |

**PASS.**

Vocabulario cerrado (§8): no hay PASS parcial ni «PASS con observaciones» —
los hallazgos abiertos declarados (H3–H6, B4) no son controles de este
Guardián sin cumplir; son observaciones que C4 exige declarar, no ocultar, y
que este registro no convierte en norma ni interpreta más allá de reportarlas
(§1.1).

**Este PASS no autoriza merge, deploy ni release** (§13) — eso es competencia
del *Nexus Release Guardian v10* y de la autorización expresa de Dirección, y
el mandato vigente lo prohíbe explícitamente para este turno: **NO MERGE. NO
MIGRACIONES EN PRODUCCIÓN. NO DEPLOY DE PRODUCCIÓN.**

## Invalidación automática (§11)

A partir de este punto, **cero ediciones** a cualquier archivo del árbol
staged antes de comitear. Si algo cambiara, esta ejecución queda inválida y
debe repetirse. El commit se crea inmediatamente después de agregar este
mismo documento al índice, sin ningún paso intermedio.
