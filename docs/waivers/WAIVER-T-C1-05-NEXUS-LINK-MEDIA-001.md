# WAIVER · `T-C1-05` · expediente `NEXUS-LINK-NOTIFICATIONS-MEDIA-001`

> **El resultado técnico de Custodia es ROJO y sigue siéndolo.**
> Este documento no lo pone en verde, no lo reinterpreta y no lo promedia. La
> suite `custody-db-harness` falla, el check de CI figura en rojo y así debe
> reportarse en todas partes. Lo único que hay acá es una **decisión separada de
> Dirección** de no detener el candidato por dos aserciones nominadas, junto con
> la evidencia de por qué esas dos —y sólo esas dos— eran inevitables.
> Dispensar ≠ aprobar. El defecto técnico queda registrado, no borrado.

El nombre de este archivo es el del **expediente**, no el de una PR ni de un
corte particular: sigue siendo válido a través de H1 y H2, cerrados en cortes
sucesivos del mismo candidato.

- Expediente: `NEXUS-LINK-NOTIFICATIONS-MEDIA-001` · **FASE B** (H1 + H2)
- Test: `tests/custody-db/t-c1-05-append-only-vanilla.test.ts`
- Rama: `candidate/link-media-fase-b` · base de comparación `b6f2eaab`
- PR: **#67** (abierta, sin mergear)
- Corte de esta reconciliación: **2026-08-14** (cierre de H1 + H2, **corrección post-C4**:
  CAS multi-adjunto de WhatsApp y frontera de operadores en `media-send.ts`)

Reconciliación por **aserción**, no por archivo. `T-C1-05` **no** se clasifica
globalmente como waived: de sus 30 casos, **28 pasan** y sólo dos quedan
dispensados, cada uno con su evidencia completa.

---

## Identidad del delta dispensado

La dispensa está ligada al **contenido del delta**, no al commit que lo
transporta. Ligarla al commit sería circular. Se excluye **todo el directorio
`docs/waivers/`**, no sólo este archivo, para que editar documentación de
dispensa tampoco altere la huella.

```
huella_delta = 0b9acadbb6c683e17d5a2f59a63723af5c07f75ac26db848c5049ddc679bf2a2
rutas        = 59   (62 del delta, menos los 3 archivos de docs/waivers/)
base         = b6f2eaab
```

Huella ANTERIOR de este mismo expediente (corte previo, ya inválida):
`1a5c0c45a2b85b5589628d2ca60ce64aa128068538cbc7c4428fe9fd90de8bee`. Cambió
porque este corte corrige dos hallazgos de la revisión C4 sobre H1+H2 —el CAS
compartido entre adjuntos de un mismo lote de WhatsApp y la frontera de
operadores no consultada en `media-send.ts`— detallados en el addendum de
`C4-REVISION-ADVERSARIAL-NEXUS-LINK-MEDIA-001.md`. El conjunto de **rutas** no
cambió (siguen siendo las mismas 59); sólo el **contenido** de 5 de ellas.

Reproducible sin depender de este archivo:

```bash
git diff --name-only b6f2eaab -- | grep -v '^docs/waivers/' | LC_ALL=C sort \
  | while IFS= read -r p; do printf '%s\0%s\n' "$p" "$(shasum -a 256 "$p" | cut -d' ' -f1)"; done \
  | shasum -a 256
```

Si esa huella cambia, **la dispensa deja de aplicar** y hay que rehacer la
reconciliación.

---

## Por qué falla `T-C1-05`, y por qué eso no es un defecto del candidato

Es un invariante del expediente de **Custodia**: fija que la rama en curso no
toque el arnés vanilla ni el frente Connect/WhatsApp. Está escrito para *ese*
frente. Un expediente cuyo objeto ES Connect y WhatsApp lo viola por definición,
y lo violaría igual aunque el candidato fuera perfecto. Medido además: el caso
falla **también sobre `main`** con la forma actual del árbol; sólo pasa con la
forma que introduce la PR #59. Es incompatibilidad estructural entre dos
expedientes, no una regresión de éste.

---

## Aserción 1 — `WAIVED` (6 paths bajo `tests/db/`)

