# WAIVER-T-C1-05-PR66-EXPEDIENTE

Reconciliación por **aserción**, no por archivo. `T-C1-05` **no** se clasifica
globalmente como waived: de sus 30 casos, **28 pasan** y sólo dos quedan
dispensados, cada uno con su evidencia.

- Expediente: `NEXUS-LINK-NOTIFICATIONS-MEDIA-001` · FASE B
- Test: `tests/custody-db/t-c1-05-append-only-vanilla.test.ts`
- Candidato: rama `candidate/link-media-fase-b`, padre `b6f2eaab`
- Custody: **449 / 451** (2 dispensadas, 449 en PASS)
- Corte de esta reconciliación: 2026-08-14

> **Por qué falla `T-C1-05` y por qué eso no es un defecto del candidato.**
> Es un invariante del expediente de **Custodia**: fija que la rama en curso no
> toque el arnés vanilla ni el frente Connect/WhatsApp. Está escrito para *ese*
> frente. Un expediente cuyo objeto ES Connect y WhatsApp lo viola por
> definición, y lo violaría igual aunque el candidato fuera perfecto. Medido
> además: el caso falla **también sobre `main`** con la forma actual del árbol;
> sólo pasa con la forma que introduce la PR #59. Es incompatibilidad
> estructural entre dos expedientes, no una regresión de éste.

---

## Aserción 1 — `WAIVED`

**`t-c1-05:267`** — *"sólo cambia el ÚNICO archivo autorizado del harness
vanilla"*

```
esperado: []
obtenido: [ {VANILLA_NO_AUTORIZADO, tests/db/scripts/expected-suite.mjs},
            {VANILLA_NO_AUTORIZADO, tests/db/t-a0-13-run-report.test.ts},
            {VANILLA_NO_AUTORIZADO, tests/db/t-link-b1-01-channel-boundary.test.ts},
            {VANILLA_NO_AUTORIZADO, tests/db/t-link-b1-02-channel-rls.test.ts},
            {VANILLA_NO_AUTORIZADO, tests/db/t-link-b2-01-upload-lifecycle.test.ts} ]
```

Causa: `VANILLA_AUTHORIZED_CHANGES = ["tests/db/harness/manifest.ts"]`
(`t-c1-05:256`) admite **un solo** archivo bajo `tests/db`.

| Path | sha256 (16) | Por qué es estrictamente necesario |
|---|---|---|
| `tests/db/t-link-b1-01-channel-boundary.test.ts` | `93d6d21a743f8a4a` | Prueba adversarial de `0236` exigida por Dirección |
| `tests/db/t-link-b1-02-channel-rls.test.ts` | `01c89bdf3f0a9c5c` | Prueba adversarial de `0237`, nueve superficies |
| `tests/db/t-link-b2-01-upload-lifecycle.test.ts` | `d385f469689ea932` | Concurrencia de `0238` sobre PostgreSQL real: los nueve casos exigidos, el vencimiento del token y la identidad mensaje/subida/adjunto |
| `tests/db/scripts/expected-suite.mjs` | `c0cf3789e1c9ba8f` | Inventario **fail-closed**: el arnés rompe si un test nuevo no se declara |
| `tests/db/t-a0-13-run-report.test.ts` | `17606b926f33812a` | Total derivado del inventario; el arnés lo exige en el mismo commit |

`tests/db/harness/manifest.ts` **sí** está autorizado y por eso no figura entre
los infractores.

Ninguno de los cinco toca semántica, seguridad, linaje, checksum, rollback,
mutantes ni regresión funcional: tres son pruebas nuevas y dos son los registros
que el arnés obliga a actualizar al agregarlas.

---

## Aserción 2 — `WAIVED`

**`t-c1-05:356`** — *"no se tocó ningún path de WhatsApp, Connect ni Sidebar"*

```
esperado: []
obtenido: [ 13 rutas bajo connect/ y whatsapp/ ]
```

Causa: `t-c1-05:358` exige **cero** rutas que matcheen
`/whatsapp|connect|Sidebar/i`. Es literalmente el objeto del expediente.

