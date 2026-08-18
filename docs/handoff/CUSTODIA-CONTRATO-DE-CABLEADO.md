# CUSTODIA DIGITAL · CONTRATO DE CABLEADO

**Expediente:** CUSTODIA-CIERRE-CIRCUITO · 16-08-2026
**Última actualización:** **Bloque B-1 · HN-1** — se cierra el caño por los dos
extremos: la aplicación deja de enrutar a la v1 y `0257` retira la creadora
heredada de casos no físicos (§13). Antes: 2-C-2, el CIERRE PROBATORIO (§11)
**Regla permanente:** ninguna sesión cierra sin actualizar este archivo (§7).

---

## 0 · IDENTIDAD DEL PUNTO DE PARTIDA

```
repo       /Users/martinbattaglia/CODE/tops-ordenes
worktree   /Users/martinbattaglia/NEXUS-WORKTREES/custodia-cierre-circuito
rama       custodia/cierre-circuito
HEAD       76fafb10a799c246f4fbb5644815d10d883e3654
árbol      limpio · 0 rutas sucias al abrir la sesión
```

Los ocho archivos exigidos existen y se leyeron completos:

| Archivo | Líneas |
|---|---|
| `src/lib/custody/case-presentation.ts` | 504 |
| `src/lib/custody/integrity-adapters.ts` | 558 |
| `src/app/(app)/wms/custody/_components/PhysicalCapturePanel.tsx` | 213 |
| `src/app/(app)/wms/custody/_components/CaseInspectionPanel.tsx` | 183 |
| `src/app/(app)/wms/custody/_components/CaseReevaluatePanel.tsx` | 111 |
| `src/app/(app)/wms/custody/_components/CaseDecisionPanel.tsx` | 182 |
| `supabase/migrations/0250a_custody_productive_vision.sql` | 2555 |
| `tests/custody-db/t-c1-05-append-only-vanilla.test.ts` | 688 |

**Toda referencia `archivo:línea` de este documento está tomada de ese HEAD**,
con excepciones declaradas. Son **tres épocas**, no dos, y conviene decirlo
entero para que nadie abra el archivo equivocado:

1. **La regla general** — el HEAD de arriba. Vale para todo lo que no esté en 2
   ni en 3.
2. **`integrity-supabase.ts:302-304`**, citada en §13.2, resuelve contra
   **`fe5c92f`** (la base del bloque B-1): es la ubicación del ternario de
   `custody_inspection_candidates` **antes** de este bloque. El propio §13.2 la
   rotula «antes de este bloque».
3. **`integrity-supabase.ts:263-293` y `:319-321`**, introducidas por §13,
   resuelven contra el **candidato de B-1**, porque describen el código
   **después** del cambio. §13.2 explicita el corrimiento entre 2 y 3.

---

## 1 · CÓMO SE LEE ESTE DOCUMENTO

Una fila por dato o capacidad. Cada celda lleva su ancla verificada: `archivo:línea`
o el nombre del objeto SQL. Una celda sin ancla no se escribió; donde no se pudo
comprobar, dice **NO VERIFICADO** y explica por qué.

**Estado:**

- `CABLEADO` — el dato llega desde la base hasta la superficie que lo consume.
- `CORTADO EN <capa>` — existe en la base y se pierde en una capa identificada,
  con la línea exacta donde se pierde.
- `NO EXISTE` — no hay implementación en ninguna capa.

**Las capas, y qué archivo es cada una en este módulo:**

| Capa | Archivo autoritativo | Nota |
|---|---|---|
| Base | `supabase/migrations/*.sql` | — |
| RPC / lectura | `src/lib/custody/integrity-supabase.ts` | **el caso NO se lee por RPC**: se lee por PostgREST en `integrity-supabase.ts:105`, con el conjunto de columnas fijado en `integrity-supabase.ts:63-69` |
| Adapter | `src/lib/custody/integrity-adapters.ts` | `buildIntegrityCase` en `:344-376` |
| View-model | `src/lib/custody/case-presentation.ts` | `buildCustodyCaseView` en `:278-481`; el tipo que puede transportar datos es `CustodyCaseView` en `:203-240` |
| UI | `src/app/(app)/wms/custody/**` | — |

> **Advertencia de método, verificada.** El nombre de las cosas miente en este
> módulo. `CASE_COLUMNS` (`integrity-supabase.ts:63-69`) **sí** pide
> `similarity_score`, `threshold_percent`, `threshold_result`, `score_components`,
> `packaging_changed`, `missing_items_suspected`, `damage_suspected`, `public_id` y
> `client_id`. Que la lectura los pida no significa que lleguen a la pantalla: casi
> todos mueren después. Verificar la capa, no el nombre.

---

## 2 · LA TABLA

| # | Dato / capacidad | Base | RPC/lectura | Adapter | View-model | UI | Permiso | Estado |
|---|---|---|---|---|---|---|---|---|
| 1a | Razón social del cliente | `clients.razon` · `0001_init.sql:40` · depositante asentado en `receptions.client_name` `0025:41` | `CASE_COLUMNS` embebe `clients(razon)` y `receptions(client_name)` · `integrity-supabase.ts:88-92` | `mapCaseIdentity` `integrity-adapters.ts:172-186` | `identity.clientLabel` · `case-presentation.ts:buildIdentityView` | encabezado `[id]/page.tsx` · `data-cliente` | RLS de tenant; `clients.razon` exige `clientes.view`, y por eso cae al depositante de recepción | **CABLEADO** |
| 1b | `client_id` del caso (UUID) | `custody_integrity_cases.client_id` `0222:601` | `CASE_COLUMNS` | `entity.clientId` + `mapCaseIdentity` | `identity` (no se pinta el UUID: se pinta el nombre) | encabezado | idem | **CABLEADO** |
| 2a | `public_id` del caso (CINT-) · **detalle** | `custody_integrity_cases.public_id` · generado en `0250a:433` y `0223:130` | `CASE_COLUMNS` | `mapCaseIdentity` (el dominio `IntegrityCase` sigue puro: la identidad viaja aparte) | `identity.casePublicId` | chip `data-cint` en el encabezado | idem | **CABLEADO** |
| 2b | `public_id` del caso (CINT-) · **listado** | idem | `custody.ts:1109` lo selecciona | `custody.ts:1115` lo mapea | `CustodyIntegrityCaseRow` | listado `wms/custody/page.tsx:30` | `wms.view` | **CABLEADO** |
| 2c | `public_id` de la unidad (CPU-) | `custody_physical_units.public_id` `0250a:24` | `CASE_COLUMNS` embebe `custody_physical_units(...)` | `mapCaseIdentity` | `identity.unitPublicId` | chip `data-cpu` en el encabezado | `wms.view` + RLS `custody_physical_units_read` `0250a:68-73` | **CABLEADO** |
| 2d | SKU, cantidad, lote, vencimiento | `custody_physical_units.sku / quantity / lot_number / expiration_date` `0250a:30-33` | `CASE_COLUMNS` | `mapCaseIdentity` | `identity.sku / quantity / lotNumber` | línea del bien en el encabezado | `wms.view` | **CABLEADO** |
| 2e | Recepción de origen + enlace | `custody_physical_units.reception_id` `0250a:26` → `receptions(public_id)` | `CASE_COLUMNS` (embed anidado) | `mapCaseIdentity` | `identity.receptionPublicId / receptionId` | enlace `data-recepcion` en el encabezado | `wms.view` + RLS de `receptions` | **CABLEADO** |
| 3 | `similarityScore`, `thresholdResult`, `scoreComponents` | `0250a` · columnas del caso; `score_components` escrito en `integrity-supabase.ts:390-395` | `integrity-supabase.ts:65-67` | `integrity-adapters.ts:304-317` | `similarityScore` + `concordance` derivado (`deriveConcordance`) | `CaseAiPanel.tsx` · número de concordancia, veredicto cualitativo, barra SIN marca de umbral y los cuatro componentes | informativo, sin permiso propio | **CABLEADO** |
| 4 | `thresholdPercent` | `custody_integrity_cases.threshold_percent` · criterio en `0250a:2114-2116` | se sigue leyendo | `integrity-adapters.ts` → `IntegrityAssessment` | **NO EXISTE en `AiPanelView`**: se consume para derivar `concordance` y no viaja | nada que renderizar, por construcción | — | **NO VIAJA · CONFORME (I3 + D-4)** · la especificación visual del §7 se implementó BAJO D-4: las capturas mostraban el umbral en siete lugares y ninguno se implementó así. No es incumplimiento de la spec: es la política de empresa por encima de ella. Ver §14 |
| 5a | `damageFlags` (embalaje / faltante / daño) | `packaging_changed`, `missing_items_suspected`, `damage_suspected` | `CASE_COLUMNS` | `integrity-adapters.ts` | `ai.damageFlags` | chips `data-banderas` en `CaseAiPanel` | — | **CABLEADO** |
| 5b | `provider_details` (observations, zones) | escrito en `integrity-supabase.ts:406-410` (`p_provider_details`) | `CASE_COLUMNS` ahora **sí** pide `provider_details` | `boundedStrings` en `mapAssessment` (recorta a 6 × 240/120) | `ai.observations` / `ai.zones` | bloque «Observaciones del análisis» en `CaseAiPanel` | — | **CABLEADO** |
| 6a | `quarantine.blockers` | `0250a:2088-2099` (las reglas que producen el bloqueo) | — | — | `case-presentation.ts` · habilitado también en `HOLD` (S1-5) | `CaseDecisionPanel` · bloque «Por qué no se puede enviar a cuarentena» (`data-cuarentena-blockers`) | `wms.custody.decide` + rol `admin`/`operaciones`/`supervisor` (0251) | **CABLEADO** |
| 6b | `release.blockers` | `0250a:2108-2150` | — | — | `case-presentation.ts:325-377`, expuesto en `:438-443` | `CaseDecisionPanel.tsx:172-179` · encabezado «Por qué no se puede liberar» | `wms.custody.decide` + rol `admin` | **CABLEADO** |
| 7 | Certificado de liberación | tabla `custody_release_certificates` `0250a:1742-1794` · insertado en `0250a:2182-2186` · validador `custody_assert_release_certificate` `0250a:1796` · `grant select ... to authenticated` `0250a:1786` | **cero lecturas** · `grep -rn "custody_release_certificates" src/` → 0 resultados | — | — | — | SELECT concedido a `authenticated`, sin consumidor | **CORTADO EN lectura** |
| 8 | Códigos de gate de despacho (los seis `CUSTODY_*`) | `CUSTODY_CASE_MISSING` `0250a:2304` · `CUSTODY_HOLD` `0250a:2307` · `CUSTODY_RELEASE_CERTIFICATE_MISSING` `0250a:2312` · `CUSTODY_CHAIN_ADVANCED_AFTER_RELEASE` `0250a:2316` · `CUSTODY_GENEALOGY_MISSING` `0250a:2361` · `CUSTODY_ZERO_APPLICABLE_CASES` `0250a:2401` | **ningún traductor** · `grep -rn "CUSTODY_HOLD\|CUSTODY_GENEALOGY_MISSING\|..." src/` → 0 resultados | — | — | el error crudo de PostgreSQL sube tal cual al despachante | — | **CORTADO EN lectura** |
| 9 | Puente recepción → caso de custodia | mismo trigger, con `custody_materialize_reception_item_row` **condicional** (0252 §5): la unidad siempre, el caso sólo en nivel 2 | `custody_reception_units` (0252 §8) | — | `ReceptionCustodyUnit` en `recepciones/actions.ts` | lista posterior a confirmar, con enlace a cada caso | la función sigue revocada para todos los roles: corre **sólo** como trigger | **CABLEADO** |
| 15 | Nivel de custodia contratado (D3) | `clients.custody_level` (default 1) · `receptions.custody_reforzada` (eleva, nunca degrada) · `custody_physical_units.custody_level` (default 2: preserva lo ya materializado) · 0252 §1-§4 | `custody_client_level` (SECURITY DEFINER, exige `wms.view`) — `clients` pide `clientes.view` por RLS y un encargado de depósito no lo tiene | — | estado local del formulario | casilla «esta mercadería ingresa por custodia digital reforzada» · `data-custodia="reforzada"` | `wms.view` para leer el nivel | **CABLEADO** |
| 16 | Foto de ingreso tomada en la RECEPCIÓN (I4) | `attach_custody_physical_evidence`, ahora también para nivel 1 (0252 §7b) | `attachPhysicalEvidence` en `src/lib/custody/physical-ingress.ts` | — | `createConfirmAndCaptureAction`, con la guarda `assertPositionRequired` de Fase B **antes** de crear la cabecera | input por ítem con `capture="environment"` en `NewReceptionForm` · `data-foto-ingreso` | `wms.edit` + posición obligatoria por línea (A-6) | **CABLEADO** |
| 17 | Señal de custodia en el listado de recepciones | `custody_physical_units` + `custody_events` | embed en `listReceptions` | — | `ReceptionRow.custody_units / custody_units_con_foto / custody_reforzada` | insignia `data-custodia="unidades"` en `recepciones/page.tsx` | `wms.view` | **CABLEADO** |
| 10 | Puerta de la foto de egreso en el flujo de salida | gates disparados por trigger en `0250a:2417 / 2486 / 2507 / 2529` | — | — | — | **cero menciones de custodia** en picking y packing (`grep -rniE "custod\|CPU-\|physical_unit"` sobre `wms/picking` y `wms/packing` → 0 resultados); en despachos sólo `CustodyShipmentSection` (`despachos/[id]/page.tsx:172-175`), que es scope `shipment` | — | **NO EXISTE** |
| 11a | Resolución del token del QR | `get_custody_physical_by_token` `0250a:2253-2289` · `revoke ... from public,anon` `:2291` · `grant ... to authenticated` `:2292` | `getCustodyByToken` (`custody.ts`), consumido en `c/[token]/page.tsx:18` | — | — | `c/[token]/page.tsx:41-84` | `assert_custody_access('wms.view')` `0250a:2261` | **CABLEADO** (autenticado) |
| 11b | Compuerta del POD para unidad física | POD ligado a `shipment` | `actions.ts:568` sólo calcula `podPdfReady` cuando `scope === "shipment"` | — | `case-presentation.ts:462-468` | `[id]/page.tsx:86` fija `shipmentId = isShipment ? view.entityId : null`; `CasePodGate.tsx:19` bloquea con `view.podBlocked \|\| !shipmentId` → **la unidad física queda bloqueada siempre**, y con el caso ya `RELEASED` el motivo es `null` (`case-presentation.ts:464`) y cae al literal por defecto `CasePodGate.tsx:24` | — | **CORTADO EN view-model** |
| 14 | Permiso de **captura del par** ingreso/egreso | `attach_custody_physical_evidence` (0251) rechaza por estado SÓLO con `state in('RELEASED','QUARANTINED')` | `actions.ts` exige `CUSTODY_CAPTURE_PERMISSION` (`wms.edit`) antes de tocar Storage | — | **`capture`** — campo PROPIO · `PhysicalCaptureView` | `PhysicalCapturePanel` · `view.capture.enabled` + `view.capture.blockers[0]` en los dos slots | `wms.edit` | **CABLEADO** |
| 13 | Decisión de casos **no** físicos (`packing_unit` / `shipment`) | `decide_custody_integrity` (v1) **revocada** para `authenticated` · `0250a:2199-2200` · creadora `upsert_custody_integrity_assessment` **revocada** para `authenticated` · `0257` | `integrity-supabase.ts:263-293` ya **no** enruta a la v1: rechaza tipado | — | — | rechazo `CustodyContractError` → `SCOPE_NOT_DECIDABLE` → «Este caso no es de una unidad física: no se decide desde esta pantalla» | `wms.custody.decide` | **NO EXISTE · CERRADO A PROPÓSITO por los dos extremos (HN-1)** |
| 12 | Firma de quien retira | — | — | — | — | — | — | **NO EXISTE** |

