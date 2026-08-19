# FASE 2 · reproceso de los eventos terminales de `wa_inbound_events`

Estado: **DISEÑADA · DRY-RUN CORRIDO · DETENIDA.** La ejecución la autoriza
Dirección aparte. Este documento no la autoriza.

## Qué son los 203

Medido en producción (`arsksytgdnzukbmfgkju`), no leído:

| forma del evento | procesados | terminales |
|---|---|---|
| con `messages` (text 90 · reaction 8 · document 6 · image 5 · audio 3) | **112** | **0** |
| con `statuses` (sent · delivered · read · failed) | 65 | **203** |
| sin `messages` ni `statuses` (nada que proyectar) | 3 | 0 |
| **total** | **180** | **203** |

Ningún mensaje de cliente quedó sin proyectar. Los 203 son acuses de entrega
de mensajes **salientes**, y el discriminante es exacto, 268 de 268:

| ¿el `wamid` del acuse existe en `connect_messages.external_msg_id`? | procesado | n |
|---|---|---|
| sí | true | 65 |
| no | false | **203** |

Son acuses de mensajes que Nexus nunca envió — se respondió desde el teléfono,
no desde la plataforma. Cada mensaje enviado por fuera genera `sent`,
`delivered` y `read`: de ahí 73 · 70 · 58, más 2 `failed` — 203 en total.

## El reproceso, si se autorizara

Idempotente por construcción: el consumidor de la cola (`inbound-queue`) y el
proyector son los mismos que corren en vivo, y la idempotencia la arbitra el
índice único `connect_messages_external_uidx`. Reprocesar un evento no puede
duplicar conversación, participante ni mensaje.

Acotado: por lote, con techo de 100 por invocación
(`src/app/api/whatsapp/inbound-queue/route.ts:48`).

**El endpoint vigente NO alcanza a los 203, y esto importa.**
`wa_claim_inbound_events` reclama con el predicado
`processed = false and terminal = false and attempts < p_max_attempts`
(`supabase/migrations/0229_wa_inbound_queue.sql:103-105`): un evento terminal es
justamente el que no puede reclamar. Para reprocesarlos hay que pasar antes por
el RPC de replay manual (`0229:207-227`), que hace `set terminal = false,
attempts = 0` — es decir, **reescribe las filas que este mismo documento declara
prueba intocable del incidente**. No es un detalle de implementación: es el
costo real de la Fase 2.

## DRY-RUN — corrido, sin escribir nada

```sql
-- sólo lectura; no marca, no borra, no inserta
with muertos as (
  select seq, payload -> 'entry' -> 0 -> 'changes' -> 0 -> 'value' as v
  from public.wa_inbound_events
  where terminal is true and processed = false
), clasificado as (
  select m.seq, (m.v ? 'messages') as trae_mensajes,
         m.v -> 'statuses' -> 0 ->> 'id' as wam
  from muertos m
)
select count(*) as eventos_a_reprocesar,
       count(*) filter (where c.trae_mensajes)                as crearian_mensaje_de_cliente,
       count(*) filter (where cm.external_msg_id is not null) as acuses_que_YA_matchearian,
       count(*) filter (where cm.external_msg_id is null)     as acuses_que_seguirian_sin_dueno
from clasificado c
left join public.connect_messages cm on cm.external_msg_id = c.wam;
```

Resultado:

| eventos a reprocesar | crearían mensaje de cliente | acuses que ya matchearían | acuses que seguirían sin dueño |
|---|---|---|---|
| 203 | **0** | **0** | **203** |

## Lectura del dry-run

**El reproceso no recuperaría nada.** No hay contenido de cliente que rescatar:
los 203 son acuses huérfanos y volverían a serlo, porque el mensaje que
referencian no existe ni va a existir. Lo único que cambiaría es la razón
registrada: dejarían de decir «error_desconocido» y dirían `status_unmatched`.

Eso no es recuperación, es **saneamiento de evidencia**, y tiene un costo: el
master prohíbe expresamente marcar como procesados los eventos muertos, que son
la prueba del incidente. Reprocesarlos los reescribe.

## Recomendación a Dirección

**No ejecutar el reproceso.** Los 203 se conservan intactos como evidencia y la
etiqueta correcta se aplica sola a los acuses futuros, ya con el arreglo puesto.
Si aun así se quiere el saneamiento retroactivo, hace falta una autorización
específica que levante la prohibición de reescribir los muertos.

Lo que sí queda pendiente y es la causa del VOLUMEN —no del defecto— es
operativo: mientras se responda desde el teléfono en vez de desde Nexus, cada
respuesta va a seguir generando tres acuses sin dueño. La rama
`claude/whatsapp-comercial-sandbox-fec91b` (responder desde Nexus) es lo que
cierra esa fuente; es un expediente aparte.

STOP — BACKFILL_LISTO
