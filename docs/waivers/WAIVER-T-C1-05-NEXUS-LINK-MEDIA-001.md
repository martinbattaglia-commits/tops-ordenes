# WAIVER · `T-C1-05` · expediente `NEXUS-LINK-NOTIFICATIONS-MEDIA-001`

> **El resultado técnico de Custodia es ROJO y sigue siéndolo.**
> Este documento no lo pone en verde, no lo reinterpreta y no lo promedia. La
> suite `custody-db-harness` falla, el check de CI figura en rojo y así debe
> reportarse en todas partes. Lo único que hay acá es una **decisión separada de
> Dirección** de no detener el candidato por dos aserciones nominadas, junto con
> la evidencia de por qué esas dos —y sólo esas dos— eran inevitables.
> Dispensar ≠ aprobar. El defecto técnico queda registrado, no borrado.

El nombre de este archivo es el del **expediente**, no el de una PR: una
renumeración o una segunda PR del mismo expediente no debe obligar a mover el
documento ni a reescribir referencias. Antes se llamaba
`WAIVER-T-C1-05-PR66-EXPEDIENTE.md`, que además colisionaba nominalmente con el
expediente real de la PR #66, ajeno a éste.

- Expediente: `NEXUS-LINK-NOTIFICATIONS-MEDIA-001` · **FASE B**
- Test: `tests/custody-db/t-c1-05-append-only-vanilla.test.ts`
- Rama: `candidate/link-media-fase-b` · base de comparación `b6f2eaab`
- PR abierta al momento de este corte: **#67**
- Corte de esta reconciliación: **2026-08-14**

Reconciliación por **aserción**, no por archivo. `T-C1-05` **no** se clasifica
globalmente como waived: de sus 30 casos, **28 pasan** y sólo dos quedan
dispensados, cada uno con su evidencia completa.

---

## Identidad del delta dispensado

La dispensa está ligada al **contenido del delta**, no al commit que lo
transporta. Ligarla al commit sería circular: el commit incluye este archivo,
cuyo texto cambiaría la identidad que dice describir. Se excluye el directorio
`docs/waivers/` entero —no sólo este archivo—, de modo que agregar o editar
documentación de dispensa tampoco altere la huella.

La identidad se calcula sobre las **48 rutas del delta EXCLUYENDO
`docs/waivers/`**, como SHA-256 de la concatenación `ruta\0sha256(contenido)\n`
en orden lexicográfico de ruta:

```
huella_delta = bb31f0baa4dc6a505480927737ff28c5958b23b43ff6b9f62d378d00ab5bed02
rutas        = 48   (50 del delta, menos los 2 archivos de docs/waivers/)
base         = b6f2eaab
```

Reproducible sin depender de este archivo:

```bash
git diff --name-only b6f2eaab -- | grep -v '^docs/waivers/' | LC_ALL=C sort \
  | while IFS= read -r p; do printf '%s\0%s\n' "$p" "$(shasum -a 256 "$p" | cut -d' ' -f1)"; done \
  | shasum -a 256
```

Si esa huella cambia, **la dispensa deja de aplicar** y hay que rehacer la
reconciliación. Editar sólo este documento NO la invalida, que es exactamente lo
que se busca.

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

## Aserción 1 — `WAIVED`

**`t-c1-05:267`** — *«sólo cambia el ÚNICO archivo autorizado del harness
vanilla»*

```
esperado: []
obtenido: 5 rutas VANILLA_NO_AUTORIZADO
```

Causa: `VANILLA_AUTHORIZED_CHANGES = ["tests/db/harness/manifest.ts"]`
(`t-c1-05:256`) admite **un solo** archivo bajo `tests/db`.

| # | Path | sha256 (completo) | Por qué es estrictamente necesario |
|---|---|---|---|
| 1 | `tests/db/scripts/expected-suite.mjs` | `cb3d5af12257bff847fd20b97a34861625ad3fc8071eb8c66fbf59380c077913` | Inventario **fail-closed**: el arnés rompe si un test nuevo no se declara, o si su conteo no coincide |
| 2 | `tests/db/t-a0-13-run-report.test.ts` | `ace8fbd1a9d99586dbc62713f35f128440bffc4f06ab13b9f8b3f75d2c5d4f72` | Total derivado del inventario; el arnés lo exige en el mismo commit |
| 3 | `tests/db/t-link-b1-01-channel-boundary.test.ts` | `93d6d21a743f8a4a99a0c2d6b3a85e85bbe184be83229c01598a67e158ad4fb8` | Prueba adversarial de `0236` exigida por Dirección |
| 4 | `tests/db/t-link-b1-02-channel-rls.test.ts` | `080f460819f9d624b6a45a4132e92781a94cd297745a14f61eaec4d765f290a4` | Prueba adversarial de `0237`: nueve superficies, Realtime autenticado y el **teléfono del contacto** |
| 5 | `tests/db/t-link-b2-01-upload-lifecycle.test.ts` | `d385f469689ea932565f522e8de2900922c6376805e11043542a292d9d1a6f49` | Concurrencia de `0238` sobre PostgreSQL real: los nueve casos exigidos, el vencimiento del token y la identidad mensaje/subida/adjunto |