> ⚠ **CÓMO SE LEE LA COLUMNA «ESTADO» DE ESTA TABLA · época mixta.**
>
> La tabla **no** es una foto coherente de un solo momento, y decirlo es
> preferible a fingir que lo es:
>
> - las filas **7**, **8** y **10** conservan su estado de **2-A**; sus cambios
>   posteriores viven en los deltas de §10.1 y §11.1, que es la convención que
>   practicaron los bloques 2-B y 2-C-2;
> - la fila **13** se actualizó **in situ**, por instrucción expresa del master
>   del bloque B-1 (§13).
>
> Por eso **el recuento vigente del expediente NO es el de acá abajo: es el de
> §13.5.** Los dos que siguen son históricos y se conservan como registro.

**Recuento tras el bloque 2-A (histórico):** 25 filas · **CABLEADO 18** ·
**CORTADO 4** · **NO EXISTE 2** · **NO VIAJA por diseño 1**. Ese recuento
describía la tabla tal como quedó en 2-A, cuando la fila 13 todavía figuraba
como `CORTADO EN lectura`.

*(Al cerrar la Sesión 0 eran 20 filas: 4 CABLEADO, 14 CORTADO, 2 NO EXISTE.)*

*(Contada hoy, columna por columna, esta tabla da CABLEADO 18 · CORTADO 3 ·
NO EXISTE 3 · NO VIAJA 1: la diferencia con el histórico es exactamente la fila
13 y ninguna otra.)*

---

## 3 · DÓNDE SE PIERDE CADA DATO · LÍNEA EXACTA

### C-1 · La identidad del cliente

`integrity-adapters.ts:359` arma la entidad completa:

```ts
entity: { scope: scopeOf(row), entityId: entityIdOf(row), clientId: row.client_id },
```

`case-presentation.ts:433-434` copia dos de los tres campos:

```ts
scope: c.entity.scope,
entityId: c.entity.entityId,
```

`clientId` no vuelve a aparecer. `CustodyCaseView` (`case-presentation.ts:203-240`)
**no tiene ningún campo de cliente**, así que no es un olvido de asignación: es un
tipo que no puede transportarlo.

Además, incluso si se copiara, sería un UUID: la **razón social** vive en
`clients.razon` (`0001_init.sql:40`) y ninguna lectura del módulo la trae.
**Son dos cortes, no uno**, y hay que reparar los dos.

### C-2 · Los identificadores del bien

`buildIntegrityCase` (`integrity-adapters.ts:344-376`) construye `IntegrityCase`
sin `public_id`, aunque `RawCaseRow` lo declara (`integrity-adapters.ts:102`) y la
lectura lo pide (`integrity-supabase.ts:64`). El caso se lee, el identificador
legible se descarta en el mismo paso.

CPU-, SKU, cantidad, lote y recepción viven todos en `custody_physical_units`
(`0250a:21-40`). El caso guarda sólo `physical_unit_id`. **No existe ninguna
lectura en el módulo que haga ese join**, así que el corte es anterior al adapter.

### C-3 · El análisis que se calcula y no se pinta

Los cinco campos llegan intactos al view-model:

- `similarityScore` — `case-presentation.ts:291`
- `thresholdPercent` — `case-presentation.ts:292`
- `thresholdResult` — `case-presentation.ts:294`
- `scoreComponents` — `case-presentation.ts:295`
- `damageFlags` — `case-presentation.ts:296-305`

`CaseAiPanel.tsx` (60 líneas, leído entero) dibuja **sólo** `confidencePercent`
(`:19-26`) y `verdictLabel` (`:27-29`). Verificación negativa dura:

```
grep -rn "similarityScore|thresholdResult|scoreComponents|damageFlags|thresholdPercent" "src/app/(app)"
→ 0 resultados
```

**El rótulo «confianza informada» (`CaseAiPanel.tsx:22-24`) está correcto y no se
toca.** El defecto es de ausencia.

### C-4 · El bloque de `referenceThreshold`

`CaseAiPanel.tsx:42-48` existe y renderizaría `Referencia operativa {percent}%`.
Hoy no se ve porque el servidor manda `referenceThreshold: null` en
`actions.ts:586`. Es **código muerto, no una decisión de diseño**: poblarlo
imprimiría exactamente la cadena que la regla de borrado manda eliminar.

### C-5 · El scope de dos ramas

`integrity-adapters.ts:222-228` (`scopeOf`) **sí** contempla `physical_unit`. El
defecto no está ahí, está en el listado:

- `custody.ts:1048` — la consulta **ni siquiera pide** `physical_unit_id`
- `custody.ts:1056` — `scope: c.packing_unit_id ? "packing_unit" : "shipment"`
- `custody.ts:1057` — `entity_id: (c.packing_unit_id ?? c.shipment_id)` → **null**

> Numeración de la época del hallazgo (Sesión 0); el defecto está REMEDIADO
> (C5) y esas líneas viven hoy en `custody.ts:1109` (select con la columna) y
> `custody.ts:1121-1127` (ternario de tres ramas), corridas por las +51 líneas
> de `resolveActorNames` (§14.4). La C4 1/2 (C-4) encontró estos punteros
> vueltos falsos por el propio candidato sin anotar.
- `custody.ts:948-949` — mismo par en `listRecentCustodyEvents`

El corte es de **lectura** antes que de mapeo: agregar la tercera rama del ternario
sin agregar la columna a la consulta no arregla nada.

### C-6 · Los botones que mueren

| Panel | Guard | ¿`finally`? | Consecuencia |
|---|---|---|---|
| `PhysicalCapturePanel.tsx:82` | `if (!res) return;` | `finally` en `:95-97` limpia **`enCurso`**, no **`estado`** | `estado` queda en `"subiendo"` → `enVuelo` (`:107`) queda `true` → botones muertos (`:193`, `:203`) |
| `CaseInspectionPanel.tsx:76` | `if (!res) return;` | **sin `finally`** (`:55-90`) | `estado` queda en `"subiendo"` → `deshabilitado` (`:95`) → botón muerto (`:168`) |
| `CaseReevaluatePanel.tsx:41` | `if (!res) return;` | **sin `finally`** (`:32-53`) | `estado` queda en `"evaluando"` → `deshabilitado` (`:58`) → botón muerto (`:96`) |
| `CaseDecisionPanel.tsx:64` | `if (!res) return;` | **`finally { setSubmitting(false) }`** en `:70-72` | **correcto — éste es el patrón a copiar (I6)** |

### C-7 · La habilitación invertida

`PhysicalCapturePanel.tsx:110`:

```ts
const permitido = view.inspection.enabled || !tieneIngreso || !tieneEgreso;
```

Disyunción con la ausencia de foto: mientras falte una, `permitido` es `true` sin
que el permiso llegue a evaluarse. Con las dos cargadas, el panel se apaga solo.

En el mismo componente, `PhysicalCapturePanel.tsx:166-182`: **un solo
`<input type="file">` compartido por los dos botones** (`:196` ingreso, `:206`
egreso). Registrar el ingreso como egreso es irreversible en una cadena inmutable.

### C-8 · El `catch` vacío

`actions.ts:221-227`:

```ts
} catch {
  void attestationId;
  return { ok: false, error: "reconciliation_required" };
}
```

Cualquier excepción se convierte en `reconciliation_required`, y los tres paneles
lo traducen a *«No la vuelvas a sacar: avisá a soporte»*
(`PhysicalCapturePanel.tsx:52-54`, `CaseInspectionPanel.tsx:46-48`).

El rechazo más frecuente que cae ahí está identificado: `0250a:900-906` levanta
`unique_violation` cuando la foto de egreso reutiliza los bytes del ingreso. Eso
es **exactamente lo contrario** de lo que el mensaje dice: hay que volver a sacarla.

### C-9 · El deadlock de la inspección · las dos mitades

La base **sí** tiene la excepción. `0250a:2129-2133`:

```sql
if exists(select 1 from public.custody_events ev
  where ev.physical_unit_id=c.physical_unit_id and ev.chain_seq>v_eval_seq
    and ev.event_type<>'inspeccion_humana') then
```

La UI **no la tiene**. `actions.ts:540-544`:

```ts
const head = await ctx.query.verifyChainHead(found.entity.scope, found.entity.entityId);
chainAdvanced = head !== null && head !== found.chain.attestation.chainHead;
```

Comparación de hashes sin discriminar tipo de evento. Ese booleano entra en
`case-presentation.ts:373-377` y agrega el bloqueo de liberación. La foto de
inspección obligatoria bloquea la liberación que ella misma habilita.

### C-10 · El HOLD sin salida

| Capa | Regla | Ancla |
|---|---|---|
| Base | acepta decidir desde `REVIEW_REQUIRED` **y** `HOLD` | `0250a:2096` |
| View-model | bloquea cuarentena para todo estado ≠ `REVIEW_REQUIRED` | `case-presentation.ts:382-384` |

La base es más permisiva que la pantalla. El caso en `HOLD` no tiene salida por UI.

### C-11 · El reescrito de estado en el attach

`0250a:934-948` — la rama que no es `inspeccion_humana` hace, **siempre**:

```sql
state='PENDING_EVIDENCE', hold_reasons=array['EVIDENCE_MISSING']::text[],
```

