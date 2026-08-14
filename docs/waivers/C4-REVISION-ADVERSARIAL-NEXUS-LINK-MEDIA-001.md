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
