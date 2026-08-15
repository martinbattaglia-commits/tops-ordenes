# C4 · Revisión adversarial — `NEXUS-LINK-NOTIFICATIONS-MEDIA-001`

Registro del control **C4** del Guardián «Antes de cada Commit» v1.0 (§7).

- Expediente: `NEXUS-LINK-NOTIFICATIONS-MEDIA-001` · FASE B
- Rama: `candidate/link-media-fase-b` · base `b6f2eaab`
- Corte: **2026-08-14**
- Método: dos revisores **independientes del autor del cambio**, con contexto
  propio, instruidos para **refutar** cada afirmación crítica, no para
  confirmarla. Lentes distintas: privacidad/autorización y regresión/corrección.

> C4 exige refutación, no confirmación. Los tests que escribió el autor son
> mecanismos confirmatorios y **no** satisfacen este control por sí solos
> (Guardián §7, C4). Lo que sigue es lo que los revisores intentaron romper y
> qué pasó.

---

## Afirmaciones sometidas a refutación

| # | Afirmación | Resultado |
|---|---|---|
| A1 | «Ningún usuario sin `nexus_link.whatsapp.read` obtiene el teléfono por ninguna vía» | **REFUTADA** → H1 |
| A2 | «El cambio no altera contadores, adjuntos, audio, media ni el envío» | Sobrevive |
| A3 | «La corrección del byte NUL no cambia la semántica del validador» | Sobrevive (verificada empíricamente sobre U+0000–U+1FFF) |
| A4 | «El encabezado del hilo sigue correcto para todos los `kind`» | Sobrevive con una regresión de layout → corregida |
| A5 | «Las modificaciones a `tests/db` no debilitan validadores ni reducen cobertura» | Sobrevive |
| A6 | «El panel es modal y accesible» | **REFUTADA** → H7, H8 |

---

## Hallazgos CORREGIDOS en este corte

### H7 · el overlay no se anclaba a la ventana
`position: fixed` no se ancla al viewport si un ancestro tiene `transform`. El
`<main>` del Shell lleva la animación de entrada `nx-page-fade`, que aplica
`translate3d`, y además scrollea. El fondo no cubría la barra superior ni el
sidebar, que seguían siendo clicables mientras el diálogo se declaraba modal.
Medido con motor de navegador real y control A/B: con la animación, el origen
del overlay era el de `<main>`; sin ella, el del viewport.
**Corrección:** el overlay se monta por portal en `document.body`.

### H8 · `aria-modal="true"` sin trampa de foco
Tab pasaba de largo hacia el contenido de atrás —visible y clicable por H7—.
**Corrección:** trampa de foco explícita sobre los controles del panel.

### H9 · listener de Escape sobre `document`
`stopPropagation()` no detiene a otros listeners del mismo nodo (haría falta
`stopImmediatePropagation`) y en cambio sí corta los de `window`. La campanita
de notificaciones tiene su propio listener de Escape sobre `document`.
**Corrección:** el teclado se maneja en el overlay; con el foco atrapado, el
evento llega por burbujeo y nadie más lo ve.

### H10 · regresión de layout de 12 px
El contenedor de chips pasó a renderizarse siempre; en un flex con `gap-3`, un
div vacío igual consume la separación y recortaba el título en todo hilo sin
vínculos ni ficha. **Corrección:** el contenedor se monta sólo si tiene
contenido.

### H11 · comprobación de membresía mal formada
`assertPuedeAdjuntar` usaba `connect_participants!inner(profile_id)` sin filtrar
por identidad: el join sólo exigía que existiera **algún** participante legible,
y en un canal público un no-miembro pasaba. No era explotable —
`connect_upload_begin` (0238) vuelve a exigir membresía en la base—, pero la
guarda afirmaba verificar algo que no verificaba.
**Corrección:** `.eq("connect_participants.profile_id", user.id)`.