También cuando el adjunto que acaba de entrar es el que completaba el par. Con las
dos fotos cargadas, el caso sigue declarando que falta una.

### C-12 · La evidencia de egreso mal priorizada

`[id]/page.tsx:101-104`:

```ts
const egreso =
  firstEvidence(timeline, (e) => e.event_type === "inspeccion_humana") ??
  firstEvidence(timeline, (e) => e.event_type === "foto_egreso") ??
  firstEvidence(timeline, (e) => e.stage === "entrega");
```

`inspeccion_humana` gana sobre `foto_egreso`. La tarjeta de egreso muestra la foto
de inspección, y `tieneEgreso` (`[id]/page.tsx:182`) declara egreso registrado
cuando no lo hay.

### C-13 · La compuerta del POD

`[id]/page.tsx:86` → `const shipmentId = isShipment ? view.entityId : null;`
`[id]/page.tsx:187` → `<CasePodGate view={view} shipmentId={shipmentId} ... />`
`CasePodGate.tsx:19` → `if (view.podBlocked || !shipmentId)`

Para todo caso de unidad física, `shipmentId` es `null` y la compuerta bloquea
aunque el caso esté `RELEASED`. Y en ese estado `podBlockedReason` es `null`
(`case-presentation.ts:464`), así que cae al literal `"POD bloqueado"`
(`CasePodGate.tsx:24`) sin decir por qué.

Además, `PodPdfData` (`PodPdfDocument.tsx:90`, poblado en `pod-pdf.ts:151-158`)
lleva `podPublicId`, `shipmentPublicId`, `shipmentId`, `receiverName`,
`receiverDocument`, `observations`, `signedAt` y `timeline`: **ningún campo de
depositante**. El documento que sale del edificio no dice de quién es la mercadería.

### C-14 · Los enums crudos y el traductor ausente

- `STATE_LABEL` es `const` **privado** del módulo: `case-presentation.ts:41`, sin
  `export`. Único consumidor: `case-presentation.ts:430`.
- `c/[token]/page.tsx:52` imprime `{result.status}` — el enum crudo, sin traducir.
- No existe traductor de los seis códigos `CUSTODY_*` en ninguna capa.

---

## 4 · PERMISOS QUE GOBIERNAN CADA COSTURA

| Acto | Permiso / rol | Dónde se exige | Estado verificado |
|---|---|---|---|
| Ver el caso | RLS de tenant + `assert_custody_tenant` | `0250a:2099` | vigente |
| Capturar evidencia | `wms.edit` (`CUSTODY_CAPTURE_PERMISSION`) | `case-presentation.ts:268`; verificado antes del upload en `actions.ts:148-150` | vigente |
| Decidir (cuarentena o liberación) | `wms.custody.decide` | `assert_custody_access('wms.custody.decide')` · `0250a:2087` | vigente |
| **Liberar** | rol `admin` — **doble candado** | función: `0250a:2109` (`if v_role<>'admin'`) · fila: CHECK de `0222` reflejado en `case-presentation.ts:38` | vigente |
| **Cuarentenar** | **ninguna lista de roles** | `decide_custody_integrity_v2` `0250a:2070-2194` leída entera: no hay chequeo de rol para la rama `quarantine` | **HUECO CONFIRMADO** |
| Resolver el token del QR | `wms.view`, autenticado | `0250a:2261` · `revoke ... from public,anon` `0250a:2291` | vigente |

**El comodín está confirmado.** `20260811230310_rbac_gerencia_finanzas_constraint_safe.sql:52-59`:

```sql
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.slug in ('gerencia_comercial', 'administracion_finanzas')
  and p.slug not like 'sistema.%'
  and p.slug <> 'rrhh.documentacion.view'
```

`wms.custody.decide` no está en ninguna de las dos exclusiones, y el nombre de la
migración (formato timestamp) ordena después de `0222`, que es la que crea el
permiso (`0222_custody_integrity_foundation.sql:77`). **En una base reconstruida,
gerencia comercial y administración y finanzas pueden decidir casos de custodia.**

Verificado además: esa migración **no** está en la allowlist `MIGRACIONES_EDITABLES`
(`t-c1-05-append-only-vanilla.test.ts:84-92`, cuya única entrada es
`0250a_custody_productive_vision.sql`) y **sí** está registrada en
`supabase/lineage/catalog.json`. **No se puede editar: el único camino es el REVOKE
en una migración nueva.**

---

## 5 · CELDAS NO VERIFICADAS · Y POR QUÉ

Esta sesión tiene prohibido conectarse a Supabase, a producción o a cualquier
sistema externo. Todo lo que exige estado de base queda **NO VERIFICADO**:

| Pregunta | Por qué no se verificó |
|---|---|
| ¿Martin Battaglia, José Luis Rodríguez y Martín Rinas tienen hoy rol `admin`, y son los únicos? | exige leer `profiles` en la base productiva |
| ¿Hay otras personas con `admin` además de esas tres? | idem |
| ¿`0250a` está aplicada en producción? | exige leer el estado de migraciones de la base |
| ¿El comodín `20260811230310` está aplicado, y con qué efecto real hoy? | idem — lo verificado es **el texto de la migración**, no su efecto vigente |
| ¿Existen casos históricos en `PENDING_EVIDENCE` sin foto posible? | exige contar filas |
| ¿`wms.edit` lo tienen hoy los encargados de depósito? | exige leer `role_permissions` |

**Ninguna de estas preguntas se respondió por inferencia.** Son ventana de base y
corresponden a una autoridad que esta sesión no tiene.

---

## 6 · HALLAZGOS NUEVOS

Costuras que el master no enumeró. **Se documentan, no se arreglan.**

### HN-1 · Los casos que no son de unidad física ya no se pueden decidir desde la UI

> **🟢 CERRADO · bloque B-1 · expediente CUSTODIA-HN-1-CIERRE.** Ver §13. Lo que
> sigue es el hallazgo tal como se determinó, conservado como registro; el
> estado vigente de la costura 13 es **NO EXISTE · CERRADO A PROPÓSITO**.

`0250a:2199-2200` revoca la RPC v1 para `authenticated`:

```sql
revoke execute on function public.decide_custody_integrity(uuid,int,text,text,text,uuid[])
  from authenticated;
```

Pero `integrity-supabase.ts:188-190` sigue enrutando ahí todo scope que no sea
físico:

```ts
const fn = input.scope === "physical_unit"
  ? "decide_custody_integrity_v2"
  : "decide_custody_integrity";
```

**Consecuencia:** un caso de scope `packing_unit` o `shipment` no tiene camino de
decisión desde la pantalla — la RPC que la UI invoca está revocada para el rol de
sesión. Y como C-5 rotula *todo* caso físico como «Despacho» en el listado, la
superficie no distingue cuáles caen de qué lado.

Interacción adicional: `actions.ts:656` deriva el scope con una consulta extra
(`(await query.selectCase(id))?.physical_unit_id ? "physical_unit" : undefined`),
de modo que el mismo caso se lee dos veces por decisión.

### HN-2 · Una cadena de umbral prohibida, ya escrita y visible al operario

`case-presentation.ts:90`:

```ts
BELOW_SIMILARITY_THRESHOLD: "El score está por debajo del umbral del 90 %",
```

Es una etiqueta de cara al usuario, renderizada por `holdLabel`
(`case-presentation.ts:114-116`) en `view.holdLabels` (`:435`) y pintada en
`CaseAiPanel.tsx:50-57`. **Cae de lleno bajo la regla de borrado del encabezado
del master**, y no es una maqueta: es código vivo.

En la misma tabla, `case-presentation.ts:108` dice «El score no alcanza el umbral
productivo» — sin número, así que ésa no viola la regla, pero conviene revisarla
en la misma pasada.

### HN-3 · Fallback silencioso a datos inventados en el listado (C8)

`custody.ts:1102-1104`:

```ts
if (isMock()) return MOCK_CASES;
const supabase = createClient();
if (!supabase) return MOCK_CASES;
```

`MOCK_CASES` contiene un caso ficticio con `public_id: "CINT-2026-0001"` y
`entity_id: "ship-demo"`. En un módulo probatorio, **mostrar un caso ficticio en
silencio es un riesgo de otra naturaleza que un defecto de UI**. El master lo
declara fuera de alcance pero pide reportarlo con prioridad (§8): queda reportado.

### HN-4 · La primera numeración libre de migración no es `0251`

El master indica que el primer número libre es `0251` y pide verificarlo. **Lo es**,
en este árbol: los archivos presentes en la franja son `0250_custody_physical_scope_enums.sql`
y `0250a_custody_productive_vision.sql`; `0245`–`0249` no existen en este worktree.

**Pero esa ausencia local no significa que estén libres.** El master mismo declara
que `0245`–`0249` están tomados por frentes vivos que `main` todavía no ve
(entre ellos `0245_depot_managers_exact_rbac.sql`, rama `clientes-ordenes-rbac-r1`,
sin trackear). **El árbol no puede probar que `0251` esté libre**: la comprobación
tiene que hacerse contra el conjunto de frentes vivos, no contra este directorio.
Queda marcada como **NO VERIFICADO** para la Sesión 1.

---

## 7 · REGLA PERMANENTE

**Ninguna sesión posterior cierra sin actualizar este archivo.**

Al cerrar cada sesión, toda fila tocada cambia de estado y de anclas. Una fila que
pasó a `CABLEADO` sin que su ancla de UI apunte a JSX real es una fila mentida.

---

## 9 · SESIÓN 1 · QUÉ CAMBIÓ Y QUÉ QUEDÓ ABIERTO

### 9.1 · Lo que se cerró

| Punto | Qué se hizo | Dónde |
|---|---|---|
| S1-1 | REVOCAR el comodín + guarda estructural · OTORGAR a `operaciones` · lista de roles de cuarentena (`cliente` excluido) | `0251_custody_decide_authority.sql` + su ROLLBACK + catálogo |
| S1-2 | Los DOS cortes de identidad y C5 en los dos listados | `integrity-supabase.ts` · `integrity-adapters.ts` · `case-presentation.ts` · `custody.ts` |
| S1-3 | Tres `finally` · conjunción con el permiso · **un input por slot** · traducción de rechazos de regla | los tres paneles + `classifyPhysicalAttachRejection` |
| S1-4 | Análisis automático al completarse el par · fin del `EVIDENCE_MISSING` incondicional · egreso e inspección separados | `actions.ts` · `0251` acto 4 · `[id]/page.tsx` |
| S1-5 | Cuarentena habilitada en `HOLD` · `quarantine.blockers` pintados | `case-presentation.ts` · `CaseDecisionPanel` |
| S1-6 | La UI espeja la exclusión de `inspeccion_humana` que la base ya aplicaba | `integrity-supabase.ts` · `actions.ts` |
| S1-7 | Concordancia + veredicto cualitativo + componentes + banderas + observaciones · umbral eliminado de toda superficie | `CaseAiPanel` · `case-presentation.ts` |

### 9.2 · El umbral, en concreto

Tres cadenas de cara al usuario nombraban el umbral y ya no lo hacen:

- `BELOW_SIMILARITY_THRESHOLD` decía «El score está por debajo del umbral del 90 %»
  → **«Requiere inspección física antes de decidir»**;
- `SCORE_BELOW_THRESHOLD` decía «El score no alcanza el umbral productivo»
  → **«La concordancia exige inspección física adicional»**;
- `NO_CALIBRATED_THRESHOLD` decía «No hay umbral calibrado aprobado»
  → **«El criterio automático no está configurado: revisión humana completa»**.

El bloque `referenceThreshold` de `CaseAiPanel` se borró y el campo salió del
view-model. `thresholdPercent` **tampoco viaja**: se consume server-side para
derivar el veredicto. La garantía es estructural, no una convención de render.

### 9.3 · Costura 13 · HN-1, determinado y NO remediado

**(a) ¿`decide_custody_integrity_v2` acepta scopes no físicos?** **No, y los
rechaza explícitamente.** `0251:161` (equivalente a `0250a:2094`):

```sql
if c.physical_unit_id is null then
  raise exception 'decisión v2 exige scope physical_unit' using errcode='check_violation';
end if;
```

Y no es sólo esa guarda: el cuerpo es físico de punta a punta —
`custody_chain_lock('physical_unit', …)` `0251:167`,
`custody_chain_attestation('physical_unit', …)` `0251:168` e
`is_custody_inspection_evidence_v2` `0251:239`. **Enrutar todo a la v2 no es un
cambio de una línea:** exige un cuerpo genérico por scope, o una v3.

