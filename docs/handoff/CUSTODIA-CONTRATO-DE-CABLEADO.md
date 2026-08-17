# CUSTODIA DIGITAL · CONTRATO DE CABLEADO

**Expediente:** CUSTODIA-CIERRE-CIRCUITO · 16-08-2026
**Última actualización:** **Bloque 2-A · remediación 2** — la cobertura se
controla ANTES de la salida temprana; fail-closed restituido (§9.6.1)
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

**Toda referencia `archivo:línea` de este documento está tomada de ese HEAD.**

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
| 2b | `public_id` del caso (CINT-) · **listado** | idem | `custody.ts:1048` lo selecciona | `custody.ts:1054` lo mapea | `CustodyIntegrityCaseRow` | listado `wms/custody/page.tsx:30` | `wms.view` | **CABLEADO** |
| 2c | `public_id` de la unidad (CPU-) | `custody_physical_units.public_id` `0250a:24` | `CASE_COLUMNS` embebe `custody_physical_units(...)` | `mapCaseIdentity` | `identity.unitPublicId` | chip `data-cpu` en el encabezado | `wms.view` + RLS `custody_physical_units_read` `0250a:68-73` | **CABLEADO** |
| 2d | SKU, cantidad, lote, vencimiento | `custody_physical_units.sku / quantity / lot_number / expiration_date` `0250a:30-33` | `CASE_COLUMNS` | `mapCaseIdentity` | `identity.sku / quantity / lotNumber` | línea del bien en el encabezado | `wms.view` | **CABLEADO** |
| 2e | Recepción de origen + enlace | `custody_physical_units.reception_id` `0250a:26` → `receptions(public_id)` | `CASE_COLUMNS` (embed anidado) | `mapCaseIdentity` | `identity.receptionPublicId / receptionId` | enlace `data-recepcion` en el encabezado | `wms.view` + RLS de `receptions` | **CABLEADO** |
| 3 | `similarityScore`, `thresholdResult`, `scoreComponents` | `0250a` · columnas del caso; `score_components` escrito en `integrity-supabase.ts:390-395` | `integrity-supabase.ts:65-67` | `integrity-adapters.ts:304-317` | `similarityScore` + `concordance` derivado (`deriveConcordance`) | `CaseAiPanel.tsx` · número de concordancia, veredicto cualitativo, barra SIN marca de umbral y los cuatro componentes | informativo, sin permiso propio | **CABLEADO** |
| 4 | `thresholdPercent` | `custody_integrity_cases.threshold_percent` · criterio en `0250a:2114-2116` | se sigue leyendo | `integrity-adapters.ts` → `IntegrityAssessment` | **NO EXISTE en `AiPanelView`**: se consume para derivar `concordance` y no viaja | nada que renderizar, por construcción | — | **NO VIAJA · CONFORME (I3)** |
| 5a | `damageFlags` (embalaje / faltante / daño) | `packaging_changed`, `missing_items_suspected`, `damage_suspected` | `CASE_COLUMNS` | `integrity-adapters.ts` | `ai.damageFlags` | chips `data-banderas` en `CaseAiPanel` | — | **CABLEADO** |
| 5b | `provider_details` (observations, zones) | escrito en `integrity-supabase.ts:406-410` (`p_provider_details`) | `CASE_COLUMNS` ahora **sí** pide `provider_details` | `boundedStrings` en `mapAssessment` (recorta a 6 × 240/120) | `ai.observations` / `ai.zones` | bloque «Observaciones del análisis» en `CaseAiPanel` | — | **CABLEADO** |
| 6a | `quarantine.blockers` | `0250a:2088-2099` (las reglas que producen el bloqueo) | — | — | `case-presentation.ts` · habilitado también en `HOLD` (S1-5) | `CaseDecisionPanel` · bloque «Por qué no se puede enviar a cuarentena» (`data-cuarentena-blockers`) | `wms.custody.decide` + rol `admin`/`operaciones`/`supervisor` (0251) | **CABLEADO** |
| 6b | `release.blockers` | `0250a:2108-2150` | — | — | `case-presentation.ts:325-377`, expuesto en `:438-443` | `CaseDecisionPanel.tsx:172-179` · encabezado «Por qué no se puede liberar» | `wms.custody.decide` + rol `admin` | **CABLEADO** |
| 7 | Certificado de liberación | tabla `custody_release_certificates` `0250a:1742-1794` · insertado en `0250a:2182-2186` · validador `custody_assert_release_certificate` `0250a:1796` · `grant select ... to authenticated` `0250a:1786` | **cero lecturas** · `grep -rn "custody_release_certificates" src/` → 0 resultados | — | — | — | SELECT concedido a `authenticated`, sin consumidor | **CORTADO EN lectura** |
| 8 | Códigos de gate de despacho (los seis `CUSTODY_*`) | `CUSTODY_CASE_MISSING` `0250a:2304` · `CUSTODY_HOLD` `0250a:2307` · `CUSTODY_RELEASE_CERTIFICATE_MISSING` `0250a:2312` · `CUSTODY_CHAIN_ADVANCED_AFTER_RELEASE` `0250a:2316` · `CUSTODY_GENEALOGY_MISSING` `0250a:2361` · `CUSTODY_ZERO_APPLICABLE_CASES` `0250a:2401` | **ningún traductor** · `grep -rn "CUSTODY_HOLD\|CUSTODY_GENEALOGY_MISSING\|..." src/` → 0 resultados | — | — | el error crudo de PostgreSQL sube tal cual al despachante | — | **CORTADO EN lectura** |
| 9 | Puente recepción → caso de custodia | mismo trigger, con `custody_materialize_reception_item_row` **condicional** (0252 §5): la unidad siempre, el caso sólo en nivel 2 | `custody_reception_units` (0252 §8) | — | `ReceptionCustodyUnit` en `recepciones/actions.ts` | lista posterior a confirmar, con enlace a cada caso | la función sigue revocada para todos los roles: corre **sólo** como trigger | **CABLEADO** |
| 15 | Nivel de custodia contratado (D3) | `clients.custody_level` (default 1) · `receptions.custody_reforzada` (eleva, nunca degrada) · `custody_physical_units.custody_level` (default 2: preserva lo ya materializado) · 0252 §1-§4 | `custody_client_level` (SECURITY DEFINER, exige `wms.view`) — `clients` pide `clientes.view` por RLS y un encargado de depósito no lo tiene | — | estado local del formulario | casilla «esta mercadería ingresa por custodia digital reforzada» · `data-custodia="reforzada"` | `wms.view` para leer el nivel | **CABLEADO** |
| 16 | Foto de ingreso tomada en la RECEPCIÓN (I4) | `attach_custody_physical_evidence`, ahora también para nivel 1 (0252 §7b) | `attachPhysicalEvidence` en `src/lib/custody/physical-ingress.ts` | — | `createConfirmAndCaptureAction` | input por ítem con `capture="environment"` en `NewReceptionForm` · `data-foto-ingreso` | `wms.edit` | **CABLEADO** |
| 17 | Señal de custodia en el listado de recepciones | `custody_physical_units` + `custody_events` | embed en `listReceptions` | — | `ReceptionRow.custody_units / custody_units_con_foto / custody_reforzada` | insignia `data-custodia="unidades"` en `recepciones/page.tsx` | `wms.view` | **CABLEADO** |
| 10 | Puerta de la foto de egreso en el flujo de salida | gates disparados por trigger en `0250a:2417 / 2486 / 2507 / 2529` | — | — | — | **cero menciones de custodia** en picking y packing (`grep -rniE "custod\|CPU-\|physical_unit"` sobre `wms/picking` y `wms/packing` → 0 resultados); en despachos sólo `CustodyShipmentSection` (`despachos/[id]/page.tsx:172-175`), que es scope `shipment` | — | **NO EXISTE** |
| 11a | Resolución del token del QR | `get_custody_physical_by_token` `0250a:2253-2289` · `revoke ... from public,anon` `:2291` · `grant ... to authenticated` `:2292` | `getCustodyByToken` (`custody.ts`), consumido en `c/[token]/page.tsx:18` | — | — | `c/[token]/page.tsx:41-84` | `assert_custody_access('wms.view')` `0250a:2261` | **CABLEADO** (autenticado) |
| 11b | Compuerta del POD para unidad física | POD ligado a `shipment` | `actions.ts:568` sólo calcula `podPdfReady` cuando `scope === "shipment"` | — | `case-presentation.ts:462-468` | `[id]/page.tsx:86` fija `shipmentId = isShipment ? view.entityId : null`; `CasePodGate.tsx:19` bloquea con `view.podBlocked \|\| !shipmentId` → **la unidad física queda bloqueada siempre**, y con el caso ya `RELEASED` el motivo es `null` (`case-presentation.ts:464`) y cae al literal por defecto `CasePodGate.tsx:24` | — | **CORTADO EN view-model** |
| 14 | Permiso de **captura del par** ingreso/egreso | `attach_custody_physical_evidence` (0251) rechaza por estado SÓLO con `state in('RELEASED','QUARANTINED')` | `actions.ts` exige `CUSTODY_CAPTURE_PERMISSION` (`wms.edit`) antes de tocar Storage | — | **`capture`** — campo PROPIO · `PhysicalCaptureView` | `PhysicalCapturePanel` · `view.capture.enabled` + `view.capture.blockers[0]` en los dos slots | `wms.edit` | **CABLEADO** |
| 13 | Decisión de casos **no** físicos (`packing_unit` / `shipment`) | `decide_custody_integrity` (v1) **revocada** para `authenticated` · `0250a:2199-2200` | `integrity-supabase.ts:263-265` sigue enrutando ahí todo scope no físico | — | — | el botón existe y la RPC rechaza por privilegio | `wms.custody.decide` | **CORTADO EN lectura · HN-1, determinado y NO remediado** |
| 12 | Firma de quien retira | — | — | — | — | — | — | **NO EXISTE** |

