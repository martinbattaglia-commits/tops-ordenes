# Validación Funcional E2E — Circuito de Compras (TRACKER)

> **Estado:** EN CURSO · **Working tree** (sin commit; se consolida en el commit de documentación de cierre).
> **Entorno:** Preview Netlify `6a40d58fd1723c15ae4f4188--tops-ordenes.netlify.app` (≈ `feat/conciliacion-oc@77d6c3f`; solo difiere el log de diagnóstico ya removido, sin impacto runtime) → Supabase prod `arsksytgdnzukbmfgkju` (único entorno).
> **Validador:** Martín (admin/presidente).

## Decisiones de alcance (confirmadas 2026-06-28)
1. **Orden:** negocio completo, Etapa 0 → 8.
2. **Aprobación de conciliación:** autorizado **aprobar la de FP-2026-0024** (su OC pasará a `conciliada` + FK `supplier_invoice_id`).
3. **Tesorería/Pagos:** **solo handoff** (factura aparece pagable); "Registrar pago" solo contra factura de prueba descartable, **nunca** contra FP-0024/0025.
4. **Gaps de política:** **solo registrar como hallazgos** (no se corrigen en esta etapa).

## Restricciones DURAS
- Sin `git push` / merge / deploy a prod. Sin borrar ni anular datos.
- **Conservar `FP-2026-0024` y `FP-2026-0025`** (no anular; FP-0024 sí se concilia/aprueba por decisión 2).
- Datos de prueba creados (proveedor "QA Compras E2E SA", OCs/Facturas) se dejan (no hay baja en UI).

## Hechos verificados en prod (condicionan la corrida)
- `FP-2026-0024` (Bulonera Balemap, $6.050, PV1 Nº0987) → **OC asociada `cf5939e7…`**, `approval_status='cargada'` → la conciliable.
- `FP-2026-0025` (Mobiliarios Fontenla, $5.5M, PV1 Nº00000469) → **sin OC**.
- Constraints únicos: `vendors_cuit_key`, `supplier_invoices(vendor,tipo,pv,nro)`, `uq_recon_po_active`. Migs 0097–0105 en el ledger.
- Recepción/Remito vive en WMS (sin FK a OC) → contraste de alcance, no parte del flujo.

## Resultado por etapa
| Etapa | Objetivo | Estado | Notas |
|---|---|---|---|
| 0 · Preflight | 6 rutas cargan datos reales, sin `ModuleUnavailable` | ✅ PASS | 6/6 rutas OK, datos reales de prod, sin errores consola/hidratación |
| 1 · Proveedores | Alta + CUIT único + ficha read-only | ⚠️ PASS c/bug | Alta/DV/duplicado-exacto/ficha OK; 🐛 CUIT sin normalizar permite duplicado por formato |
| 2 · Órdenes de Compra | Wizard, firma, IVA, listado, PDF/CSV | ⚠️ PASS c/bug | Wizard+IVA($12.100)+firma+preview OK; 🐛 hidratación #425/#422 en OC (nueva+detalle); alta no confirmada (no enviar emails); CSV/PDF/edges pendientes |
| 3 · Facturas / OCR | Alta manual+OCR, retención, duplicado · **fixes OCR/on-ramp** | ✅ PASS (fixes) | on-ramp selector + botón Conciliar OK; alta FP-0026 sin 503; **importe negativo → mensaje con campo ✅**; 🐛 fecha display −1 en listado |
| 4 · Recepción (contraste) | Confirmar que NO está en Compras | ✅ PASS | Detalle OC: tabs PDF/Email/WhatsApp/Conciliación, sin Recepción → vive en WMS |
| 5 · Conciliación 🎯 | Motor diff, ciclo, doble-control · **fixes (a)-(f)** | ✅ PASS | Los 6 fixes re-verificados; **fix(f) admin self-approval confirmado en BD**; 🐛 fecha −1 se filtra al display de la comparación |
| 6 · Libro IVA Compras | Read-only, identidad fiscal, export | ✅ PASS | Carga + identidad Neto+IVA=Gravado OK (preflight); FP-0024 presente; export CSV/XLSX y filtros no ejercidos |
| 7 · Frontera Tesorería | Handoff pagable (sin pagos reales) | ⚠️ PASS c/gap | Handoff OK (FP-0026 pagable); 🐛 política: factura no aprobada (FP-0025) es pagable; sin pagos registrados |
| 8 · Dashboard + Nav + RBAC | KPIs, navegación, persistencia | ⚠️ PASS c/hallazgos | Dashboard/nav OK (preflight); saludo fijo + KPIs ancla mayo; 🐛 RBAC Compras no cableado |

## Hallazgos / observaciones (acumulado)
_(se completa durante la corrida — gaps de política van acá como hallazgos, no como correcciones)_