**(b) ¿Qué otras rutas enrutan a la v1?** Una sola, y es la rota:
`integrity-supabase.ts:263-265`, el ternario de `decide()`. La otra superficie
v1 del módulo —`custody_inspection_candidates`, elegida en
`integrity-supabase.ts:302-304`— **no está rota**: `0224:313` la mantiene
concedida a `authenticated`.

**Conclusión:** el único eslabón cortado es la llamada de decisión, y la salida
—re-otorgar la v1 o generalizar la v2— es **decisión de base, de Dirección**.
No se tocó el ruteo, ni los grants, ni se escribió migración para esto.

> **🟢 CERRADO · bloque B-1.** Dirección resolvió, y la resolución no fue
> ninguna de las dos que esta sección anticipaba: **no se re-otorgó la v1, no se
> generalizó la v2 y no se escribió una v3.** Se cerró el caño por los dos
> extremos. La medición que sostiene la decisión, y el detalle de lo que se
> hizo, están en §13.

### 9.4 · Lo que la Sesión 1 NO cerró y no le correspondía

- Costuras 7, 8, 10, 11b y 12 (certificado visible, traductor de códigos
  `CUSTODY_*`, puerta de egreso en picking/packing, POD de unidad física, firma
  de quien retira): son **Sesión 2**.
- **Del §7**, tres de las cuatro piezas están **IMPLEMENTADAS · ver §14**: la
  barra de progreso de cinco pasos, el bloque `▸ AHORA` con una sola acción
  viva y el reordenamiento mobile-first. La cuarta —**el render de imagen
  grande lado a lado en `EvidenceViewer`**— sigue **SIN IMPLEMENTAR, y es
  deliberado**: ver §14.6. Ninguna de las cuatro estaba en los siete puntos de
  la Sesión 1; se hizo el encabezado de identidad, el banner de consecuencia y
  el panel de análisis, que sí lo están.
- **C8 (fallback silencioso a `MOCK_CASES`)** sigue vivo en
  `custody.ts:1102-1104`, fuera de alcance por §8.

### 9.5 · Remediación post-C4 1/2 · la captura tenía su propia costura

C4 1/2 dio FAIL. El revisor encontró que `PhysicalCapturePanel` colgaba su
habilitación de `view.inspection.enabled`, bajo una premisa que yo mismo había
escrito en un comentario y que era falsa: ese campo **no** transporta el permiso
de captura, lo funde con la exigencia de estado `REVIEW_REQUIRED`/`HOLD`.

Todo caso nace en `PENDING_EVIDENCE`. Ese estado no es ninguno de los dos, así
que los dos slots quedaban apagados justo cuando había que sacar la foto de
ingreso, con un cartel de permiso para un bloqueo que era de estado. **El
circuito estaba muerto en su primer paso**, y la UI era más restrictiva que la
base — que sólo rechaza estados terminales.

**La regla que ahora gobierna la captura**, copiada del servidor y no inventada:

| Condición | De dónde sale |
|---|---|
| permiso `wms.edit` | `actions.ts`, antes de tocar Storage |
| caso NO terminal (`RELEASED` / `QUARANTINED`) | `attach_custody_physical_evidence` en 0251 |

Y nada más. `PENDING_EVIDENCE`, `REVIEW_REQUIRED` y `HOLD` no bloquean la
captura, ni en la base ni en la pantalla. Cada blocker nombra su causa real: un
problema de estado nunca se reporta como problema de permiso.

`inspection` **queda igual**: su restricción de estado es correcta para la foto
de inspección humana, que sólo tiene sentido cuando ya hay algo que inspeccionar.

**Por qué ningún test lo veía.** La batería DOM fabricaba el view-model literal,
con `state: "REVIEW_REQUIRED"` e `inspection: { enabled: true }` escritos a mano.
Medía el literal, no el sistema: 221 verdes con el circuito roto. Ahora los seis
archivos derivan de `buildCustodyCaseView`, el mismo builder que corre en
producción (`tests/wms-dom/_view.ts`).

### 9.6 · Bloque 2-A · el circuito nace donde debe

**Paso Cero, resuelto por la PRIMERA salida que el master admite: coordinar el
orden.** `custody_materialize_reception_item_row` está revocada para todos los
roles, incluido `service_role`, y no se puede invocar; materializa únicamente el
trigger, que es SECURITY DEFINER y dispara al pasar el ítem a `recibido`, es
decir AL CONFIRMAR. Por eso `createConfirmAndCaptureAction` hace crear →
confirmar → leer las unidades recién creadas → ligar cada foto a la suya. **No
hizo falta ninguna RPC nueva de materialización, y por eso no se escribió.** El
emparejamiento foto↔unidad es por `reception_item_id`, que es UNIQUE: por SKU y
lote habría fallado con dos líneas iguales.

**Los dos niveles tocan CINCO funciones**, y la quinta llegó tarde:

| Función | Qué hace por nivel |
|---|---|
| `custody_materialize_reception_item_row` | el caso es aparato de nivel 2 |
| `custody_bind_allocation` | **vincula TODAS las unidades**, como 0250a |
| `custody_assert_allocation_released` | **cobertura primero**; con cobertura exacta y sin unidades de nivel 2 ⇒ no exige nada |
| `custody_assert_physical_unit_released` | exceptúa la unidad de nivel 1 |
| `attach_custody_physical_evidence` | acepta la foto de ingreso del nivel 1 y **rechaza** su foto de egreso |

⚠ **La primera versión de 2-A excluía el nivel 1 de la genealogía, y eso era el
blocker.** El razonamiento —«entrar a la genealogía lo sometería al gate»— era
correcto en la premisa y catastrófico en la conclusión: **estar AUSENTE de la
genealogía es exactamente lo que dispara `CUSTODY_GENEALOGY_MISSING`**. Además
destruía la información necesaria para razonar sobre allocations MIXTAS, que son
posibles porque `inventory_items` se resuelve por (client_name, sku, position_id).

La corrección revierte la exclusión y pone la condición en el GATE, no en el
vínculo. La allocation mixta se resuelve sin caso especial: cada bien se juzga
por el régimen con el que ENTRÓ.

#### 9.6.1 · El gate de allocation, en sus CUATRO ramas

⚠ **Segundo defecto del mismo gate: la salida temprana se evaluaba ANTES del
control de cobertura.** Preguntaba si HABÍA genealogía (`v_n>0 and v_n2=0`), no
si estaba COMPLETA. Bastaba una unidad de nivel 1 ligada para que la allocation
entera saliera, incluida la parte que ninguna unidad física cubría.

El orden vigente:

| # | Condición | Qué hace |
|---|---|---|
| 1 | `v_n=0` | camino de 0250a INTACTO: cobertura legacy o `CUSTODY_GENEALOGY_MISSING` |
| 2 | `v_n>0` y `v_sum<>a.quantity` | cobertura PARCIAL ⇒ mismo raise que 0250a. **El nivel no se mira** |
| 3 | cobertura exacta y `v_n2=0` | todo nivel 1 ⇒ nada que exigir, sale |
| 4 | cobertura exacta y `v_n2>0` | recorrido por unidad, los cinco chequeos de 0250a |

**Por qué no era teórico.** La custodia digital arranca de cero: ningún cliente
la tiene hoy. El escenario se arma solo con el **primer cliente que suba de
nivel 1 a nivel 2** —el camino comercial esperado—, porque sus unidades legadas
de nivel 1 conviven con stock nuevo bajo contrato, y el stock por ajuste se
acumula sobre el MISMO `inventory_item`. Medido antes de la corrección: cliente
nivel 2, `n=1 suma=2 cantidad=6` ⇒ despachaba las seis sin una sola aserción.

El comentario anterior de §7a afirmaba que el stock por ajuste aparece siempre
con `v_n=0`. Era falso, y ahí se colaba: convive con unidades físicas y deja la
genealogía PARCIAL con `v_n>0`.

### 9.7 · Juntura 2-A/2-B · reconciliación con main

Custodia se reconcilió con `main 9da9f04` en la ventana que la directiva
reservó. Seis solapamientos; **ninguno de los dos frentes perdió nada.**

Lo que cambia para Custodia, y hay que saberlo antes de 2-B:

- **La posición de cada línea de recepción es obligatoria** (Fase B · A-6): de
  ella se deriva la nave, ahora que el aislamiento por sede se retiró.
  `addReceptionItem` la exige como primera sentencia y sigue devolviendo el id
  que la captura de foto necesita para emparejar por `reception_item_id`.
- **`createConfirmAndCaptureAction` valida las posiciones ANTES de crear la
  cabecera.** El merge mecánico no lo hacía: Fase B había puesto esa guarda sólo
  en `createReceptionFull`, porque esta acción no existía de su lado. El motivo
  vale más acá, porque además de crear CONFIRMA: una línea sin posición habría
  dejado una cabecera huérfana con unidades de custodia ya materializadas.
- **El linaje pasó a 241 entradas.** Las cuatro de Custodia se renumeraron a
  238-241 (`L00238`-`L00241`) porque los dos frentes habían usado 234 y 236.
- **El ancla `ROLLBACKS` de `t-c4-01` tiene 23**, y no se deriva del catálogo a
  propósito: es lo que sobrevive a un catálogo que miente.

### 9.8 · Definición de negocio de los dos niveles (Dirección)

**NIVEL 1 — sin servicio de custodia digital.** La foto de ingreso es OPCIONAL;
su ausencia **no bloquea nada**: ni recepción, ni carga, ni reserva, ni despacho.
No pasa por IA, cuarentena, foto de egreso ni certificado. **No lleva foto de
egreso**: la base la rechaza con motivo legible, no con un código.

**NIVEL 2 — custodia contratada.** Todo obligatorio, sin aflojar nada.

**Línea roja:** ninguna excepción del nivel 1 afloja el nivel 2. Toda excepción
va acotada por nivel.

### 9.9 · Verificación pendiente de Dirección

**No se comprobó, y no se podía:** que Martin Battaglia, José Luis Rodríguez y
Martín Rinas —y sólo ellos— tengan hoy rol `admin`. Es una lectura de base
productiva y ninguna sesión está autorizada a conectarse. **Queda PENDIENTE DE
DIRECCIÓN.** Mientras no se responda, el reparto de autoridad está escrito en el
código pero no verificado contra la realidad: cada `admin` de más es alguien que
puede liberar mercadería de un cliente.

---

## 10 · BLOQUE 2-B · LA PUERTA DE EGRESO

### 10.1 · Las costuras que cambiaron de estado

| # | Dato / capacidad | Antes | Ahora | Ancla |
|---|---|---|---|---|
| 10 | Puerta de la foto de egreso en el flujo de salida | **NO EXISTE** | **CABLEADO** | máquina de estados en `src/lib/custody/egress-gate.ts`; lado servidor en `physical-egress.ts`; gate de base en `0253` §1-§2; lectura para pantalla en `0253` §3 |
| 8 | Códigos de gate de despacho (los seis `CUSTODY_*`) | **CORTADO EN lectura** · «el error crudo de PostgreSQL sube tal cual al despachante» | **CABLEADO** | `src/lib/custody/blocker-guidance.ts` · los seis, más `CUSTODY_EGRESS_PHOTO_MISSING` y `CUSTODY_EGRESS_NOT_APPLICABLE` de 0253 |
| — | Los 22 códigos de `CertificateBlocker` | sin ningún traductor | **traducidos y guiados** | `blocker-guidance.ts`; llegan a pantalla recién cuando 2-C cablee el certificado, y ya no llegarán crudos |
| — | Acceso del encargado de depósito a `/wms/custody` | **404** en dos renglones | **entra** | `src/lib/rbac/depot-manager.ts:94-102`; prueba rojo→verde en `depot-manager-routes.test.ts` |

**Recuento tras el bloque 2-B:** 25 filas · **CABLEADO 20** · **CORTADO 2** ·
**NO EXISTE 2** · **NO VIAJA por diseño 1**.

Las dos filas que siguen **CORTADAS** son la 7 (certificado sin lecturas) y la
11b (POD de unidad física), y las dos **NO EXISTE** son la 12 (firma de quien
retira) y la 13/HN-1. **Las tres primeras son de 2-C y no se tocaron.**

### 10.2 · La máquina de estados del egreso

`evaluateEgressGate` es pura —sin base, sin sesión, sin Storage— y tiene **dos
ramas disjuntas**, no una lista de condiciones con excepciones:

| Nivel | Qué exige | Resultado |
|---|---|---|
| **1** | nada | `dispatchAllowed: true` siempre; sin foto de egreso, sin IA, sin cuarentena, sin certificado |
| **2** | caso + las dos fotos + decisión humana + certificado + cadena no avanzada | `dispatchAllowed` sólo con todo cumplido |