**Recuento tras el bloque 2-A:** 25 filas · **CABLEADO 18** · **CORTADO 4** ·
**NO EXISTE 2** · **NO VIAJA por diseño 1**.

*(Al cerrar la Sesión 0 eran 20 filas: 4 CABLEADO, 14 CORTADO, 2 NO EXISTE.)*

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

`custody.ts:1043-1045`:

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

### 9.4 · Lo que la Sesión 1 NO cerró y no le correspondía

- Costuras 7, 8, 10, 11b y 12 (certificado visible, traductor de códigos
  `CUSTODY_*`, puerta de egreso en picking/packing, POD de unidad física, firma
  de quien retira): son **Sesión 2**.
- **Del §7 quedan sin implementar** la barra de progreso de cinco pasos, el
  bloque `▶ AHORA` con una sola acción viva y el reordenamiento mobile-first, y
  el render de imagen grande lado a lado en `EvidenceViewer`. No están en
  ninguno de los siete puntos de la Sesión 1; se hizo el encabezado de
  identidad, el banner de consecuencia y el panel de análisis, que sí lo están.
- **C8 (fallback silencioso a `MOCK_CASES`)** sigue vivo en
  `custody.ts:1043-1045`, fuera de alcance por §8.

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

### 9.7 · Definición de negocio de los dos niveles (Dirección)