**`t-c1-05:267`** — *«sólo cambia el ÚNICO archivo autorizado del harness
vanilla»* — `VANILLA_AUTHORIZED_CHANGES` (`t-c1-05:256`) admite un solo archivo;
`tests/db/harness/manifest.ts` es ese archivo y no figura abajo.

| # | Path | sha256 (completo) | Contenido del cambio |
|---|---|---|---|
| 1 | `tests/db/scripts/expected-suite.mjs` | `637cfcb8ff04d524e8d45ba6ad1601165dec4ea2ece001dd589387c97874f7a0` | Inventario fail-closed: agrega h1-01 (34 casos) al universo declarado |
| 2 | `tests/db/t-a0-13-run-report.test.ts` | `9b1bbb58aa1a8982bb1d64b766cfd9a1c1cf4f8872a3cd560a8c6b11d9034f54` | Total derivado: 687 → 721 |
| 3 | `tests/db/t-link-b1-01-channel-boundary.test.ts` | `8893ce7d86250156fc40d66fb22b2fcc6a1b9fdfc4bec527942e3d4404c159e5` | Corregida columna `label` (defecto de C5, ver cabecera de `0236`) |
| 4 | `tests/db/t-link-b1-02-channel-rls.test.ts` | `b4b5c4738ff60d6ca0713d1e901765d1f48cd36d5a6f6ca3b362be2cd15b79fa` | Corregida columna `label`; describe del teléfono del contacto y del hallazgo abierto de `connect_participants` |
| 5 | `tests/db/t-link-b2-01-upload-lifecycle.test.ts` | `61272dce52e23a7898d01d231c5774d0d496867a112978e1e85c672725e3f13d` | Corregida columna `label` (mismo defecto) |
| 6 | `tests/db/t-link-h1-01-participants-channel-rls.test.ts` | `522473838ebdcfc4fb7516d40b9c8ae62b862629eb5c824bcc01ed32e3198af7` | **NUEVO** — entorno C5: esquema REAL derivado de main (no sintético), cierre de H1, 34 casos |

Ninguno toca semántica, seguridad, linaje, checksum, rollback ni regresión
funcional ajena a este expediente: son pruebas nuevas o corregidas, y los
registros que el propio arnés obliga a mantener sincronizados con ellas.

---

## Aserción 2 — `WAIVED` (38 paths que matchean `/whatsapp|connect|Sidebar/i`)

**`t-c1-05:356`** — *«no se tocó ningún path de WhatsApp, Connect ni Sidebar»*
— es literalmente el objeto del expediente.