Para el nivel 2, el orden de los motivos es deliberado: **la foto de egreso se
reclama primero**, porque es lo único que el operario puede resolver parado en el
depósito. Antes recibía `CUSTODY_HOLD` —«unidad no liberada»— y salía a buscar a
un inspector cuando lo que faltaba era sacar una foto.

### 10.3 · «La IA alerta; no decide» · dónde está escrito

La concordancia **nunca** habilita ni bloquea por sí misma:

- con concordancia suficiente, el caso **igual** queda en
  `awaitingHumanDecision: true` — el bloqueo `CUSTODY_HOLD` sigue puesto;
- con concordancia insuficiente o banderas de daño, se enciende
  `reinforcedInspectionRequired`, que **no** impide liberar: agrega la foto de
  inspección física y el motivo reforzado. Es una ALERTA, no un veredicto.

La prueba que lo fija es `«el CAMINO FELIZ sin decisión humana NO despacha»`
(`src/lib/custody-egress-gate.test.ts`). Si esa prueba se pusiera verde con
`decision: null`, la IA estaría liberando mercadería sola.

### 10.4 · La línea roja, probada

`«el MISMO input en nivel 2 NO despacha»` toma exactamente el input que el nivel
1 despacha y le cambia **una sola cosa** —el nivel— para comprobar que el nivel 2
lo rechaza. La excepción del nivel 1 no puede escaparse a nivel 2 porque no es
una excepción dentro de una lista: es una rama que retorna antes.

En la base, lo mismo: `custody_assert_egress_evidence` (0253 §1) sale por nivel
antes de mirar nada, y el `perform` que 0253 §2 agrega al gate va **después** de
`if v_level < 2 then return`.

### 10.5 · Lo que el harness encontró, y que no se parcheó

La batería pasó de verde a rojo cuatro veces durante el bloque. Ninguna se
resolvió aflojando una aserción:

1. **`vitest.config.ts` tocado.** Se agregó `src/lib/custody/**` al `include`
   para que la prueba pura corriera, y el vanilla-guard de T-C1-05 lo cazó. **Se
   revirtió el config** y la prueba se movió a `src/lib/custody-egress-gate.test.ts`,
   que cae bajo el patrón `src/lib/*.test.ts` ya existente — el mismo lugar donde
   vive `depot-manager-routes.test.ts`. El guard quedó intacto.
2. **0253 no aplicaba** en `t-c5-06`, que carga el esquema **sin 0250a** a
   propósito. Era un defecto real de declaración de dependencia: 0253 lee
   `custody_release_certificates`, que crea 0250a. Se declaró en
   `DEPENDIENTES_DE_0250A`.
3. **Manifiesto y conteos.** El guard P3-N1A0 exige decisión explícita y visible
   por migración nueva, y `EXPECTED_CUSTODY_MANIFEST_SIZE` exige moverse en el
   mismo commit. Se clasificó 0253 en los dos manifiestos y se movieron los
   conteos: forwards 12→13, manifiesto dedicado 48→49. **El cierre histórico
   sigue en 36**: no se mueve, es el pasado.
4. **Tres aserciones de nivel 2 esperaban `CUSTODY_HOLD`.** El gate ahora informa
   `CUSTODY_EGRESS_PHOTO_MISSING` primero. La invariancia que esas pruebas
   protegen —**el nivel 2 no despacha**— se mantiene intacta; lo que cambió es
   cuál de sus propios motivos informa, y el nuevo es más accionable. Se extendió
   el patrón, no se relajó la aserción.

### 10.6 · HALLAZGO FORMAL PARA 2-C · el certificado NO necesita cambio

`certificate-policy.ts:107` exige
`d.newState === "RELEASED" && d.previousState === "REVIEW_REQUIRED"`.

**Esa condición es correcta y debe quedarse.** No es una restricción de más: es
el espejo de un CHECK que la base tiene desde 0222 —
`0222_custody_integrity_foundation.sql:778`:

```sql
constraint custody_integrity_decisions_prev_state_chk check (previous_state = 'REVIEW_REQUIRED'),
```

**Ninguna decisión —de liberación o de cuarentena— puede existir en la base sin
venir de `REVIEW_REQUIRED`.** No hay margen de diseño: el camino feliz pasa por
revisión humana porque no hay ningún otro camino por el que una decisión pueda
registrarse.

Y coincide con lo que la máquina de estados del egreso concluyó por su cuenta,
desde el requisito textual: si con concordancia alta el caso se liberara sin
persona, quien libera es la IA.

**Para 2-C:** al cablear el certificado, la condición de `:107` no se toca. Lo
que sí hay que verificar en 2-C es que exista una transición que lleve el caso a
`REVIEW_REQUIRED` cuando el par de fotos se completa **también en el camino
feliz** — si el caso quedara en `PENDING_EVIDENCE` con concordancia alta, no
habría decisión posible y el certificado sería inemitible. Ese es el punto a
comprobar, y **no es un defecto de `certificate-policy.ts`**.

### 10.7 · Lo que 2-B NO hizo, por alcance

- Nada de 2-C: certificado, POD, historial de QR, firma de quien retira.
  `certificate-policy.ts`, `pod-pdf.ts` y `qr.ts` quedaron **byte-idénticos** a
  `acf090d1`.
- Ninguna migración fuera de `0253`. `0251` y `0252` y sus ROLLBACK, verificados
  byte-idénticos a `acf090d1`.
- El §7 visual, HN-1 y la sesión de UI siguen abiertos.
- ~~`registerEgressEvidence` y `custody_egress_gate_status` quedan **escritos y
  probados pero sin consumidor en picking/packing/despachos**~~ → **CERRADO por
  2-C-1**, ver §10.8.

### 10.8 · 2-C-1 · LA PUERTA DE EGRESO QUEDÓ OPERABLE

La costura de §10.7 está cerrada: `registerEgressEvidence` y
`custody_egress_gate_status` tienen consumidor.

**Dónde quedó la captura, exactamente.** En `/wms/despachos/[id]`,
**inmediatamente antes de `<DispatchActions>`** — el componente que contiene
`confirmDispatchAction`, que es la acción que descuenta stock reservado, lotes y
ledger. Es el momento que Dirección definió: entre el packing y el despacho, con
el bulto cerrado y el bien todavía bajo control del depósito.

| Pieza | Archivo | Qué hace |
|---|---|---|
| Datos | `src/lib/custody/dispatch-egress.ts` | resuelve pedido → unidades → estado de la puerta |
| Acción | `wms/despachos/actions.ts` · `registerDispatchEgressAction` | fuerza el par canónico, lee el NIVEL de la base y llama a `registerEgressEvidence` |
| Pantalla | `wms/despachos/_components/DispatchEgressPanel.tsx` | un input por unidad, `capture="environment"`, guard de un solo vuelo |

**El nivel 1 no ve nada, y no por una condición del componente.** El servidor
devuelve `applies: false` y la página no monta el panel: sin panel, sin aviso y
sin botón apagado. Un `if (level < 2) return null` adentro habría dejado el
componente en el árbol, que es justo lo que el bloque prohíbe.

**Por qué hizo falta una lectura administrativa, y por qué no es un atajo.**
`custody_egress_gate_status` es POR UNIDAD y la pantalla es POR PEDIDO. El puente
es `custody_allocation_physical_units`, que tiene **RLS habilitada y ninguna
política de SELECT**: con el cliente de sesión devuelve cero filas aunque el
grant exista. Las allocations salen de la SESIÓN, la lectura admin es un mapeo
cerrado sobre esas allocations, y el estado de cada unidad se pide otra vez por
SESIÓN con la RPC, que exige `wms.view` y compara el tenant. La autorización
está ahí, no en el mapeo.

**Sin migración.** La cadena de compuertas de 0253 ya muerde; no se agregó
ninguna. El lease `0254` quedó **sin usar**.

**Lo que este bloque NO hace, y hay que saberlo:** la captura desde despacho
**no dispara el análisis**. El camino del caso
(`registerPhysicalEgressAction`) sí lo hace, pero ese disparo arrastra
`OpenAICustodyVisionProvider` al grafo de despachos — la misma clase de
acoplamiento que obligó a extraer `physical-ingress.ts` en 2-A. La evaluación y
la decisión humana siguen viviendo en `/wms/custody/[id]`, que es donde trabaja
el inspector.

### 10.9 · Remediación consolidada de C4 1/2 · dos hallazgos bloqueantes

C4 1/2 cerró **FAIL con 10 hallazgos**. Se remediaron los **dos bloqueantes**.

#### F-1 · el vínculo pedido ↔ unidad

`registerDispatchEgressAction` recibía `orderId` y **sólo lo usaba para
revalidar**. Nivel, tenant y permiso se comprobaban; la PERTENENCIA no. Un
operario con permiso de captura, parado en el pedido A, podía mandar el
`entity_id` de una unidad del pedido B que seguía en picking, y la foto quedaba
adjunta a un bulto que estaba en la estantería.

**Lo que se rompía no era un permiso: era el ANCLAJE TEMPORAL de la puerta.**
`has_egress_photo` es la única condición de `0253` que el operario resuelve por
sí mismo, y una vez satisfecha lo queda para siempre. Con la foto tomada fuera de
la ventana que Dirección definió —bulto cerrado, bien todavía bajo control del
depósito— la compuerta sigue abriéndose pero ya no acredita el momento que tenía
que acreditar.

**Dónde quedó la validación, y por qué ahí:** en el **servidor**, en la acción,
antes de leer el nivel y antes de tocar Storage. El componente sólo ofrece las
unidades correctas, pero la acción es alcanzable sin él. Y resuelve
pedido→unidades con `resolveDispatchOrderUnits` —extraído de
`getDispatchEgressGate`—, que es **el mismo camino que usa el panel**: dos formas
de contestar esa pregunta divergen, y entonces la validación deja de describir lo
que la pantalla ofrece.

| Capa | Qué agrega |
|---|---|
| `dispatch-egress.ts` | `resolveDispatchOrderUnits(orderId)` — el ÚNICO camino pedido→unidades. Devuelve `null` (no lista vacía) cuando no hay genealogía, para que quien llama distinga «pedido sin custodia» de «unidad ajena» |
| `despachos/actions.ts` | la guarda de pertenencia, primera comprobación de la acción |

La contención triple que el C4 elogió **no cambió**: allocations por SESIÓN,
puente admin CERRADO sobre esas allocations, identidad por SESIÓN. El resolvedor
las reproduce en el mismo orden.

#### F-3 · los dobles descartaban argumentos

`dispatch-egress-gate.test.ts` hacía `for (const m of [...]) api[m] = () => api`:
`select`, `eq`, `in` y `order` ignoraban lo que recibían, y `rpc` no aceptaba
parámetros. **Borrar `.in("allocation_id", allocationIds)` —el acotamiento del
`service_role` que Dirección aprobó— dejaba pasar los seis tests idénticos.**

Ahora `eq` e `in` registran su predicado y `then` resuelve las filas filtradas; y
`rpc` responde POR `p_physical_unit_id`. **Y las fixtures traen filas ajenas a
propósito** —un pedido, una allocation y una unidad de otro despacho—: sin ellas
el doble podría respetar los argumentos y los mutantes seguirían vivos, porque no
habría nada que los filtros tuvieran que excluir. Los datos son la mitad de la
prueba.

Cinco mutantes, cinco muertos. Ver el informe de la sesión.

#### Lo que esta ventana NO tocó

F-2 (el arnés que no corre en CI) y los siete no bloqueantes quedan abiertos por
decisión de Dirección. `certificate-policy.ts`, `pod-pdf.ts`,
`PodPdfDocument.tsx` y `qr.ts` byte-idénticos. **Ninguna migración: el lease
`0254` sigue sin usar.**

#### 🔴 Rojo preexistente, encontrado al correr el arnés a mano

`tests/wms-ui/presentation.test.ts:348` espera
`blockerLabel("XX") === "Requisito de liberación no cumplido"` y hoy devuelve
`"XX"`.

**Es de 2-B y está en `main`.** Lo introdujo el rewire de `blockerLabel` para que
su respaldo delegue en `guidance()` (§10 · S2-6): `guidance` pasa de largo lo que
no tiene forma de código, y `CODE_SHAPE = /^[A-Z][A-Z0-9_]{2,}$/` exige tres
caracteres, así que `"XX"` vuelve sin traducir. Los tres archivos involucrados son
**byte-idénticos a `origin/main`**, y viajó invisible porque CI no ejecuta
`vitest.wms-ui.config.ts` — que es exactamente F-2.