### H12 · el teléfono se pintaba en cada resultado de búsqueda
`/connect/buscar` mostraba `result.contextId` en mono para todo resultado,
incluidos los de WhatsApp — donde ese campo **es** el teléfono. Alcanzaba sólo a
usuarios con la capacidad, así que no es una fuga de frontera, pero contradecía
el criterio que se acababa de aplicar al encabezado del hilo.
**Corrección:** en WhatsApp se muestra la etiqueta del canal, no el `context_id`.

---

## Hallazgos ABIERTOS — no corregidos en este corte

### 🔴 H1 · el teléfono también vive en `connect_participants.external_ref`

**Refuta la afirmación central del expediente.** El importador
(`connect/wa-import/ingest.ts`) y la proyección del inbound vivo
(`whatsapp/link-projection.supabase.ts`) escriben el número **en claro** dentro
de `connect_participants.external_ref->>'phone'`.

La policy SELECT de esa tabla (`0143`) **no tiene predicado de canal**, y ni
`0236` ni `0237` la tocan: `0237` enumera las superficies que cierra y
`connect_participants` no está entre ellas.

**Medido en producción el 2026-08-14 (sólo lectura, sin exponer ningún número):**

```
policy connect_participants select:
  has_permission('connect.view') AND (_connect_is_member(conversation_id) OR is_admin())

participantes participant_type='whatsapp' ........ 26
  con external_ref ? 'phone' ..................... 21
  con E.164 válido ............................... 21
connect_participants publicada en supabase_realtime  SÍ
```

**Alcance real.** No es una tabla pública: un usuario ajeno al hilo no la ve. La
fuga alcanza a **participantes del hilo sin la capacidad** —el escenario exacto
que `0236` declara su amenaza— y a `is_admin()`, rama que `0236` quitó a
propósito de `nexus_link_can()` para que la capacidad no dependiera del rol.

**Reproducido en el arnés**, no sólo argumentado:
`tests/db/t-link-b1-02-channel-rls.test.ts`, describe «HALLAZGO ABIERTO», sobre
PostgreSQL real y con la policy de `0143` reproducida literal. Esos casos
**afirman la fuga**: cuando se cierre van a fallar, y ese fallo es la señal
correcta para actualizarlos en el mismo commit que la corrija.

**Remediación diseñada — migración `0239`, NO incluida acá.** Debe agregar el
predicado de canal a la policy SELECT de `connect_participants`, con la misma
forma que `0237` aplicó a las demás tablas:

```sql
-- forma propuesta, pendiente de autorización
using (
  has_permission('connect.view')
  and (public._connect_is_member(conversation_id) or public.is_admin())
  and public._connect_channel_allowed(conversation_id)
)
```

**Por qué no está en este commit.** Una migración vuelve al candidato **clase M**
(Guardián §5), y para clase M aplica **C5 · rollback probado**, que el propio
Guardián declara **NO VERIFICABLE** mientras Dirección no establezca el entorno
oficial de validación. NO VERIFICABLE no se degrada a PASS (§12) y obliga a
detener (§8). Este candidato se mantiene **clase I** —sin SQL— para poder
commitear con Guardián válido; `0239` queda a la espera de Dirección.

### 🔴 H2 · la media de WhatsApp no sale a Meta

`composer-policy.ts` habilita `canSendAudio` y `canAttachFile` en WhatsApp, y el
transporte a Meta está escrito y probado — pero **no tiene ningún llamador
productivo**:

```
$ grep -rn "sendWhatsappMedia|createMetaMediaTransport" src/ | grep -v '\.test\.'
  → sólo las definiciones. Cero llamadores.
```

`composer-dispatch.ts` rutea únicamente TEXTO. `finalizeAttachmentAction` inserta
adjunto y mensaje en Connect y retorna. `ThreadView.sendAudio()` va por
`prepareAudioUploadAction`/`finalizeAudioMessageAction` para todo `kind`.