| # | Path | sha256 (completo) | Contenido del cambio |
|---|---|---|---|
| 1 | `src/app/(app)/connect/_components/AttachmentComposer.dom.test.tsx` | `a01a589a877af2c6580252da5927d8b5fdfcf85e948b219a916bbdca470e23d6` | H2: 3 casos `failed`/`reconciliation_required`/`sent` **+ 4 casos NUEVOS** (corrección C4): dos adjuntos de WhatsApp en un lote finalizan con `client_msg_id` distintos, cada envío declara `attachmentCount=1`, el lote interno sigue compartiendo uno, y el reintento de un archivo conserva SU propio id |
| 2 | `src/app/(app)/connect/_components/AttachmentComposer.tsx` | `b4319a63d6309216a046d4867dda499756e3c7cb719229e772ae05d2595277ac` | H2: estado `incierto` (sin cambios) **+ corrección C4**: en WhatsApp cada adjunto del lote acuña (o conserva, si ya lo tenía por un reintento) su PROPIO `clientMsgIdPropio` vía `marcar()`, en vez de compartir el `client_msg_id` del lote — cierra el CAS compartido que dejaba "enviados" adjuntos que Meta nunca recibió |
| 3 | `src/app/(app)/connect/_components/ThreadView.dom.test.tsx` | `4d093fea261f9be7acf85c0913878425d858ccf15fd490efc6257d3b1e3e3964` | Mocks de `nexus-link` y `media-send` (cadena `server-only` transitiva nueva) |
| 4 | `src/app/(app)/connect/_components/ThreadView.tsx` | `da15fb07d4584d8d483d05e08afba82769892f89bc0fd4e742b7b3b2b9a494ad` | **Corrección C4**: agrega `kind={kind}` al render de `<AttachmentComposer>` — sin este prop el composer no puede distinguir un hilo de WhatsApp y la corrección del CAS multi-adjunto no se activa |
| 5 | `src/app/(app)/connect/_components/WaContactCard.dom.test.tsx` | `271b3221746e2305bbf72ad6c19b8af05abb07df62455a426f5477ec2ece39c8` | Ficha de contacto — corte de H1 |
| 6 | `src/app/(app)/connect/_components/WaContactCard.tsx` | `daec940759086a1d7258eddfcb2674ea47b6e76a218f38afef40fa1e8cf004d8` | Ficha de contacto — panel por portal, foco atrapado (corte de H1) |
| 7 | `src/app/(app)/connect/buscar/page.tsx` | `b911c224edf220f134581cccc1df5c214620287f43e93bfb613c4c8cf8d3937f` | `etiquetaDeContexto` en vez del `context_id` crudo (corte de H1) |
| 8 | `src/app/(app)/connect/c/[conversationId]/page.tsx` | `e542d6d4737be8d10efc75588c00184a6ee2fc90c63e1669e9f95271d5564422` | Ficha de contacto + corrección de layout (corte de H1) |
| 9 | `src/app/(app)/connect/page.tsx` | `dac5511a6c3710df953b1b4eeb2db9830f5a9ca15d5c546a40bb8c91bbfe4cf5` | Guarda de canal en la bandeja |
| 10 | `src/app/(app)/connect/wa-import/page.tsx` | `76c7333ebcde3ca4c10b46f82f7c5479e34f841744a05787ba930611088529ae` | Guarda de canal en el importador |
| 11 | `src/lib/connect/adapters/driving/attachment-actions.ts` | `96f381cf05e4b6926a8af811f864bf16fdf43790128a24acc2fb1e791acae2a1` | **H2**: cablea `sendWhatsappMediaForAttachment`; corrige la comprobación de membresía (corte de H1) |
| 12 | `src/lib/connect/adapters/driving/attachment-actions.wa.test.ts` | `8b5806f5e54aeaab2b298503fcc6cd7b1c366d5deaaa9ac011261bc62fb82e4f` | **NUEVO** — 9 casos: ruteo WhatsApp/interno, archivo rechazado, teléfono inválido, retry, propagación honesta |
| 13 | `src/lib/connect/adapters/driving/audio-actions.ts` | `38b68936be08e2b1aad461bfc9a3f3367fcffb4755085c9a06798840f2221485` | **H2/H4**: cablea el envío y agrega la capacidad de canal que antes faltaba |
| 14 | `src/lib/connect/adapters/driving/audio-actions.wa.test.ts` | `6aeb479a09617c4d1f47cb30510d68b829e50eb34b493bac20255860efc9badc` | **NUEVO** — 6 casos: capacidad de canal + ruteo |
| 15 | `src/lib/connect/attachments/client-precheck.test.ts` | `a61ed70b3cea0a98c564d6f31663cdaa2494766ec18e3f66dd30e9a1924af368` | FASE B original |
| 16 | `src/lib/connect/attachments/client-precheck.ts` | `aac2e90622e2593cbf64803242fc4e1852d8372a702a59f31dba2df88875ab54` | FASE B original |
| 17 | `src/lib/connect/attachments/ooxml.test.ts` | `8f7e6225c2e89237391bd2844046aada207628e37a7505fa83d7b1ea3dfaae1a` | FASE B original |
| 18 | `src/lib/connect/attachments/ooxml.ts` | `cba303fdfda8d3bf50ea25f855704a509083b2ece8f6cf6cbe26298c426178b0` | FASE B original |
| 19 | `src/lib/connect/attachments/validate.test.ts` | `09214f00565b348304b00499591da24055c9b26e1136eaccf3957d30cc4ee7de` | FASE B original |
| 20 | `src/lib/connect/attachments/validate.ts` | `02350b2ddee53ac05f4f3e213c60a1342bc24d3650a014544ad19f6e38609563` | Corrección del byte NUL literal (corte de H1) |
| 21 | `src/lib/connect/audio/recorder.ts` | `a9306bd2d965fb3cf3330af229153fc73c289a09e9ca32c09534eb1cfb70631d` | FASE B original |
| 22 | `src/lib/connect/composer-policy.test.ts` | `2beb5185c5625026720911b6a36f8adbb521d6b92846fc0f15497d2d732c5246` | FASE B original |
| 23 | `src/lib/connect/composer-policy.ts` | `f0358f03c95df4a8ffe6d85ebcaf6ed36a9413b7b44e3a378eca14e905c887c5` | FASE B original |
| 24 | `src/lib/connect/read/wa-contact.test.ts` | `2b5f1d7c2fc05823a143cbd4424f34f1ccb5223bdb134fd91f7f9c2f49a3557b` | Autorización de la ficha (corte de H1) |
| 25 | `src/lib/connect/read/wa-contact.ts` | `67922a5fb2aaf91bc3f8be494760587a1470f8dbcf131f637a22daeb18d9569f` | Declara el alcance real de la frontera; el hallazgo H1 estaba fuera de ella (corte de H1) |
| 26 | `src/lib/whatsapp/contact-identity.test.ts` | `99f5516f08ef0b8a639e7defefb583f4f2b7031ed5836c36e83dc1b05de8a0e7` | Identidad, formato y `etiquetaDeContexto` (corte de H1) |
| 27 | `src/lib/whatsapp/contact-identity.ts` | `65e572e800e167606a465d2e501c9a274bd5c33869b7d7a0fca6a1cc7625e2c9` | E.164 estricto + formato legible + `etiquetaDeContexto` (corte de H1) |
| 28 | `src/lib/whatsapp/media-no-secrets.test.ts` | `75785ebb010c95050785b870a4df681442002cdcfe88eee2ef3ac1ad88350773` | **NUEVO** — 8 casos: cero `console.*`, cero token interpolado, `wamid` sin `media_id` crudo |
| 29 | `src/lib/whatsapp/media-send-core.test.ts` | `9ee1867abb048f04eac3b7621c99930733732183c4f8b82b70842138afd4f2c7` | FASE B original (núcleo puro, sin cambios este corte) |
| 30 | `src/lib/whatsapp/media-send-core.ts` | `bf870ba5ff3a8b34cce6fbdd79594858ea6ac9a1db9e0db7e17a7539cbc96aa1` | FASE B original (núcleo puro, sin cambios este corte) |
| 31 | `src/lib/whatsapp/media-send.runtime.test.ts` | `48a2376f9227d1394ce234ab7f7de9f14121e831097bd892e865b0df84fbb7fb` | 14 casos originales (la costura reutiliza el CAS del texto; transporte real/inyectado) **+ 4 casos NUEVOS** (corrección C4): sin actor no consulta la allowlist, actor fuera de la allowlist falla sin tocar Meta, la denegación queda auditada como `reply_denied`/`not_operator`, operador autorizado no rompe el camino feliz |
| 32 | `src/lib/whatsapp/media-send.ts` | `ae79abfbdd4d0def000cb5f26d899ca6c1c69a1c91293bcb0202d030623d918b` | Adaptador productivo H2: reutiliza `createSupabaseReplyPorts().state` (sin cambios) **+ corrección C4**: ahora TAMBIÉN consulta `.session.getActor()` + `.operators.isAuthorized()` del mismo objeto — antes se construían y se descartaban sin usar, dejando la media sin la frontera de operadores que el texto sí exige |
| 33 | `src/lib/whatsapp/media-transport.test.ts` | `8fe5cccd031c4c2a5e40cd31ea2198dbb39d0a477f9c9b51010c0aeb16705884` | FASE B original |
| 34 | `src/lib/whatsapp/media-transport.ts` | `a77b1a095413058d9bd07056541f3f83dce3d9a4391cd2e11f59363efd06c66e` | FASE B original |
| 35 | `src/lib/whatsapp/opus-remux.test.ts` | `43010a4b65012c35b3856f74b0bc4e2fdc199a745bdf18d32570dbdc9a45138e` | FASE B original |
| 36 | `src/lib/whatsapp/opus-remux.ts` | `75a8789042b27798b2b8974fa232d8d37c9dcd970a4f44a613499c7031d3a910` | FASE B original |
| 37 | `src/lib/whatsapp/reply-action.ts` | `9de58621a399c3bbf59ef8d232576ef9dbb66b60a865621c50f4419ee3754663` | Guarda de canal en la server action de texto |
| 38 | `src/lib/whatsapp/send-route.test.ts` | `6bd4352855264bb0f0afcd2c0d2295f73681c14cff107db2fa6eddbe5a0de7ce` | FASE B original |