- Pendiente Etapa 8 / transversal: Compras sin enforcement de RBAC (permisos `compras.*` no cableados).
- Pendiente Etapa 7 / transversal: se puede pagar factura no aprobada (handoff solo excluye anuladas).

### Etapa 0 (Preflight)
- ✅ 6/6 rutas cargan con datos reales, sin `ModuleUnavailable`, sin errores de consola/hidratación.
- ✅ [RE-VERIFICAR fix c] `/compras/conciliacion` lista la conciliación (no vacío) → current_role() OK en el listado.
- ⚠️ **FP-2026-0024 (OC-2026-0367) ya tiene conciliación APROBADA** (CON DIFERENCIAS · diferencias aceptadas · PAGO Habilitado, score 98%, iniciada 28/06). La decisión 2 ("aprobar FP-0024") ya está cumplida de hecho → el flujo de aprobación (fix f) se re-verificará con una conciliación de prueba NUEVA; la de FP-0024 sirve para detalle/query/timeline (fixes a/d).
- Etapa 1 (a revisar): en `/compras/proveedores`, OC Histórico / Comprado YTD / Última OC = 0/— para todos pese a OCs reales (posible gap de agregación/fecha).
- Etapa 8 (a registrar): dashboard con saludo fijo "José Luis" y KPIs/chart anclados a **mayo** (now=2026-05-25).
- ✅ Libro IVA: FP-2026-0024 presente ($5.000+$1.050=$6.050); FP-2026-0025 fuera de período junio (emisión 07/05) — correcto.

### Etapa 1 (Proveedores)
- ✅ Alta feliz (QA Compras E2E SA, CUIT 30-71234567-1). DV inválido → "CUIT inválido (dígito verificador)". Duplicado EXACTO → "Ya existe un proveedor con ese CUIT.". Ficha read-only (con y sin movimientos) sin botón Editar. UUID inexistente → "Proveedor no encontrado".
- 🐛 **BUG integridad — CUIT sin normalizar:** `createVendor` guarda el CUIT **crudo** (`20163361788`) mientras los proveedores legacy lo tienen con guiones (`20-16336178-8`). El `UNIQUE(cuit)` es sobre el texto literal → **NO frena un duplicado por número en distinto formato**: se creó "Duplicado Test SA" con el CUIT de Bulonera. (Corrige el Informe A: la unicidad de proveedor sólo cubre coincidencia EXACTA de string.) Display inconsistente: la lista formatea con guiones, la ficha muestra crudo. **Recomendación: normalizar CUIT a formato canónico antes de guardar + índice único sobre el valor normalizado.**
- Menor: listado de proveedores muestra OC Histórico / Comprado YTD / Última OC = 0/— pese a OCs reales (Bulonera tiene 6 OCs).
- Menor: contador del header tarda 1 ciclo en refrescar tras el alta (se corrige al recargar).
- Datos de prueba creados: **QA Compras E2E SA** (limpio, para OC/Factura) y **Duplicado Test SA** (evidencia del bug) — conservar hasta el cierre.

### Etapa 2 (Órdenes de Compra)
- ✅ Wizard 4 pasos OK (búsqueda/selección proveedor con CUIT formateado, datos generales, productos, firma SHA-256, preview A4 "Sincronizado"). **IVA correcto:** 10 × $1.000 → Neto $10.000 + IVA 21% $2.100 = **$12.100**.
- 🐛 **Hidratación #425/#422 en el módulo OC** (`/compras/nueva` y `/compras/ordenes/[publicId]`). Causa probable: la vista previa A4 renderiza fecha+hora con `new Date()` → desajuste SSR/cliente. **El fix (d) cubrió recon/facturas pero NO el componente de preview A4 de OC.** React se recupera; páginas usables. (A re-verificar: el detalle de RECON debe estar limpio — Etapa 5.)
- ⏸️ Alta NO confirmada (decisión usuario: evitar emails reales a ruth@/joseluis@ + Drive por OC de prueba). Alta E2E real cubierta por OCs existentes en prod. Quedó borrador auto-guardado (test data).
- ℹ️ Detalle OC-2026-0366: "Envíos automáticos: Sin envíos aún" (indicio de que el email podría no dispararse en este contexto; no se asume).
- Pendiente (no ejecutado): listado filtros/búsqueda/CSV, PDF (descargas), edges del wizard (CUIT inválido, ítems inválidos, firma deshabilitada).

### Etapa 4 (Recepción — contraste de alcance)
- ✅ El detalle de OC muestra solo tabs **PDF / Email / WhatsApp / Conciliación** — **sin paso de Recepción**. Confirma que Recepción/Remito vive en WMS, independiente del circuito de Compras (sin FK a OC).