**Consecuencia:** en un hilo de WhatsApp el operador adjunta una foto o graba un
audio, la burbuja se publica y se ve enviada, **y el contacto no recibe nada**.
`connect_pending_uploads.channel='whatsapp'` (0238) queda escrito y nadie lo
consume.

**Corrección del informe anterior.** El bloque previo de este expediente reportó
el punto «cablear `/media → media_id → /messages`» como cumplido. Los módulos
existen y están probados, pero **el cableado no se hizo**. La afirmación era
incorrecta y queda rectificada acá.

**Es condición bloqueante para el merge**, no para el commit: la rama no publica
y las migraciones no están aplicadas.

### 🟡 H3 · `connect_messages insert` sin predicado de canal
`0237` endureció SELECT, no INSERT. Un participante sin
`nexus_link.whatsapp.send` puede insertar por PostgREST un mensaje en un hilo de
WhatsApp; no sale a Meta, pero los operadores autorizados lo ven como propio del
equipo. Es el mismo agujero que `reply-action.ts` cerró del lado de la server
action, abierto del lado de la base. Corresponde a `0239`.

### 🟡 H4 · asimetría entre audio y adjuntos en el chat interno
Los adjuntos exigen `nexus_link.internal_chat.media` fail-closed en la base;
el audio sigue pasando con `connect.view` + membresía. Dos caminos que los
comentarios describen como calcados y no lo son.

### ⚪ H5 · `contextId` en el payload RSC de la bandeja
`read/inbox-data.ts` mapea `contextId` en cada `InboxItem` y `ConversationList`
lo recibe como prop: viaja en el payload aunque no se pinte. Alcanza sólo a
usuarios con la capacidad. Mismo criterio que H12, sin corregir.

### ⚪ H6 · HIPÓTESIS no confirmada
`0149` proyecta `context_id` al `payload` de `knowledge_events` con
`visibility_key` heredada de la entidad ERP, sin noción de canal. No se encontró
ninguna ruta que cree un `connect_conversation_links` hacia una conversación
`kind='whatsapp'`, pero el modelo lo admite. **No verificado contra la base.**

---

## Veredicto de C4

**PASS con hallazgos abiertos registrados.**

Las afirmaciones críticas del candidato que sobrevivieron, sobrevivieron; las
que no, están corregidas (H7–H12) o **declaradas abiertas con su medición, su
alcance y su remediación** (H1–H6), tanto en este documento como en el código y
en el arnés.

Ninguna afirmación del árbol queda diciendo algo que la evidencia contradice:
`read/wa-contact.ts` declara explícitamente el alcance real de su frontera, y
`t-link-b1-02` afirma la fuga de H1 en vez de ocultarla.

**C4 no autoriza merge ni publicación** (Guardián §13). H1 y H2 son condiciones
bloqueantes para el merge y corresponden a Dirección.

---

## ADENDA · 2026-08-14 (mismo día) — cierre de H1 bajo mandato C5