No se remedió acá: está fuera de los dos hallazgos de esta ventana, vive en la
superficie que 2-B ya cerró, y decidir si corrige el test o el umbral de
`CODE_SHAPE` es una decisión de alcance. **Queda para Dirección.**

---


## 11 · BLOQUE 2-C-2 · EL CIERRE PROBATORIO

### 11.1 · Las costuras que cambiaron de estado

| # | Dato / capacidad | Antes | Ahora | Ancla |
|---|---|---|---|---|
| 7 | Certificado de liberación | **CORTADO EN lectura** · «cero lecturas, SELECT concedido sin consumidor» | **CABLEADO** | política de tenant en `0254`; consumidor en `certificate-emission.ts`; acción `loadCustodyDocumentAction`; pantalla `CaseDocumentCard` |
| — | Disparo del análisis desde despachos | **NO EXISTE** · la foto de egreso no arrancaba nada | **CABLEADO** | `analysis-trigger.ts`, llamado desde `despachos/actions.ts` |

**Recuento tras 2-C-2:** 25 filas · **CABLEADO 21** · **CORTADO 1** ·
**NO EXISTE 2** · **NO VIAJA por diseño 1**. La única fila que sigue CORTADA es
la 11b (POD de unidad física); las dos NO EXISTE son la 12 (firma de quien
retira, que sí existe para el despacho) y la 13/HN-1.

### 11.2 · Por qué hizo falta la migración `0254`

`custody_release_certificates` existe desde 0250a, la fila **se inserta sola** al
liberar (`0251:257`) y el `grant select ... to authenticated` está puesto. Aun
así ninguna sesión podía leer una sola fila: la tabla tiene
`enable row level security` y **ninguna política de `select`**. RLS sin política
deniega todo, y el `grant` queda por encima de una puerta cerrada.

Ése era el corte de la fila 7, y no se podía resolver en la aplicación: **el
consumidor no existía porque no podía existir.**

Se resolvió con **política de tenant** y no con lectura `service_role` —como sí
correspondió en 2-C-1 para el puente de genealogía— porque el certificado es el
**documento del cliente**: sacar la autorización de la base y ponerla en el
código, justo en el artefacto cuyo valor es probatorio, sería el error. El
criterio se copió de `custody_physical_units_read` (`0250a:68-73`).

**R-19 · la política está MEDIDA**, no sólo leída: `t-c7-04-certificado-legible`
la ejercita con `set role authenticated` —sin eso RLS no aplica y el test no
mide nada— en sus dos lados, y sin la migración el rol operativo y el cliente
dueño leen CERO.

### 11.3 · Cómo se extrajo el disparo sin arrastrar el proveedor

| Módulo | Peso | Qué hace |
|---|---|---|
| `analysis-trigger.ts` | **liviano** | par completo + caso abierto; resuelve lo pesado por `import()` **dinámico** |
| `vision-evaluation-composition.ts` | pesado | **el único** lugar que instancia `OpenAICustodyVisionProvider` |
| `vision-mime.ts` | puro | el sniffer de formato, extraído — ver abajo |

Lo que la extracción garantiza, con precisión y sin prometer de más: el grafo
**estático** del camino de egreso no contiene `openai-vision-provider` ni
`productive-vision-evaluation`. **No** vuelve inalcanzable al proveedor en
ejecución, ni debe: el objetivo del bloque es que el análisis corra.

**D-3 · la superficie de disparo SE AMPLIÓ, y está aprobado.** Antes el análisis
se disparaba sólo desde el camino del caso; ahora también desde la captura de
egreso en despachos, que exige `CUSTODY_CAPTURE_PERMISSION` (`wms.edit`,
`case-presentation.ts:423`) y **no** `CUSTODY_DECISION_PERMISSION`
(`wms.custody.decide`). El operario que saca la foto ya no necesita el permiso de
DECIDIR para que su caso se analice.

Dirección lo asentó así: «La ampliación de quién dispara el análisis es decisión
de Dirección al servicio de D-2, con techo de gasto por caso conservado.»

**El techo por caso se VERIFICÓ, no se supuso:**

| Control | Dónde vive | Estado |
|---|---|---|
| permiso para abrir la evaluación | `begin_custody_integrity_evaluation_v2` exige `assert_custody_access('wms.edit')` (`0250a`) | **ya era `wms.edit`** — la base admitía este disparo antes que la aplicación |
| lease exclusivo | 0232 · `status='pending' for update` ⇒ `in_flight` + `retry_after_seconds` | intacto |
| cooldown («techo de gasto») | `0250a` ⇒ `cooldown` + espera | intacto |

Los tres corren dentro de esa función, invocada con el puerto construido sobre el
cliente de **sesión**. Duplicar la superficie de disparo no duplica las llamadas
pagas de un caso: el segundo disparo se encuentra el lease o el cooldown.

### 11.4 · 🔴 La fuga que el guard nuevo encontró · PREEXISTENTE

El master dice que «el boundary guard lo va a cazar». **Medido: no lo cazaba.**
`clients-native-only.test.ts` está enraizado en `ORIGENES`, y `wms/despachos`
**no figura** ahí: ese guard protege el maestro de clientes. La propiedad que
Dirección puso como causal de detención estaba **sin medir**.

`custody-analysis-boundary.test.ts` la mide —**y en su primera versión la medía
mal**—. C4 1/2 encontró que su parser usaba `[^;\n]`, que excluye el salto de
línea, de modo que **todo import multilínea le era invisible**: justamente el
formato que Prettier produce solo al pasar el ancho de línea. Reproducido
inyectando un import multilínea del proveedor en una de las cinco semillas, el
guard seguía devolviendo `ofensores = []`.

El parser se reemplazó por el **AST del compilador de TypeScript**, que es el
instrumento que ya usa `clients-native-only.test.ts` y que no puede equivocarse
con el formato. Y el guard tiene ahora **su propio control rojo→verde**: el
parser viejo se conserva en el archivo, usado ÚNICAMENTE por el test que
demuestra el falso negativo. Un instrumento también es código.

En su primera corrida el guard encontró dos fugas reales:

1. **`sniffCustodyVisionMime`** vivía en `productive-vision-evaluation.ts`, y
   `physical-ingress.ts` lo importaba. **Todo el que registraba evidencia
   arrastraba el proveedor**: recepciones desde 2-A, despachos desde 2-C-1. Se
   extrajo a `vision-mime.ts` —función pura de números mágicos, sin razón para
   estar ahí— y la arista desapareció para los dos.
2. **`despachos/[id]/page.tsx → CustodyShipmentSection → CustodyShipmentActions
   → custody/actions.ts`.** Es la superficie de custodia por scope `shipment`
   (§2 fila 10), y mete el proveedor en el grafo de la PÁGINA de despacho desde
   mucho antes de que existiera la puerta de egreso.

**La segunda NO se remedió acá**: es la superficie que arrastra HN-1 y su
decisión es de Dirección. Queda **fijada por test** con su cadena exacta, de modo
que no puede crecer en silencio y que quien la corrija se entere.

### 11.5 · El certificado y el POD conviven

No se reemplazan. El **POD** prueba la ENTREGA con la firma de quien recibe; el
**certificado** prueba la INTEGRIDAD de la unidad bajo custodia. Ninguno bloquea
al otro.

Y el **acta de inspección no es un error de emisión**: es el documento correcto
para un caso liberado sin alcanzar la barra probatoria —típicamente un override
humano—. La pantalla lo nombra así y enumera qué faltó, ya guiado.

**`certificate-policy.ts` no se tocó**: byte-idéntico a `origin/main`. Lo que
faltaba era un consumidor, y `:107` sigue siendo correcto porque `0222:777` lo
impone por constraint.

### 11.6 · La secuencia completa, a mano

    foto de ingreso  →  /wms/recepciones/nueva      (nivel 1 y 2)
    foto de egreso   →  /wms/despachos/[id]         (sólo nivel 2)
    el análisis      →  arranca SOLO al completarse el par
    la decisión      →  /wms/custody/[id]           (inspector)
    el documento     →  /wms/custody/[id]           (certificado o acta)

**El nivel 1 no ve nada de esto**, y sigue despachando por los dos caminos —con
foto de ingreso y sin ella— con prueba ejecutada: `T-C7-03` (a) y (b), 11/11.

---


## 12 · EL DOCUMENTO PROBATORIO RESUELVE SIEMPRE `acta_inspeccion`

**Estado declarado al cerrar 2-C-2.** El circuito de custodia está completo salvo
esto: `loadCustodyDocumentAction` **nunca** produce un certificado. Resuelve
`acta_inspeccion` para todo caso, incluido uno perfecto.

No es un defecto de 2-C-2. Son **tres capas, las tres PREEXISTENTES**, todas
fuera del diff de este bloque —verificadas contra `origin/main`—, y 2-C-2 las
expuso porque construyó el primer consumidor productivo del documento. Antes la
política existía y no la llamaba nadie, así que ninguna de las tres se
manifestaba.

### 12.1 · Las tres capas

| # | Dónde | Qué hace | Bloqueo |
|---|---|---|---|
| **1ª** | `integrity-adapters.ts:443` (`origin/main`) · `mapDecision` | devuelve `inspectionEvidenceIds: []` fijo: la lectura nunca carga el conjunto que la decisión declaró | `NO_INSPECTION_EVIDENCE` |
| **2ª** | `integrity-adapters.ts:357` (`origin/main`) · `mapChain` | fija `verifiedEventIds: []`, y `certificate-policy.ts:83-86` cruza los eventos de la evidencia comparada contra ese conjunto | `EVIDENCE_NOT_LINKED` |
| **3ª** | `0250a:2030` · `is_custody_inspection_evidence_v2` | exige `ev.chain_seq > eval_ev.chain_seq`, y `decide_custody_integrity_v2` (`0251:248`) mueve `chain_head` a la punta viva AL DECIDIR: después no hay eventos posteriores a la punta | `INSPECTION_SET_NOT_CANONICAL` |

Sobre la 2ª: **el dominio sí sabe calcularlo** — `chain.ts:137` hace
`verifiedEventIds: [...covered]`. Lo que falta es que la lectura del caso lo
recupere.

Sobre la 3ª: la cota es **preexistente** —`0250a` es byte-idéntica a `main`—. Una
remediación previa la usó como fuente canónica sin medirla, dando por hecho que
sobrevivía a la decisión. **No sobrevive**: el canónico devuelve vacío siempre,
después de decidir.

### 12.2 · ⚠ LEVANTAR UNA CAPA NO DESTRABA EL CERTIFICADO

Es lo que hay que saber antes de planificar. Las tres son independientes y las
tres bloquean por su cuenta: resolver la 1ª deja la 2ª, resolver la 2ª deja la
3ª, y la 3ª no se resuelve leyendo mejor sino decidiendo qué significa
«canónico» después de una decisión que movió la punta de la cadena.

**Se resuelven en un expediente ÚNICO**, y ese expediente arranca por una
decisión de diseño —**R-21**—, no por código:

> ¿La canonicidad del conjunto de inspección se valida **en el momento de
> decidir**, o se **persiste un testigo** que permita revalidarla al emitir?

Cualquier intento de destrabar capa por capa produce trabajo que la siguiente
capa invalida. Ya pasó una vez.

### 12.3 · Es FAIL-CLOSED, y por eso no fue urgente

El sistema emite **acta donde correspondía certificado, nunca al revés**. No hay
riesgo de un documento falso: hay una función que no llega. La mercadería se
despacha, la puerta de egreso muerde, el POD se emite y la cadena queda íntegra;
lo que no llega es la pieza que da valor comercial al servicio de custodia
reforzada.

Por eso se publica declarado y no se corrige acá: corregirlo bien es un
expediente, y corregirlo mal —capa por capa— es peor que declararlo.

---

## 13 · BLOQUE B-1 · HN-1 · SE CIERRA EL CAÑO POR LOS DOS EXTREMOS

### 13.1 · La medición de producción que sostiene la decisión

Antes de escribir una sola línea se midió la base productiva. Los cinco hechos:

| Qué se midió | Resultado |
|---|---|
| Casos de custodia existentes | **4 · los CUATRO con `physical_unit_id`** |
| Casos con `packing_unit_id` o `shipment_id` | **CERO** |
| `upsert_custody_integrity_assessment` · ACL | `postgres=X` · `service_role=X` · **`authenticated=X`** — vivo |
| Llamadores en `src/` | **CERO** |
| Llamadores SQL internos (`pg_proc.prosrc` en producción) | **CERO** |

Y el circuito productivo —`0250a:430`, `0252:228`— inserta **siempre**
`physical_unit_id`, por el trigger de recepción: no hay hoy camino productivo
que fabrique un caso no físico.