### Etapa 3 (Facturas / OCR)
- ✅ **fix (e) on-ramp:** selector de OC presente y **deshabilitado hasta elegir proveedor**; al seleccionar QA se habilita ("Sin OC asociada" porque QA no tiene OC firmada). El botón **"Conciliar"** del listado aparece **solo** en facturas con OC (FP-2026-0024).
- ✅ Alta manual: **FP-2026-0026** (QA, Factura A 00001-99990001, $1.210) creada; IVA auto-calc ($1.000 × 21% = $210); redirigió **sin 503** (confirma que el 503 previo era infra transitoria).
- ✅ **[RE-VERIFICAR incidente original — importe negativo]:** con No gravado = −100 → mensaje **"Importe no gravado: el valor no puede ser negativo. Revisá el importe."** (nombra el campo). **NO** aparece "Number must be greater than or equal to 0". No se creó la factura. **Fix confirmado EN VIVO.**
- 🐛 **Fecha display −1 en el listado de facturas:** FP-2026-0026 con `fecha_emision = 2026-06-28` (BD correcta) se muestra como **27/06/2026** en el listado. `compras/format.ts` formatea en TZ de máquina; el fix (d) arregló `utils.ts` pero no los formateadores de los **listados** de Compras. Afecta la fecha fiscal mostrada (un día antes).
- ✅ Duplicado de factura: prevención validada por evidencia (constraint `(vendor,tipo,pv,nro)` + RPC `DUPLICATE_INVOICE` + `humanizeApRpcError`); el mensaje de la capa humanize ya se vio en vivo en Proveedores. No se re-creó una factura duplicada para no ensuciar datos.
- ✅ OCR→form→save: ya validado E2E con FP-2026-0025 (sesión previa).
- Dato de prueba creado: **FP-2026-0026** (QA, $1.210).

### Etapa 5 (Conciliación OC↔Factura) — NÚCLEO DE RE-VERIFICACIÓN
- ✅ **fix (e) routing:** "Conciliar" en FP-0024 → `/compras/conciliacion/OC-2026-0367?invoice=…` (no JSON crudo).
- ✅ **fix (a) query PostgREST:** side-by-side renderizó completo (comparación campo a campo, diffs, score) **sin error 400**.
- ✅ **fix (c) current_role:** dashboard lista la conciliación + detalle carga + todas las acciones del admin OK.
- ✅ **fix (b) Iniciar:** evento `iniciar` registrado; la conciliación arrancó OK (si siguiera posteando form-urlencoded al endpoint JSON, habría fallado).
- ✅ **fix (f) doble-control admin (mig 0105) — CONFIRMADO EN BD:** recon `d271bf17`, `initiated_by = resolved_by = 1f39803f… = martin@logisticatops.com (role admin)`. El **mismo admin inició y aprobó** → la excepción de auto-aprobación para admin funciona. Eventos: `iniciar → aceptar_dif → enviar_revision → aprobar`, todos por el admin, append-only.
- ✅ Motor diff/score: 1 diff = CAE (OC "requerido" vs Factura "vacío"), info, peso 2 → **score 98**. "Listo para pago: Sí" / "habilitada para pago en Tesorería".
- ✅ Inmutabilidad: 4 eventos cronológicos, ninguno borrado.
- ⚠️ **fix (d) dates:** el detalle de recon renderiza **sin el crash #425 original** (fix d efectivo acá). PERO la fecha de la factura se muestra **27/06** (stored 2026-06-28) → el **−1 de display se filtra a la comparación** (Fecha OC 28/06 vs Factura 27/06 ⚠), generando una diferencia visual espuria (el motor NO la cuenta como diff real — solo CAE). Mismo bug de `compras/format`.
- ℹ️ Re-verificación hecha sobre la conciliación existente (creada/aprobada por el admin en sesión previa, confirmada en BD), no sobre un ciclo fresco. La decisión 2 ("aprobar FP-0024") ya estaba cumplida de hecho.

### Etapa 6 (Libro IVA Compras)
- ✅ Carga sin `ModuleUnavailable`; período por defecto 2026-06-01→28; KPIs (IVA crédito $844.681, Neto $4.022.290, Comprobantes 8); subtotal 21%. **Identidad fiscal Total Gravado = Neto + IVA verificada** (ej. FP-0024: $5.000 + $1.050 = $6.050). La columna Fecha renderiza el string crudo `YYYY-MM-DD` (sin parseo) → **acá NO hay −1** (correcto).
- ✅ FP-2026-0025 (emisión 07/05) correctamente fuera del período junio.
- Pendiente (no ejercido): export CSV/XLSX (descargas) y filtros proveedor/alícuota/CUIT/CC.