| Path | sha256 (16) | Contenido del cambio |
|---|---|---|
| `src/app/(app)/connect/c/[conversationId]/page.tsx` | `d2677e7f84bbe73e` | Guarda de canal en la ruta directa del hilo |
| `src/app/(app)/connect/page.tsx` | `dac5511a6c3710df` | Guarda de canal en la bandeja |
| `src/app/(app)/connect/wa-import/page.tsx` | `76c7333ebcde3ca4` | Guarda de canal en el importador |
| `src/lib/whatsapp/reply-action.ts` | `9de58621a399c3bb` | Guarda de canal en la server action de envío |
| `src/app/(app)/connect/_components/AttachmentComposer.tsx` | `0d98d5e0e3aacdea` | UI del composer de adjuntos (FASE B) |
| `src/app/(app)/connect/_components/AttachmentComposer.dom.test.tsx` | — | Su prueba por render real (19 casos) |
| `src/app/(app)/connect/_components/ThreadView.tsx` | `4c5024931888bf9b` | Monta el composer detrás de `caps.canAttachFile` |
| `src/app/(app)/connect/_components/ThreadView.dom.test.tsx` | — | Doble del composer, para no arrastrar sus server actions |
| `src/lib/connect/composer-policy.ts` | `0dc1b44bca9aa35b` | Capacidad `canAttachFile`; media habilitada en WhatsApp |
| `src/lib/connect/composer-policy.test.ts` | — | Reescritura **consciente** del contrato WA-8 |
| `src/lib/connect/adapters/driving/attachment-actions.ts` | `f5d137da58ec0753` | Server actions de adjuntos: transición de `0238` y un mensaje por lote |
| `src/lib/connect/attachments/` (4 módulos + 3 suites) | — | Validación por firma, identidad OOXML y filtro previo del cliente |
| `src/lib/whatsapp/send-route.test.ts` | `6bd4352855264bb0` | Pruebas de la frontera M2M ordenadas por Dirección |

Las cuatro primeras son exactamente las guardas que Dirección ordenó; las demás
son la FASE B propiamente dicha.

---

## Aserción antes dispensada que hoy **PASA**

**`t-c1-05:319`** — *"los configs vanilla y de unidad no fueron tocados por esta
rama"* → **PASS**.

Se había modificado `vitest.config.ts` por dos motivos, y ninguno de los dos
resultó imprescindible:

1. **Alias de `server-only`.** El problema real era que `ThreadView.dom.test.tsx`
   arrastraba las server actions del composer al grafo de la prueba. Se resuelve
   donde corresponde —sustituyendo `AttachmentComposer` por un doble en esa
   suite, como ya se hacía con `VoiceField` e `Icon`—, sin tocar el arnés ni
   inventar un stub de `server-only`.
2. **Glob de `src/app/api/whatsapp`.** La prueba de `/api/whatsapp/send` se
   movió a `src/lib/whatsapp/send-route.test.ts`, ruta ya cubierta por el
   `include` canónico. La ubicación gobierna el DESCUBRIMIENTO del test, no lo
   que puede importar: el handler bajo prueba sigue siendo el productivo,
   alcanzado por su ruta real (`@/app/api/whatsapp/send/route`).

Verificado tras la corrección: `git diff --name-only origin/main -- vitest.config.ts
vitest.custody.config.ts` → **0 archivos**, y la suite unitaria ejecuta **3 205
casos en 173 archivos**, incluidos los 21 de `send-route`. La cobertura se
conservó entera sin la dispensa.

---

## Lo que este waiver NO cubre

Se dispensan **dos aserciones nominadas** de `T-C1-05` y nada más. En
particular **no** se dispensa:

- ningún otro caso de `T-C1-05` (los 28 restantes están en PASS, incluidas las
  de append-only, auditoría, cierre y tamaño del manifiesto vanilla (31) y
  `FROZEN_EXCLUDED_FILES` idéntico a la base);
- ninguna otra suite de `tests/custody-db` (20 de 21 en PASS);
- el gate de linaje `T-C4-01`, que **pasa** con `0238` registrada
  (210 entradas · 199 ejecutables · 11 no ejecutables);
- los gates de base (`670` casos en `34` archivos, PASS) ni la suite unitaria
  (`3 205` casos, PASS).

Si `T-C1-05` empezara a fallar por un caso distinto de estos dos, **este waiver
no aplica** y el candidato debe detenerse.

## Secuencia real del conteo de Custody en este expediente

| Momento | Resultado |
|---|---|
| Tras `0236`, antes de registrar inventarios | 446 / 451 (4 de `T-C4-01` + 1 de `T-C1-05`) |
| Tras registrar `0236` en los tres inventarios | 448 / 451 |
| Con `0236` + `0237` y sus dos suites | 449 / 451 |
| Con `0238`, su suite y el composer, tocando `vitest.config.ts` | 448 / 451 |
| **Tras restituir el config y reubicar la prueba** | **449 / 451** |

No se reportó `450 / 451` en ningún momento de este expediente.

## Alcance

Sólo estas **dos aserciones**, sólo sobre esta identidad de candidato.
Cualquier cambio de identidad deja el waiver sin efecto. No cubre ningún otro
test, gate ni defecto, y el check agregado de Custodia se reporta **rojo**,
nunca verde.