De modo que lo que había no era una costura rota con un consumidor esperando del
otro lado. Era una **RPC de escritura alcanzable por PostgREST desde cualquier
sesión autenticada, sin ningún consumidor, capaz de crear casos que la pantalla
después no puede decidir.** Un privilegio vivo sin camino que lo justifique.
**R-22: se retira sin esperar a que se demuestre el camino.**

### 13.2 · Extremo de adelante · la aplicación deja de enrutar a la v1

`integrity-supabase.ts` tenía el ternario que §9.3(b) señaló:

```ts
const fn = input.scope === "physical_unit"
  ? "decide_custody_integrity_v2"
  : "decide_custody_integrity";
```

No elegía entre dos caminos. Elegía entre un camino y un **`42501` crudo de
PostgreSQL subiendo a la cara del inspector**, porque la v1 está revocada desde
`0250a:2199-2200`. La rama muerta se eliminó. Un scope no físico —y también un
scope **ausente**, que cae fail-closed— produce ahora un rechazo tipado del
dominio **antes de tocar la plataforma**:

`CustodyContractError` → `SCOPE_NOT_DECIDABLE` (nuevo miembro de `CasFailure`) →
«Este caso no es de una unidad física: no se decide desde esta pantalla».

El rechazo **no pasa por `classifyDecideFailure`**: ese clasificador adivina por
texto del mensaje y habría devuelto `RECORD_INCOHERENT`, que es mentirle al
inspector. Se distingue por tipo, con `instanceof`, en el `catch` de
`applyDecision`.

**`custody_inspection_candidates` no se tocó.** Su ternario —que era
`integrity-supabase.ts:302-304` antes de este bloque y quedó en `:319-321` por
el corrimiento del docblock nuevo— está **byte por byte igual**: `0224:313` la
mantiene concedida a `authenticated` y esa superficie **no está rota** —medido
de nuevo en producción en esta sesión—.

### 13.3 · Extremo de atrás · la migración `0257`

`0257_custody_legacy_creator_revoke.sql` retira `EXECUTE` a `authenticated`
sobre `upsert_custody_integrity_assessment`, con su `ROLLBACK_0257`, su entrada
de linaje (catálogo 245 → 247, ejecutables 217 → 218) y su lugar en el
manifiesto dedicado (50 → 51).

**Por qué se revoca y no se elimina la función.** `0223` sí eliminó
`record_custody_integrity_evaluation`, y con razón. Acá el caso es distinto:
esta función es todavía el ingreso legítimo del circuito no físico **bajo el
dueño del esquema**, y sobre ella se apoya la batería `tests/custody-db/**` que
sostiene la cobertura D1–D3 de `0221`–`0224`. Eliminarla borraría esa cobertura
sin haber decidido nada sobre el circuito no físico, que no es lo que este
bloque vino a resolver. Lo que se retira es la **alcanzabilidad desde una sesión
de usuario**, que es exactamente el privilegio sin camino.

`service_role` conserva `EXECUTE` **a propósito**: es el rol interno de
servidor, no una sesión de navegador, y el master acota la revocación a
`authenticated`. Ampliarla de paso habría sido decidir por cuenta propia.

### 13.4 · La prueba · R-19, y por el lado POSITIVO

Una revocación no entra con un contador que sube. `T-C7-05` la **ejercita**:
llama la RPC con `set role authenticated` —el rol de base de datos con el que
PostgREST atiende al navegador— y exige `permission denied`. Un test que sólo
leyera `pg_proc.proacl` mediría el catálogo, no el privilegio.

Las dos mitades, ambas verificadas con mutante:

- **la revocación:** con el `grant` reinstalado en `0257`, `T-C7-05` cae en rojo
  en la llamada real y en la lectura de ACL;
- **el ruteo:** con el ternario restaurado en `integrity-supabase.ts`, 7 de los 8
  casos de `custody-hn1-scope-routing` caen en rojo.

Y lo que debía seguir funcionando se afirma explícitamente, para que una
ampliación de alcance por descuido tampoco pase en silencio: `service_role`
conserva `EXECUTE`; la función **sigue existiendo** y sigue construyendo casos
bajo el dueño del esquema; `authenticated` conserva `EXECUTE` sobre
`decide_custody_integrity_v2` y sobre `custody_inspection_candidates`; y la v1
sigue revocada, porque `0257` **no la reconcedió**.

### 13.5 · Recuento

**Recuento tras HN-1:** 25 filas · **CABLEADO 21** · **CORTADO 1** ·
**NO EXISTE 2** · **NO VIAJA por diseño 1**.

Los números no se mueven respecto de 2-C-2, y decirlo así es más honesto que
fabricar un cambio: la fila 13 ya se contaba entre las dos **NO EXISTE**. Lo que
cambia es **qué significa** cada una de esas dos:

- la **12** (firma de quien retira) sigue siendo un hueco abierto, con trabajo
  pendiente —bloque B-2—;
- la **13** ya no es un hueco. Es una capacidad **que no existe a propósito**,
  cerrada por los dos extremos y con prueba que lo sostiene.

La única fila que sigue **CORTADA** es la **11b** (POD de unidad física).

> **Nota de concurrencia.** Este bloque tocó únicamente su propia fila (13), sus
> propias secciones (§6/HN-1, §9.3, §13) y este recuento. Las filas 11b y 12 son
> del bloque B-2 y no se tocaron. El recuento definitivo del expediente lo
> recalcula el bloque D (C-3) como su primera medición.

### 13.6 · Lo que este bloque NO hizo

- **No** re-otorgó `decide_custody_integrity` (v1) a ningún rol.
- **No** tocó `decide_custody_integrity_v2` ni su cuerpo.
- **No** escribió una v3 ni un cuerpo genérico por scope.
- **No** tocó `custody_inspection_candidates` ni su grant.
- **No** aplicó `0257` a producción, ni `supabase db push`, ni merge, ni deploy.
- **No** usó números de migración fuera del lease `0257`.

### 13.7 · 🟠 MEDIUM ABIERTO · HN-1 vive en la PUERTA, no en el MODELO

La C4 lo encontró y Dirección resolvió **no tocarlo en esta ventana**, porque
toca comportamiento y este bloque estaba acotado a dos piezas. Queda acá con su
propio bloque para que no se entierre.

`integrity/in-memory-repository.ts:152` —el repositorio de referencia del
dominio— **no** tiene rama de scope: sigue aceptando una decisión sobre un caso
`packing_unit` y devolviendo `{ ok: true }`. Y la suite de dominio
`wms-custody-ia-integrity.test.ts:90` sigue fijando `scope: "packing_unit"` como
operación válida y exitosa.

Es decir: **HN-1 quedó codificado en la frontera del adaptador, no en el
modelo.** Las dos implementaciones del mismo puerto discrepan sobre una regla de
dominio.

**No es un fallo de producción** —el camino real pasa siempre por
`createSupabaseCustodyQueryPort`, y ahí la puerta está cerrada—. El daño es de
otra clase y es el que importa en un módulo probatorio: **quien lea el dominio o
sus pruebas concluirá lo contrario de lo que HN-1 decidió.** Un revisor futuro
que audite `in-memory-repository` para entender qué se puede decidir va a leer
que un caso no físico se decide, y no es cierto.

**Severidad: MEDIUM.** No bloquea el cierre de B-1 —la puerta real está
cerrada y probada— pero exige su propia ventana: mover el repositorio en memoria
significa mover también su batería, y eso es cambio de comportamiento con su
propio gate.

---

## 14 · §7 VISUAL · LA EXPERIENCIA DE USUARIO · IMPLEMENTADO

### 14.1 · 🔴 DÓNDE VIVE LA ESPECIFICACIÓN — el puntero que faltaba

```
~/Desktop/Custodia Digital Nexus/
    UI-1.png · UI-2.png · UI-3.png · UI-4.png · UI-5.png · UI-6.png
    UI-MOBILE1.png · UI-MOBILE2.png
```

**Ocho capturas, tomadas por Dirección, que SON la especificación.** Este
puntero es la razón de ser de esta sección: el §7 quedó registrado como
pendiente en §9.4 pero **sin decir dónde estaba especificado**, y por eso las
sesiones siguientes no supieron que existía. Que no se pierda otra vez.

| Captura | Qué cubre |
|---|---|
| UI-6 | portada + leyenda de colores + **Estado 1** · falta foto de ingreso |
| UI-5 | **Estado 2** · falta foto de egreso |
| UI-4 | **Estado 3** · concordancia alta, decisión habilitada |
| UI-2 / UI-3 | **Estado 4** · retenido, concordancia baja |
| UI-1 | **Estado 5** · liberado, documento y POD |
| UI-MOBILE2 | estados 1, 2 y 3 en teléfono |
| UI-MOBILE1 | estados 4 y 5 en teléfono |

### 14.2 · Lo que se implementó

| Pieza | Dónde |
|---|---|
| Barra de cinco pasos | `case-progress.ts` · `deriveCaseProgress` → `CaseProgressBar.tsx` |
| Bloque `▸ AHORA`, una sola acción viva | `deriveNowAction` → `CaseNowBlock.tsx` |
| Comparación visual lado a lado · **la DISPOSICIÓN, no el binario** | `CaseEvidencePanel.tsx` · ver §14.6 |
| Checklist «para poder decidir» | `deriveDecisionChecklist` → `CaseChecklist.tsx` |
| Reordenamiento mobile-first | `[id]/page.tsx` · una columna que se abre en `lg` |
| Nombre del operario en la evidencia | `custody.ts` · `resolveActorNames` |

**Regla del bloque, firmada por Dirección:** *las capturas mandan sobre la lista
de cuatro piezas del §9.4*. Esa lista se escribió desde el contrato, no desde la
especificación. Única excepción: el umbral, donde manda D-4.

### 14.3 · ⚠ D-4 · EL UMBRAL NO SALE A PANTALLA

> «El umbral de detección no viaja al cliente ni a la pantalla del operario:
>  publicar el corte enseña a operar por debajo de él.»

**No se revirtió I3: se fue más lejos que ella.** Las capturas mostraban el
umbral en varios lugares; ninguno se implementó con él. La C4 1/2 (C-2) halló
que esta tabla citaba cadenas que no existen en el código; va con las REALES:

| La captura decía | Lo que el código muestra |
|---|---|
| «similitud 94,2% ≥ umbral 90%» | el número de concordancia con «%» y el veredicto «CONCORDANCIA ALTA» |
| «BAJO UMBRAL 90%» | «CONCORDANCIA BAJA» + «inspección física obligatoria antes de poder decidir» |
| «POR DEBAJO DEL UMBRAL» | «NO CONCLUYENTE» + «las fotos no son comparables: repetí la de egreso» |
| «Análisis · 94,2% sobre umbral 90%» | «Análisis visual · concordancia» con el número solo |
| barra con marca en 90 | barra sin marca, escala 0%–100% |

El fundamento se expresa como **estándar** —«según los estándares
internacionales de medición del mercado»—, y lo que sí sale es la
**concordancia** con su número real y el veredicto cualitativo, que ya venían
resueltos server-side en `ConcordanceView`.

**La garantía es estructural y está probada.** `case-progress.ts` no puede
nombrar el umbral porque no lo recibe: `AiPanelView` no tiene
`thresholdPercent` por construcción. Y `case-progress.test.ts` recorre las
cadenas de los siete estados comprobando que ninguna dice «umbral», «90%», «por
encima» ni «por debajo».

### 14.4 · El nombre del operario · la única pieza fuera de presentación

La cadena respondía QUÉ y CUÁNDO desde 0222; **QUIÉN** no llegaba a ninguna capa.

| | |
|---|---|
| **Capa tocada** | `src/lib/custody/custody.ts` — `resolveActorNames` |
| **Superficie leída** | `profiles_public(id, full_name)` (0046) |
| **Permiso** | `grant select ... to authenticated` · vista `security definer` **sin email ni rol** |
| **Por qué no es migración** | el timeline viene de una RPC; el nombre se resuelve en la aplicación con una segunda lectura acotada |

No se lee `profiles` —que `0040` restringió a uno mismo o admin—, no se usa
`service_role`, y es el mismo patrón que ya usa el módulo comercial. Ante
cualquier error devuelve un mapa vacío: la evidencia queda sin nombre y la
pantalla no se cae.

### 14.5 · El documento muestra lo que haya

Se implementó la estructura de UI-1. **Hoy mostrará siempre ACTA**, por las tres
capas preexistentes de §12, que este bloque no toca. El día que el certificado
sea emisible, la misma pantalla lo muestra sin tocar presentación. El campo
«Base» va sin el umbral, por D-4.