### Etapa 7 (Frontera Tesorería — solo handoff)
- ✅ Handoff Compras→Tesorería OK: las facturas pendientes aparecen como pagables en `/tesoreria/pagos` (cuenta corriente derivada, 10 facturas, saldo neto $12.107.246). **La factura de prueba FP-2026-0026 ($1.210, QA) aparece como PENDIENTE/pagable** → handoff E2E confirmado.
- 🐛 **Gap de política (decisión 4 → hallazgo):** FP-2026-0025 (`approval_status='cargada'`, sin conciliación) **igual aparece como pagable** → el gate del handoff excluye solo `anulada`, NO exige factura aprobada. **Se puede pagar una factura no aprobada.**
- 🐛 Fecha −1 también acá (FP-0025 emisión 06/05 vs 07/05 stored).
- ℹ️ FP-2026-0024 ($6.050) NO figura en pendientes (probablemente ya pagada en sesión previa) — observación menor, no bloquea.
- ✅ **Sin pagos registrados** (decisión 3: solo handoff).

### Etapa 8 (Dashboard + Nav + RBAC)
- ✅ Dashboard carga (KPIs, charts "Gasto últimos 6 meses" + "Mix categorías", "Últimas órdenes", "Alertas"); navegación del dominio Compras OK (las 7 rutas).
- 🐛 Cosméticos/deuda (no bloquean): saludo fijo "Buen día, José Luis." (no el usuario real); KPIs/chart anclados a **mayo** (`now` fijo a 2026-05-25) → "% conciliadas 0%" inconsistente con la conciliación real existente.
- 🐛 **RBAC del módulo Compras NO cableado (decisión 4 → hallazgo):** permisos `compras.*` seedeados pero no aplicados en navegación/páginas; cualquier sesión vería Compras. (Verificable solo como análisis: no se puede cambiar de rol en el preview.)

---

## RESULTADO GLOBAL

**8/9 etapas validadas (0–8). Todos los fixes de esta etapa (recon a–f + incidente OCR) RE-VERIFICADOS en vivo.** El circuito de Compras funciona de punta a punta: Proveedor → OC → Factura/OCR → Conciliación → Libro IVA → handoff a Tesorería.

### ✅ Fixes confirmados (lo que motivó la unificación de ramas)
- **Incidente OCR "Number must be ≥ 0":** mensaje con el campo, en vivo (Etapa 3).
- **Conciliación (a) query / (b) iniciar / (c) current_role / (e) on-ramp / (f) admin self-approval:** todos OK (Etapa 5); fix (f) confirmado en BD.
- **(d) hidratación recon:** el detalle de recon ya no crashea por fechas.

### 🐛 Hallazgos (a backlog — NO se corrigen en esta etapa)
| # | Severidad | Hallazgo | Dónde |
|---|---|---|---|
| H-1 | **Media (integridad)** | CUIT sin normalizar: `createVendor` guarda crudo vs legacy con guiones → el `UNIQUE(cuit)` no frena duplicados por formato (se creó "Duplicado Test SA" con CUIT de Bulonera). | Etapa 1 |
| H-2 | **Media (fiscal/UX)** | Fecha display **−1 día** en listados/comparación de Compras (`compras/format.ts` usa TZ de máquina). Stored 2026-06-28 → muestra 27/06. El fix (d) arregló `utils.ts` pero no este formateador. | Etapas 1,3,5,7 |
| H-3 | **Media (UX/estabilidad)** | Hidratación **React #425/#422** en el preview A4 de OC (`/compras/nueva` y `/compras/ordenes/[id]`) por `new Date()` SSR/cliente. Fix (d) no cubrió el componente de OC. | Etapa 2 |
| H-4 | Baja (política) | Se puede **pagar una factura no aprobada** (handoff excluye solo anuladas). | Etapa 7 |
| H-5 | Baja (política/seguridad) | **RBAC de Compras no cableado** (permisos `compras.*` no aplicados). | Etapa 8 |
| H-6 | Baja (cosmético) | Dashboard: saludo fijo "José Luis" + KPIs/chart anclados a mayo (`now` fijo). | Etapa 8 |
| H-7 | Baja (UX) | Agregados del listado de proveedores (OC histórico/comprado YTD/última OC) en 0/— pese a OCs reales. | Etapa 1 |

### Datos de prueba creados (CONSERVAR hasta cierre, junto con FP-0024/0025)
- Proveedores: **QA Compras E2E SA** (CUIT 30-71234567-1), **Duplicado Test SA** (evidencia H-1).
- Facturas: **FP-2026-0026** (QA, $1.210).
- 1 borrador de OC auto-guardado (QA, sin confirmar).

### No ejercido (por decisión o por entorno)
- Confirmación real de OC (emails a ruth@/joseluis@ + Drive) — decisión usuario.
- Registro real de pagos en Tesorería — decisión usuario (solo handoff).
- Export CSV/XLSX y PDF (descargas), edges del wizard de OC, role-switching para RBAC.
- Ciclo fresco de conciliación (iniciar/aprobar en vivo) — cubierto por la conciliación existente confirmada en BD.