`tests/db/harness/manifest.ts` **sí** está autorizado y por eso no figura entre
los infractores.

Ninguna de las cinco toca semántica, seguridad, linaje, checksum, rollback,
mutantes ni regresión funcional: tres son pruebas nuevas y dos son los registros
que el propio arnés obliga a actualizar al agregarlas.

---

## Aserción 2 — `WAIVED`

**`t-c1-05:356`** — *«no se tocó ningún path de WhatsApp, Connect ni Sidebar»*

```
esperado: []
obtenido: 32 rutas
```

Causa: `t-c1-05:358` exige **cero** rutas que matcheen
`/whatsapp|connect|Sidebar|pnpm-lock|yarn/i`. Es literalmente el objeto del
expediente.

| # | Path | sha256 (completo) | Contenido del cambio |
|---|---|---|---|
| 1 | `src/app/(app)/connect/_components/AttachmentComposer.dom.test.tsx` | `de31770585c357651bf65a13b5b8760f76bea3a3feb3a8c38e54ba4e5f809fb0` | Render real del composer de adjuntos (19 casos) |
| 2 | `src/app/(app)/connect/_components/AttachmentComposer.tsx` | `0d98d5e0e3aacdea8b4565ff26cb108811388e11aef85e8912b6589f7d20d72d` | UI del composer de adjuntos (FASE B) |
| 3 | `src/app/(app)/connect/_components/ThreadView.dom.test.tsx` | `317daccb4588400c872fcd7657b87676b1edf6ab6c195a12bc873edd21686932` | Doble del composer, para no arrastrar sus server actions |
| 4 | `src/app/(app)/connect/_components/ThreadView.tsx` | `a656dfda1f9c9db4ed230801e32c1498f9d76b235b177bb435c6dfc02660e17e` | Monta el composer detrás de `caps.canAttachFile` |
| 5 | `src/app/(app)/connect/_components/WaContactCard.dom.test.tsx` | `271b3221746e2305bbf72ad6c19b8af05abb07df62455a426f5477ec2ece39c8` | Render real de la ficha de contacto: portal, trampa de foco, copia (17 casos) |
| 6 | `src/app/(app)/connect/_components/WaContactCard.tsx` | `daec940759086a1d7258eddfcb2674ea47b6e76a218f38afef40fa1e8cf004d8` | Ficha «Información del contacto»: panel modal por portal a `body`, foco atrapado, E.164 y copiar número |
| 7 | `src/app/(app)/connect/buscar/page.tsx` | `b911c224edf220f134581cccc1df5c214620287f43e93bfb613c4c8cf8d3937f` | **Corregido en este corte**: la búsqueda pintaba el `context_id` —o sea el teléfono— en cada resultado de WhatsApp. La decisión pasó a `etiquetaDeContexto`, que sí está bajo prueba |
| 8 | `src/app/(app)/connect/c/[conversationId]/page.tsx` | `e542d6d4737be8d10efc75588c00184a6ee2fc90c63e1669e9f95271d5564422` | Guarda de canal en la ruta directa del hilo + montaje de la ficha |
| 9 | `src/app/(app)/connect/page.tsx` | `dac5511a6c3710df953b1b4eeb2db9830f5a9ca15d5c546a40bb8c91bbfe4cf5` | Guarda de canal en la bandeja |
| 10 | `src/app/(app)/connect/wa-import/page.tsx` | `76c7333ebcde3ca4c10b46f82f7c5479e34f841744a05787ba930611088529ae` | Guarda de canal en el importador |
| 11 | `src/lib/connect/adapters/driving/attachment-actions.ts` | `636df8580ca9a914a618aaf6f0707f28842f3330c5c8ac8d0f1dd9ff0eefcde1` | Server actions de adjuntos: transición de `0238`, un mensaje por lote y **corregida** la comprobación de membresía (faltaba filtrar por identidad) |
| 12 | `src/lib/connect/attachments/client-precheck.test.ts` | `a61ed70b3cea0a98c564d6f31663cdaa2494766ec18e3f66dd30e9a1924af368` | Filtro previo del cliente (11 casos) |
| 13 | `src/lib/connect/attachments/client-precheck.ts` | `aac2e90622e2593cbf64803242fc4e1852d8372a702a59f31dba2df88875ab54` | Filtro previo del cliente, deliberadamente más permisivo que el servidor |
| 14 | `src/lib/connect/attachments/ooxml.test.ts` | `8f7e6225c2e89237391bd2844046aada207628e37a7505fa83d7b1ea3dfaae1a` | Identidad OOXML (31 casos) |
| 15 | `src/lib/connect/attachments/ooxml.ts` | `cba303fdfda8d3bf50ea25f855704a509083b2ece8f6cf6cbe26298c426178b0` | Identidad OOXML completa: directorio central contra cabeceras locales, macros, recorrido y bomba zip |
| 16 | `src/lib/connect/attachments/validate.test.ts` | `09214f00565b348304b00499591da24055c9b26e1136eaccf3957d30cc4ee7de` | Validación adversarial por firma (18 casos) |
| 17 | `src/lib/connect/attachments/validate.ts` | `02350b2ddee53ac05f4f3e213c60a1342bc24d3650a014544ad19f6e38609563` | Validación por firma. **Corregido en este corte**: los bytes de control literales del saneador de nombres pasaron a escapes `\x00`/`\x1f`/`\x7f` |
| 18 | `src/lib/connect/audio/recorder.ts` | `a9306bd2d965fb3cf3330af229153fc73c289a09e9ca32c09534eb1cfb70631d` | Preferencia de MIME al grabar; WebM se conserva porque el servidor reenvasa |
| 19 | `src/lib/connect/composer-policy.test.ts` | `2beb5185c5625026720911b6a36f8adbb521d6b92846fc0f15497d2d732c5246` | Reescritura **consciente** del contrato WA-8 |
| 20 | `src/lib/connect/composer-policy.ts` | `f0358f03c95df4a8ffe6d85ebcaf6ed36a9413b7b44e3a378eca14e905c887c5` | Capacidad `canAttachFile`; media habilitada en WhatsApp |
| 21 | `src/lib/connect/read/wa-contact.test.ts` | `2b5f1d7c2fc05823a143cbd4424f34f1ccb5223bdb134fd91f7f9c2f49a3557b` | Autorización de la ficha: indistinguibilidad y no fuga (13 casos) |
| 22 | `src/lib/connect/read/wa-contact.ts` | `67922a5fb2aaf91bc3f8be494760587a1470f8dbcf131f637a22daeb18d9569f` | Punto único de estrangulamiento del teléfono, en servidor y con el cliente de sesión. Declara explícitamente el alcance REAL de la frontera |
| 23 | `src/lib/whatsapp/contact-identity.test.ts` | `99f5516f08ef0b8a639e7defefb583f4f2b7031ed5836c36e83dc1b05de8a0e7` | Identidad, formato y etiqueta del contacto (22 casos) |
| 24 | `src/lib/whatsapp/contact-identity.ts` | `65e572e800e167606a465d2e501c9a274bd5c33869b7d7a0fca6a1cc7625e2c9` | E.164 estricto, extracción desde `context_id`, formato internacional legible y `etiquetaDeContexto` |
| 25 | `src/lib/whatsapp/media-send-core.test.ts` | `9ee1867abb048f04eac3b7621c99930733732183c4f8b82b70842138afd4f2c7` | Decisión del envío de media (13 casos) |
| 26 | `src/lib/whatsapp/media-send-core.ts` | `bf870ba5ff3a8b34cce6fbdd79594858ea6ac9a1db9e0db7e17a7539cbc96aa1` | Núcleo puro del envío: CAS antes de subir; lo ambiguo nunca se reintenta. ⚠️ **sin llamador productivo** (ver hallazgo H2) |
| 27 | `src/lib/whatsapp/media-transport.test.ts` | `8fe5cccd031c4c2a5e40cd31ea2198dbb39d0a477f9c9b51010c0aeb16705884` | Transporte de media contra Meta (24 casos) |
| 28 | `src/lib/whatsapp/media-transport.ts` | `a77b1a095413058d9bd07056541f3f83dce3d9a4391cd2e11f59363efd06c66e` | `/media → media_id → /messages` con el contrato de tres estados. ⚠️ **sin llamador productivo** (ver hallazgo H2) |
| 29 | `src/lib/whatsapp/opus-remux.test.ts` | `43010a4b65012c35b3856f74b0bc4e2fdc199a745bdf18d32570dbdc9a45138e` | Reenvasado WebM→Ogg (22 casos) |
| 30 | `src/lib/whatsapp/opus-remux.ts` | `75a8789042b27798b2b8974fa232d8d37c9dcd970a4f44a613499c7031d3a910` | Reenvasado de contenedor sin transcodificar. ⚠️ **sin llamador productivo** (ver hallazgo H2) |
| 31 | `src/lib/whatsapp/reply-action.ts` | `9de58621a399c3bbf59ef8d232576ef9dbb66b60a865621c50f4419ee3754663` | Guarda de canal en la server action de envío |
| 32 | `src/lib/whatsapp/send-route.test.ts` | `6bd4352855264bb0f0afcd2c0d2295f73681c14cff107db2fa6eddbe5a0de7ce` | Pruebas de la frontera M2M ordenadas por Dirección (21 casos) |