### 14.6 · 🔴 LO QUE NO SE IMPLEMENTÓ, Y POR QUÉ NO ES UN OLVIDO

**El render de imagen grande lado a lado NO se hizo.** La C4 lo encontró
declarado como implementado en §9.4 y en la tabla de §14.2, y tenía razón: el
contrato afirmaba falso.

Lo que sí se hizo es la **disposición**: `CaseEvidencePanel` enfrenta los dos
recuadros en `grid-template-columns: 1fr 1fr`, con hora, operario y sha256 al
pie de cada uno. Lo que **no** se hace —y no se va a hacer así— es poner el
binario en la pantalla:

> El recuadro NO renderiza la imagen. La evidencia se abre por `EvidenceViewer`,
> que pide un signed URL de TTL corto por server action auditada. Un `<img>` con
> la ruta de Storage sería el único cambio de este bloque capaz de romper la
> garantía probatoria del módulo.

Es decir: la captura pedía una cosa que, implementada literalmente, destruye la
propiedad que el módulo entero existe para sostener. Lo que se implementó es la
**disposición**: los dos recuadros enfrentados con estado, hora, operario y
hash comparables de un vistazo. **Las imágenes mismas NO se comparan de un
vistazo**: cada una se abre por URL firmada en su pestaña, igual que antes —la
C4 1/2 (C-1) encontró que este párrafo afirmaba lo contrario, y era falso—. Si
la comparación visual en pantalla se quiere de verdad, exige resolver primero
cómo se sirve el binario sin romper la auditoría del acceso: es la misma
ventana futura del párrafo siguiente.

**Queda declarado como NO IMPLEMENTADO en §9.4.** Si Dirección quiere la imagen
embebida, es su propia ventana y necesita resolver antes cómo se sirve sin
romper la auditoría del acceso.

### 14.7 · REMEDIACIÓN C4 1/2 · LOS TRECE, POR CAUSA RAÍZ

La C4 sobre `cdebbdc` dio **FAIL con trece bloqueantes**. La fase 2 reescribió
exactamente los archivos donde caían, así que se midió cuáles seguían vivos
**antes** de escribir remediación —`git diff --stat cdebbdc 1b0d5f4` probó que
`case-progress.ts` no había sido tocado— y se remedió por causa, no por
hallazgo.

| Grupo | Estado tras la medición | Qué se hizo |
|---|---|---|
| **A** · derivar verdad de campos proxy (H-1…H-4 · M-1…M-3) | **vivos** · fase 2 no tocó `case-progress.ts` | seis instancias corregidas. Detalle abajo |
| **B** · capa visual (H-5 · M-8) | **ya resueltos por la fase 2** | no se re-remedió: se les puso guard de regresión, porque nada impedía que volvieran |
| **C** · los guards que no guardan (M-4 · M-5) | **vivos** · M-4 **agravado** por la fase 2 | extractor de clases y guard D-4 corregidos, ambos con mutante |
| **D** · el contrato afirma falso (M-6 · L-5) | **vivos** | §9.4 y §14.2 corregidos · §14.6 declara la no-implementación |
| **E** · accesibilidad (M-7 · L-4) | **vivos** | estado en texto, además del color |
| **R-25** · comentarios que el commit vuelve falsos | **vivos** | los dos corregidos en el código |

**Grupo A · las seis instancias, y por qué cada una era falsa.** ⚠ Este bloque
las presentó originalmente como «una sola causa», y Dirección lo corrigió: son
AL MENOS TRES — semántica de campos que miente (A-1 · A-4 · A-5), acoplamiento
a permiso (A-2), definición triplicada (A-3) y un hardcode (A-6). Agregarlas en
bloque habría tapado destinos distintos: la propia C4 1/2 encontró que A-2
quedó bien desacoplada del permiso mientras A-3 quedó unificada sobre una
definición falsa (ver §14.9).

| | Qué leía mal | Qué producía |
|---|---|---|
| A-1 | `reevaluation.analysis !== "stale"` como «cadena verificada» | `"never"` tampoco es `"stale"`: un caso **sin ningún análisis** mostraba la tilde de verificado. El docblock de `AnalysisFreshness` advierte literalmente contra esto |
| A-2 | `inspection.eligible` como «hay foto de inspección» | se calcula tras un guard de `wms.custody.decide`; el operario captura con `wms.edit` y **no** lo tiene, así que valía 0 SIEMPRE → **bucle infinito**: registrá la inspección, y te la vuelve a pedir |
| A-3 | tres definiciones distintas de «exige inspección» | la barra, el checklist y `▸ AHORA` podían contradecirse en la misma pantalla |
| A-4 | `ai.executed !== true` como «está corriendo» | `executed` sólo es `true` con `outcome === "ok"`, y hay **cuatro** outcomes de fallo → **segundo bucle**: un análisis caído anunciaba estar corriendo para siempre |
| A-5 | `NO_CONCLUYENTE` sin manejar | caía al default «la comparación no encontró diferencias» — falso: no llegó a comparar |
| A-6 | `actionable: true` fijo en la inspección | botón vivo para quien no puede usarlo |

La señal verdadera de A-2 —si el timeline tiene el evento `inspeccion_humana`—
ya estaba resuelta en la página y no se pasaba. Ahora entra por `tieneInspeccion`.

**Todo se verificó con mutante, en los dos sentidos.** Nueve de los tests nuevos
del grupo A caen en rojo contra el código anterior; el extractor de clases
corregido caza una clase inventada en `className={variable}` que el anterior
dejaba pasar **en verde**; el guard D-4 caza «90 %» con espacio, que era
exactamente la evasión que M-5 denunciaba.

**Radio de alcance del guard de clases: medido y nulo.** Corregir el extractor
podía encender violaciones en módulos ajenos —era el riesgo declarado—. Se midió:
es el **único** guard del repositorio que usa ese extractor, y tras corregir dos
falsos positivos propios (una cadena COMPARADA no es una clase; un valor por
defecto tampoco) **no enciende ninguna violación real**. No hubo que tocar nada
fuera del §7.

### 14.8 · 🟠 RESIDUO DE B-1 · CINCO ROJOS QUE NO SON DE ESTE BLOQUE

Medido en tres puntos con `vitest.wms-ui.config.ts`:

| Punto | Rojos |
|---|---|
| `fe5c92f` · antes de HN-1 | **1** — `blockerLabel`, el preexistente de `aa8d288` |
| `origin/main` `0fcab54` · tras PR #82 | **6** |
| este candidato, ya mergeado | **6** — el mismo conjunto |

**El candidato aporta cero.** Los cinco nuevos los introdujo **HN-1**: sus
fixtures en `inspection-derivation.test.ts` y `server-actions.test.ts` no
declaran `scope`, y el fail-closed `SCOPE_NOT_DECIDABLE` que B-1 instaló los
rechaza ahora antes de llegar a la RPC. Los tests codifican el comportamiento
**anterior** a HN-1.

No se vieron al mergear porque **el CI no corre este config**. No se parchean
acá: decidir qué debían afirmar esos tests después de HN-1 es del bloque que
tomó la decisión, no de éste. Queda declarado para su propia ventana.

### 14.9 · C4 1/2: FAIL · Y LA REMEDIACIÓN 2/2, POR AUTORIDAD

La C4 1/2 sobre el candidato consolidado dio **FAIL** con dos bloqueantes. Su
informe completo está **archivado como comentario en la PR #83** — la fuente
primaria de la C4 anterior nunca se archivó y se perdió; ésta no. La C4 declaró
emitirse contra una paráfrasis de tercer orden de los trece originales.

**R-1 · HIGH · la definición unificada de «exige inspección» era falsa contra
la autoridad.** La primera remediación unificó las tres definiciones (A-3) en
«HOLD ‖ BAJA» — la forma correcta sobre el contenido equivocado. Verificado en
las dos capas: `release-policy.ts:132-135` agrega `NO_HUMAN_INSPECTION_EVIDENCE`
de forma INCONDICIONAL, y la RPC viva (`0251:214-215`) levanta «inspección
humana obligatoria» después del if/else de basis — alcanza a las dos ramas.
**Toda liberación exige la foto de inspección humana**, y no contradice la
Adenda: la cumple (si la concordancia alta liberara sola, la IA decidiría). En
el camino más común —ALTA sin foto— el checklist decía 4/4 «Hecho» y ▸AHORA
decía «decidí»; el servidor rechazaba. Y los tests propios FIJABAN ese error.

Qué cambió: el paso 4 se llama «Inspección física y decisión» sin condicional;
el checklist SIEMPRE lista la inspección (el camino ALTA sin foto muestra el
quinto ítem PENDIENTE); ▸AHORA la pide con lenguaje por veredicto —la redacción
de Dirección para BAJA, una de conformidad para el resto—; el `requirement` de
ALTA en `case-presentation.ts` dejó de decir «no requiere inspección
adicional». Los tests-candado se CORRIGIERON, y el mutante exigido por R-26
corre CONTRA LA AUTORIDAD: revertido a «HOLD ‖ BAJA», 7 tests caen en rojo.

**R-2 · HIGH · la corrección del bucle A-2 no tenía prueba de compuerta
(R-19).** Entraron tres pruebas por la acción REAL (`loadCustodyCaseAction`):
con `wms.custody.decide` la RPC de candidatas se llama y `eligible` la refleja;
sin él, `eligible` es 0 y la RPC NI SE LLAMA; y la EXIGENCIA de pantalla
(kind/label/help/checklist) es idéntica con y sin permiso — la viveza del botón
difiere, y debe. Dos mutantes verificados: sin el guard de permiso, 2 rojos;
con la pantalla releyendo `eligible`, 1 rojo. Registro honesto: la primera
versión de la tercera prueba pasaba por VACUIDAD —la fixture caía en
NO_CONCLUYENTE y nunca pisaba la rama custodiada—; la descubrió el propio
mutante y se endureció con kinds esperados explícitos y precondición.

**Los MEDIUM/LOW, en esta misma ventana:** R-3 (la señal de inspección del
timeline exige ahora foto NO redactada posterior estricta al ÚLTIMO egreso, por
índice de cadena; divergencia residual declarada: el consumo por decisión
previa no es visible desde el timeline) · R-4 (los guards D-4 cubren el valor
crudo —«noventa», «0,9», «piso/mínimo»— con las seis evasiones demostradas como
control, y el guard de marcado DECLARA su límite con el «90» a secas en vez de
sobreafirmar) · R-5 (el extractor de clases resuelve funciones locales,
`className =` con espacios y un salto de alias; mutante cuádruple: 4/4 cazadas;
el docblock enumera lo cubierto Y lo invisible) · R-6 (la frase «estándares
internacionales de medición» es redacción de Dirección aprobada bajo D-4; el
docblock de `CaseAiPanel` dejó de contradecirla) · R-7 («está corriendo» sólo
con reserva viva; sin ella se ofrece la re-evaluación) · F2-1 (la muestra ya no
exhibe el chip ANMAT ni recepción hardcodeada; sus estados son producibles por
el servidor, con el estado 3 desdoblado en 3a —falta inspección— y 3b
—registrada—) · F2-2 (el CTA de ▸AHORA es un ancla real al panel de la acción;
muerto, es un `<span>` declarado) · F2-3 (el config dice la verdad sobre sus
pruebas de render) · F2-4 (fuera el corte `< 80` de UI que ninguna política
define) · C-1, C-2 y C-4 corregidos arriba, en sus propias secciones.

**C-3 fue RETIRADO por Dirección:** R-25 manda corregir el comentario
falsificado en el MISMO commit; el segundo-commit-con-compuerta es la excepción
para candidatos ya aprobados, y `dac1459` estaba en construcción.

**Gates de esta remediación, POR CONFIG** — «suite global» no se escribe más:
`vitest.config.ts` (el que corre el CI) · `vitest.wms-ui.config.ts` (el CI NO
lo corre; quedan los 6 rojos preexistentes de `origin/main`, §14.8) ·
`typecheck` · `lint` · `lint:boundaries` · `lint:udie-boundary`. Los números de
la corrida final están en el mensaje del commit de esta remediación.

---

## 8 · LO QUE LA SESIÓN 0 NO HIZO (histórico)

- Cero cambios en `src/`, `supabase/` o `tests/`.
- Ninguna migración creada; `supabase/lineage/catalog.json` intacto.
- Ninguna conexión a Supabase, producción ni sistema externo.
- `Custodia-Digital-Desktop.html` y `Custodia-Digital-Mobile.html` no se abrieron.
- Ningún defecto remediado. Los catorce cortes y las dos ausencias quedan vivos y
  documentados.