**Fuera de las dos tablas (15 paths), sin patrón `whatsapp|connect|Sidebar` ni
bajo `tests/db/`**, y por lo tanto **no cubiertos por ningún waiver** —
`src/lib/rbac/nexus-link.ts`, las cinco migraciones `0235a`–`0239` con sus
`ROLLBACK`, `supabase/lineage/{catalog.json,BACKFILL-SIMULATION.json}`,
`tests/custody-db/t-c4-01-lineage-catalog.test.ts` y
`tests/db/harness/manifest.ts` — es decir, corren en Custodia **sin dispensa**
y ya están en verde por sí mismos (`T-C4-01`: 49/49).

---

## Conteos reales de este corte

| Suite | Archivos | Casos | Resultado |
|---|---|---|---|
| Unitaria (`vitest.config.ts`) | 183 + 1 omitido (184) | **3 364** aprobados · 1 omitido | PASS — sube de 3 356 por los 8 casos nuevos de la corrección C4 (4 en `media-send.runtime.test.ts` + 4 en `AttachmentComposer.dom.test.tsx`) |
| Arnés de base (`npm run test:db`) | 35 | **721** | PASS · los cuatro gates PASS — sin cambio: la corrección C4 no toca ningún archivo de `tests/db/` |
| Custodia (`npm run test:custody:db`) | 21 (1 en rojo) | **449 / 451** | **ROJO** — exactamente las dos aserciones de arriba, verificado de nuevo tras la corrección C4, sin tercera falla |
| Linaje `T-C4-01` | incluido en Custodia | 49/49 | PASS — catálogo con `0235a`/`0239`, `huella` consistente (sube de 21 al contarse también los mutantes de reescritura agregados en este expediente) |
| `next tsc --noEmit` | — | 0 errores | PASS |
| `next lint` | — | 0 errores (6 avisos preexistentes, ajenos al delta) | PASS |
| `npm run build` | — | exit 0 | PASS |