Las guardas de canal (8, 9, 10, 31) son exactamente las que Dirección ordenó; el
resto es la FASE B propiamente dicha.

---

## Aserción antes dispensada que hoy **PASA**

**`t-c1-05:319`** — *«los configs vanilla y de unidad no fueron tocados por esta
rama»* → **PASS**.

Se había modificado `vitest.config.ts` por dos motivos, y ninguno de los dos
resultó imprescindible:

1. **Alias de `server-only`.** El problema real era que `ThreadView.dom.test.tsx`
   arrastraba las server actions del composer al grafo de la prueba. Se resuelve
   donde corresponde —sustituyendo `AttachmentComposer` por un doble en esa
   suite, como ya se hacía con `VoiceField` e `Icon`—, sin tocar el arnés ni
   inventar un stub de `server-only`. Para módulos de servidor probados de
   frente, el repositorio ya tenía el patrón `vi.mock("server-only", () => ({}))`,
   que es el que usa `wa-contact.test.ts`.
2. **Glob de `src/app/api/whatsapp`.** La prueba de `/api/whatsapp/send` se movió
   a `src/lib/whatsapp/send-route.test.ts`, ruta ya cubierta por el `include`
   canónico. La ubicación gobierna el DESCUBRIMIENTO del test, no lo que puede
   importar: el handler bajo prueba sigue siendo el productivo, alcanzado por su
   ruta real (`@/app/api/whatsapp/send/route`).