Dirección aceptó H1 como bloqueante y autorizó la migración `0239`,
condicionada a un precheck: `0239` estaba libre en `origin/main`, en las **70**
ramas/worktrees locales y remotas, y en las **5** PR abiertas restantes
(#66, #59, #49, #47, #46) — ninguna tocaba `connect_participants` ni ese
número.

**Entorno C5** (definido por Dirección): PostgreSQL 17 + PostGIS, esquema REAL
derivado de main — no un cierre sintético — aplicado vía `readFileSync` sobre
los archivos reales del repositorio (`0001/0004/0005/0009/0142/0143/0147`,
luego `0234/0235/0235a/0236/0237/0238/0239` en orden). Registrado en
`tests/db/t-link-h1-01-participants-channel-rls.test.ts` (34 casos).

**Hallazgo del propio C5, no de H1:** al medirse contra el esquema real por
primera vez, `0236` reveló **dos defectos estructurales previamente
invisibles**, enmascarados durante todo este expediente porque `t-link-b1-01`
y `t-link-b1-02` reproducían `permissions` a mano con la columna `name` (no
`label`) y sin la constraint real `unique(module, action)` — coincidían por
accidente con los mismos dos defectos que tenía `0236`:

1. `insert into permissions (..., name, ...)` — la columna real es `label`.
2. `module='connect'` para las seis capacidades nuevas habría violado
   `unique(module, action)`: `connect` ya ocupa 7 de los 13 valores de acción
   en producción (`view/create/edit/delete/admin/incident_admin/task_admin`),
   y las seis filas pedían dos veces `view` y cuatro veces `create` bajo ese
   mismo módulo.

Corregido en `0236` (columna `label`) y con la migración nueva `0235a` (dos
módulos nuevos, `nexus_link_chat`/`nexus_link_whatsapp`, aislada por la misma
razón que `0142`: Postgres prohíbe usar un valor de enum en la misma
transacción que lo agrega). Ninguna de las dos se aplicó nunca a producción.

**Cierre de H1:** `0239` agrega `_connect_channel_allowed(conversation_id)`
—reutilizada de `0237`, sin función nueva— como AND externo a la policy
SELECT de `connect_participants`, alcanzando tanto a `_connect_is_member()`
como a `is_admin()`.

Las 13 propiedades que Dirección exigió para C5, más las 9 sub-condiciones de
H1, están medidas una por una en el arnés — incluido el caso `6b`, que prueba
contra un hallazgo REAL preexistente: `has_permission()` (0009) tiene un atajo
`current_role()='admin'` que `nexus_link_can()` deliberadamente no replica.

Los tres archivos sintéticos preexistentes (`t-link-b1-01`, `t-link-b1-02`,
`t-link-b2-01`) se corrigieron para usar `label` en vez de `name` — el mismo
defecto que tenían, ahora también en su propio cierre — sin cambiar ninguna
otra semántica. Regresión completa: 721/721 en el arnés de base (repetida 3
veces sin flakiness), 449/451 en Custodia (exactamente las dos aserciones
dispensadas, verificado dos veces), 3316/3316 unitarios, TSC 0 errores, lint 0
errores, build exit 0.

`supabase/lineage/catalog.json` y `BACKFILL-SIMULATION.json` se actualizaron
con las cuatro entradas nuevas (`0235a`, `ROLLBACK_0235a`, `0239`,
`ROLLBACK_0239`) y el `sha256` corregido de `0236`; `BACKFILL-SIMULATION.json`
se regeneró con el generador real (`simulate-backfill.mjs`), no a mano.

H2 (cableado de media hacia Meta) sigue abierto — ver el checkpoint siguiente
de este expediente para su cierre.

---

## ADENDA 2 · 2026-08-14 (mismo día) — cierre de H2, segunda revisión C4 sobre el árbol combinado H1+H2

Dirección exigió H2 real (§ mandato «H1 + H2 + C5 + Guardián Clase M»): transporte
efectivo a Meta, cobertura mínima nombrada, y explícitamente *"la prueba terminal
debe demostrar que el contacto externo recibe realmente la media. Una burbuja
local no constituye evidencia de envío."*

**Cierre de H2 (cableado).** `attachment-actions.ts`/`audio-actions.ts` ahora
llaman a `sendWhatsappMediaForAttachment` (`media-send.ts`) tras finalizar la
subida a Storage. `media-send.ts` reutiliza el 100 % de la arquitectura
existente — cero transporte paralelo:

- `createSupabaseReplyPorts().state` — el MISMO CAS `claimSending/sealSent/stamp`
  que ya usa el texto, keyeado por el mismo `messageId` sobre `connect_messages`;
- `createMetaMediaTransport` — el mismo cliente HTTP de la Cloud API de Meta,
  ya escrito y probado en un corte previo de este expediente;
- `media-send-core.ts` — núcleo puro (validar → subir/resolver el archivo →
  `POST /media` → `POST /messages` → persistir wamid real → sellar) sin cambios
  este corte.

Contrato de tres desenlaces preservado: `sent` (aceptación real de Meta,
wamid persistido) / `failed` (sin duplicar, evidencia del error conservada) /
`reconciliation_required` (ambiguo: nunca se pinta como éxito ni se ofrece
reintentar, para no duplicar un envío que Meta pudo haber aceptado).

**Segunda revisión C4**, dos revisores independientes sobre el árbol
COMBINADO H1+H2 (no sobre H2 aislado): misma disciplina de refutación que la
revisión original. Encontraron dos defectos reales, ambos corregidos en este
mismo corte antes de commitear.

### H13 · CRÍTICO, CORREGIDO — un lote de N adjuntos de WhatsApp sólo entregaba el primero

**Mecanismo.** `AttachmentComposer.tsx` usaba `loteActual()` — un
`client_msg_id` ÚNICO por lote, correcto para Connect interno donde N adjuntos
cuelgan de UN mensaje — también para WhatsApp. Pero en WhatsApp ese mismo
`client_msg_id` se mapea 1:1 a un `messageId` server-side, y el CAS
`state.claimSending(messageId)` de `media-send-core.ts` sólo deja ganar a UN
llamador por `messageId`. Con dos archivos compartiendo `client_msg_id`,
compartían `messageId`, y el segundo perdía el CAS y volvía `already_claimed`
— que el composer **no distinguía de un envío real** y pintaba como
"Enviado" igual. Resultado medible: de N archivos adjuntados juntos a un
hilo de WhatsApp, Meta sólo recibía el primero; los demás quedaban con una
burbuja de éxito falsa.

**Corrección.** En un hilo `kind="whatsapp"`, cada adjunto en cola acuña (o
conserva, si ya lo tenía por un reintento previo) su PROPIO
`clientMsgIdPropio`, persistido vía el `marcar()` existente — no un CAS nuevo,
el mismo `messageId`↔`client_msg_id` de siempre, aplicado por archivo en vez
de por lote. `attachmentCount` se declara `1` por envío de WhatsApp, no el
tamaño del lote. `ThreadView.tsx` pasa `kind={kind}` al composer — sin ese
prop la rama nueva no se activa.

**Verificado**, no sólo argumentado: 4 casos nuevos en
`AttachmentComposer.dom.test.tsx` — dos adjuntos de WhatsApp en un lote
finalizan con `client_msg_id` DISTINTOS; cada envío declara
`attachmentCount=1`; el lote de Connect interno SIGUE compartiendo uno (guarda
de contraste, la rama nueva es la excepción); reintentar un archivo conserva
SU PROPIO id, no el de otro adjunto del mismo lote.

### H14 · CORREGIDO — la allowlist de operadores se construía y nunca se consultaba

**Mecanismo.** El texto exige DOS fronteras antes de tocar Meta:
`nexus_link.whatsapp.send` (RBAC, en `reply-action.ts`) y la allowlist
deny-by-default `WHATSAPP_SANDBOX_OPERATOR_PROFILE_IDS` (verificada DENTRO de
`reply-core.ts` vía `ports.operators.isAuthorized(actor.id)`, antes de
cualquier egress). `media-send.ts` construía `isOperator` y lo pasaba a
`createSupabaseReplyPorts(...)` —igual que el texto— pero del objeto
devuelto sólo tomaba `.state`; `.operators` y `.session` quedaban sin usar.
Cualquier usuario autenticado con la capacidad de canal —perteneciera o no a
la allowlist de operadores sandbox— podía hacer que un adjunto saliera hacia
Meta.

**Corrección.** `sendWhatsappMediaForAttachment` ahora llama
`full.session.getActor()` y `full.operators.isAuthorized(actor.id)` —el MISMO
objeto, el mismo orden que `executeReply`— antes de construir el input del
core. Sin actor: `{ok:false, state:"failed", message:"Sin sesión."}`. Actor
fuera de la allowlist: `{ok:false, state:"failed", message:"No autorizado
(operador)."}` **y** una fila de auditoría `reply_denied`/`not_operator` —el
mismo vocabulario y el mismo sink que ya usa el texto, sin allowlist de
acciones nueva.

**Verificado:** 4 casos nuevos en `media-send.runtime.test.ts` — sin actor no
se consulta la allowlist ni se toca Meta; actor fuera de la allowlist falla
sin construir transporte ni llamar al core; la denegación queda auditada
exactamente una vez con el `reason` correcto; un operador autorizado sigue
pasando por el camino feliz sin fricción nueva.

### Afirmaciones de H2 sometidas a refutación (árbol combinado final)

| # | Afirmación | Resultado |
|---|---|---|
| B1 | «El envío de media reutiliza el transporte oficial existente; no se construyó un segundo transporte paralelo» | Sobrevive — `createMetaMediaTransport`/`media-send-core.ts`/`createSupabaseReplyPorts().state` son los mismos objetos que ya usaba el texto |
| B2 | «Un lote de N adjuntos en un hilo de WhatsApp entrega los N, no sólo el primero» | **REFUTADA** → H13, corregida en este corte |
| B3 | «Sólo un operador de la allowlist sandbox puede hacer que un adjunto salga hacia Meta» | **REFUTADA** → H14, corregida en este corte |
| B4 | «Existe prueba terminal de que un contacto externo real recibió la media» | **NO VERIFICABLE EN ESTA SESIÓN** — ver abajo |

**Sobre B4, explícitamente.** Esta sesión no tiene un teléfono ni un cliente
de WhatsApp para observar recepción: la cobertura nueva (`media-send.runtime.test.ts`,
`media-no-secrets.test.ts`, `attachment-actions.wa.test.ts`,
`audio-actions.wa.test.ts`, más `media-send-core.test.ts`/`media-transport.test.ts`
de un corte previo) prueba el CAMINO DE CÓDIGO contra dobles de transporte
realistas — la forma exacta del request a `/media` y `/messages`, la
persistencia del wamid real, los tres desenlaces, cero segundo egress — pero
**ninguna de esas pruebas hizo una llamada real a la Cloud API de Meta ni
observó una recepción real**. Eso es exactamente lo que Dirección ya
reservó para sí misma en el mandato (verificación visual final, "audio real
en WhatsApp", con su propia sesión autenticada y un número interno
autorizado): la incapacidad del agente de ejecutar esa prueba terminal no
bloquea el cierre técnico de H2, pero queda declarada acá, explícitamente,
como validación humana pendiente — no como hecho verificado.

### Regresión completa tras H13 + H14

3364/3365 unitarios (183+1 omitido de 184 archivos, sube de 3356 por los 8
casos nuevos) · 721/721 arnés de base, cuatro gates PASS (sin cambio: ningún
archivo de `tests/db/` cambió en esta corrección) · 449/451 Custodia,
exactamente las dos aserciones ya dispensadas, sin tercera falla · `T-C4-01`
49/49 · TSC 0 errores · lint 0 errores nuevos (6 avisos preexistentes ajenos
al delta) · build exit 0.

### Veredicto de la segunda revisión C4

**PASS con un hallazgo abierto declarado (B4, no bloqueante por mandato
explícito de Dirección).** H13 y H14 —los dos hallazgos que sí eran
defectos reales del candidato— quedan corregidos y verificados en este
mismo corte, antes del commit correctivo. Ningún tercer hallazgo apareció.
H1 (cierre por `0239`, ADENDA 1) y H2 (cableado real, esta adenda) quedan
ambos cerrados en el sentido técnico; H3–H6 siguen abiertos y sin cambio de
estado, tal como se declararon arriba.