---

## Lo que este waiver NO cubre

Se dispensan **dos aserciones nominadas** de `T-C1-05` y nada más. En
particular **no** se dispensa:

- ningún otro caso de `T-C1-05` (los 28 restantes están en PASS);
- ninguna otra suite de `tests/custody-db` (20 de 21 en PASS);
- el gate de linaje `T-C4-01`, que **pasa** limpio, sin dispensa;
- los gates de base ni la suite unitaria.

**Si `T-C1-05` empezara a fallar por un caso distinto de estos dos, este waiver
no aplica y el candidato debe detenerse.** Lo mismo si cambia la `huella_delta`.

## Secuencia real del conteo de Custody en este expediente

| Momento | Resultado |
|---|---|
| Tras `0236`, antes de registrar inventarios | 446 / 451 |
| Tras registrar `0236` en los tres inventarios | 448 / 451 |
| Con `0236` + `0237` y sus dos suites | 449 / 451 |
| Con `0238`, su suite y el composer (tocando `vitest.config.ts` por error) | 448 / 451 |
| Tras restituir el config y reubicar la prueba | 449 / 451 |
| Con la ficha de contacto y la corrección del byte NUL (cierre de H1, primer intento) | 449 / 451 |
| Con `0235a`/`0239` y el entorno C5 (cierre de H1, final) | 449 / 451 |
| Con el cableado de H2 (adaptador, wiring, UI, 37 tests nuevos) | 449 / 451 |
| **Con la corrección de los dos hallazgos de C4 (CAS multi-adjunto + frontera de operadores, 8 tests nuevos)** | **449 / 451** |

No se reportó `450 / 451` en ningún momento de este expediente: el objeto
mismo del expediente (Connect + WhatsApp) es lo que la Aserción 2 prohíbe, así
que 28/30 es el techo real de `T-C1-05` mientras este candidato exista.

## Alcance

Sólo estas **dos aserciones**, sólo sobre esta `huella_delta`. Cualquier cambio
del delta deja el waiver sin efecto. No cubre ningún otro test, gate ni
defecto, y el check agregado de Custodia se reporta **rojo**, nunca verde.