**NIVEL 1 — sin servicio de custodia digital.** La foto de ingreso es OPCIONAL;
su ausencia **no bloquea nada**: ni recepción, ni carga, ni reserva, ni despacho.
No pasa por IA, cuarentena, foto de egreso ni certificado. **No lleva foto de
egreso**: la base la rechaza con motivo legible, no con un código.

**NIVEL 2 — custodia contratada.** Todo obligatorio, sin aflojar nada.

**Línea roja:** ninguna excepción del nivel 1 afloja el nivel 2. Toda excepción
va acotada por nivel.

### 9.8 · Verificación pendiente de Dirección

**No se comprobó, y no se podía:** que Martin Battaglia, José Luis Rodríguez y
Martín Rinas —y sólo ellos— tengan hoy rol `admin`. Es una lectura de base
productiva y ninguna sesión está autorizada a conectarse. **Queda PENDIENTE DE
DIRECCIÓN.** Mientras no se responda, el reparto de autoridad está escrito en el
código pero no verificado contra la realidad: cada `admin` de más es alguien que
puede liberar mercadería de un cliente.

---

## 8 · LO QUE LA SESIÓN 0 NO HIZO (histórico)

- Cero cambios en `src/`, `supabase/` o `tests/`.
- Ninguna migración creada; `supabase/lineage/catalog.json` intacto.
- Ninguna conexión a Supabase, producción ni sistema externo.
- `Custodia-Digital-Desktop.html` y `Custodia-Digital-Mobile.html` no se abrieron.
- Ningún defecto remediado. Los catorce cortes y las dos ausencias quedan vivos y
  documentados.