Verificado en este corte: `git diff --name-only b6f2eaab -- vitest.config.ts
vitest.custody.config.ts` → **0 archivos**.

---

## Conteos reales de este corte

| Suite | Archivos | Casos | Resultado |
|---|---|---|---|
| Unitaria (`vitest.config.ts`) | 179 + 1 omitido (180) | **3 316** aprobados · 1 omitido | PASS |
| Arnés de base (`npm run test:db`) | 34 | **687** | PASS · los cuatro gates PASS |
| Custodia (`npm run test:custody:db`) | 21 (1 en rojo) | **449 / 451** | **ROJO** — las dos aserciones de arriba |
| Linaje `T-C4-01` | incluido en Custodia | incluido en los 449 | PASS con `0236`–`0238` registradas |
| `next lint` | — | 0 errores (6 avisos preexistentes, ajenos al delta) | PASS |
| `npm run build` | — | exit 0 | PASS |

---

## Lo que este waiver NO cubre

Se dispensan **dos aserciones nominadas** de `T-C1-05` y nada más. En
particular **no** se dispensa:

- ningún otro caso de `T-C1-05` (los 28 restantes están en PASS, incluidos los
  de append-only, auditoría, cierre, tamaño del manifiesto vanilla y
  `FROZEN_EXCLUDED_FILES` idéntico a la base);
- ninguna otra suite de `tests/custody-db` (20 de 21 en PASS);
- el gate de linaje `T-C4-01`, que **pasa**;
- los gates de base ni la suite unitaria.

**Si `T-C1-05` empezara a fallar por un caso distinto de estos dos, este waiver
no aplica y el candidato debe detenerse.** Lo mismo si cambia la `huella_delta`.

## Secuencia real del conteo de Custody en este expediente

| Momento | Resultado |
|---|---|
| Tras `0236`, antes de registrar inventarios | 446 / 451 (4 de `T-C4-01` + 1 de `T-C1-05`) |
| Tras registrar `0236` en los tres inventarios | 448 / 451 |
| Con `0236` + `0237` y sus dos suites | 449 / 451 |
| Con `0238`, su suite y el composer, tocando `vitest.config.ts` | 448 / 451 |
| Tras restituir el config y reubicar la prueba | 449 / 451 |
| **Con la ficha de contacto y la corrección del byte NUL** | **449 / 451** |

No se reportó `450 / 451` en ningún momento de este expediente.

## Alcance

Sólo estas **dos aserciones**, sólo sobre esta `huella_delta`. Cualquier cambio
del delta deja el waiver sin efecto. No cubre ningún otro test, gate ni defecto,
y el check agregado de Custodia se reporta **rojo**, nunca verde.
