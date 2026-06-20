# EPHEMERAL VALIDATION PACKAGE
**Validación de la cadena `0082–0101` en un entorno Supabase descartable, antes de aplicar en la base única `arsksytgdnzukbmfgkju`.**

> Naturaleza: plan operativo ejecutable por Martín. Repetible. **No toca la base productiva.**
> Arquitectura vigente (G4): base Supabase **única = `arsksytgdnzukbmfgkju`** (fuente de verdad,
> productiva). **No existe staging operativo.** Este ensayo efímero es la **recomendación
> altamente preferida** para validar un cambio estructural significativo como esta cadena.
> Datos sintéticos del ensayo: ver `docs/runbooks/ephemeral-validation-seeds.md`.

---

## 1. Objetivo
Reproducir, en un proyecto Supabase **efímero y descartable**, el esquema completo de Nexus y
aplicar la cadena `0082–0101` para validarla (estructura + comportamiento) con los 5 kits
read-only y pruebas de UI, obteniendo una decisión **GO/NO-GO** documentada **antes** de cualquier
aplicación sobre la base única productiva `arsksytgdnzukbmfgkju`.

**Principio rector:** el ensayo se construye **solo desde los archivos del repo** (migraciones
`0001→0101`), nunca copiando datos/credenciales de la base productiva. Así se garantiza **cero
PII** y aislamiento total.

---

## 2. Arquitectura del ensayo

### 2.1. Opciones de entorno (elegir una)
| Opción | Qué es | Ventaja | Cuándo |
|---|---|---|---|
| **A. Local (recomendada)** | Supabase local vía CLI/Docker (`supabase start`) en la máquina de Martín | Máximamente descartable, sin nube, repetible, gratis, sin riesgo de tocar nada cloud | Default |
| **B. Proyecto cloud efímero** | Proyecto Supabase nuevo, separado, marcado "TEMP" | UI/Studio cloud idéntico a prod; útil si se quiere probar Storage/Realtime cloud | Si se necesita paridad cloud |

> Ambas son **independientes** de `arsksytgdnzukbmfgkju`. **Prohibido** usar `vrxosunxlhohmqymxots`
> u otro proyecto preexistente.

### 2.2. Identidad del entorno
- Nombre sugerido: `nexus-erp-validation-temp-<YYYYMMDD>`.
- **Etiqueta visible** en el nombre/descripción: "EFÍMERO — DESTRUIR TRAS VALIDACIÓN".
- Registrar su **ref/URL** en la evidencia para evitar confusión con la base única.

### 2.3. Duración esperada
- **Provisión + replicación:** ~30–60 min.
- **Ejecución A→E + kits + UI:** ~2–4 h.
- **Vida total:** mismo día / hasta cerrar GO-NO-GO (máx. recomendado 48–72 h).

### 2.4. Criterios de destrucción
Destruir el entorno cuando se cumpla **cualquiera**:
- Se emitió el veredicto GO/NO-GO y se guardó la evidencia.
- Pasaron >72 h sin cerrar (re-crear limpio en el próximo intento).
- Se detectó cualquier dato productivo cargado por error (destruir **inmediatamente**).

### 2.5. Responsabilidades
| Rol | Responsable |
|---|---|
| Provisionar/destruir el entorno | Martín |
| Aplicar migraciones (un archivo por ejecución) | Martín |
| Correr kits y capturar evidencia | Martín |
| Pruebas funcionales de UI | Martín (o QA designado) |
| Validación contable de plan/reglas | Contador |
| Veredicto GO/NO-GO | Martín (con evidencia) |

---

## 3. Replicación segura del esquema (sin PII, sin datos productivos)

**Método único autorizado: replay de migraciones desde el repo.** No se hace dump de la base
productiva.

1. Partir de una **base vacía** (local con `supabase start`, o proyecto cloud nuevo recién creado
   — ya trae `auth`, `storage`, `extensions`).
2. **Habilitar `btree_gist`** (requisito de `0097`) antes del Bloque E.
3. Aplicar **en orden** los archivos `supabase/migrations/0001 … 0081` (base preexistente) y luego
   `0082 … 0101` (la cadena a validar), **un archivo por ejecución** (crítico por `0082`).
4. Esto reconstruye de forma **determinística**: tablas, **tipos/enums**, **funciones/RPCs**,
   **vistas**, **policies RLS**, **triggers** y **seeds estructurales** (plan de cuentas, centros
   de costo, servicios, permisos RBAC) — **todo** generado por los propios `.sql`, sin tocar la
   base real.

### 3.1. Lo que NO se replica (prohibido)
- ❌ **PII / datos productivos** (clientes reales, CUITs reales, facturas reales, importes reales).
- ❌ **Credenciales / secretos** (service_role de prod, claves ARCA, tokens).
- ❌ **Dumps de datos** de `arsksytgdnzukbmfgkju`.

### 3.2. Seeds mínimos sintéticos (solo para pruebas funcionales)
Cargar a mano un set **mínimo y ficticio** (datos inventados, sin parecido a reales) suficiente
para las pruebas funcionales. **Catálogo completo en `ephemeral-validation-seeds.md`.** Resumen:
- 1–2 **clientes** sintéticos.
- 1–2 **proveedores** sintéticos.
- 1 **factura de venta** AUTORIZADA de prueba y 1 **factura de compra** aprobada.
- 1 **orden logística** de prueba (estado despachado/entregado).
- Cuentas bancarias: ya las seedea `0053` (CAJA + 2 bancos).
- 1 **tarifa** (`customer_service_rates`) de prueba para el billing run recurrente.
- 1 **usuario de prueba** con rol RBAC `admin`/`director_ops` (para que la UI write funcione).

> Los seeds sintéticos se documentan aparte (valores ficticios). **Nada** sale de la base productiva.

---

## 4. Preparación (checklist previo)
- [ ] Entorno efímero creado (opción A o B), ref/URL registrada y etiquetada "EFÍMERO".
- [ ] Confirmado que **NO** es `arsksytgdnzukbmfgkju` ni `vrxosunxlhohmqymxots`.
- [ ] Acceso owner/`postgres` al SQL Editor del efímero.
- [ ] Extensión **`btree_gist`** disponible/habilitada.
- [ ] Branch `claude/nexus-accounting-tax-audit-mbpxjt` a mano (de ahí salen los `.sql`).
- [ ] Metodología confirmada: **un archivo `.sql` por ejecución**, sin pegar varios.
- [ ] Los 5 kits localizados en `supabase/tests/` (`ACCOUNTING_VALIDATION`, `PHASE10`–`PHASE13`).
- [ ] Carpeta/issue de **evidencia** creada (§6).
- [ ] Usuario de prueba RBAC listo (para UI).

---

## 5. Ejecución (bloques A→E + kits)

> Secuencia idéntica a la del runbook principal §3. Tras **cada** bloque: correr su kit, capturar
> evidencia, aplicar GO/NO-GO (§7) antes de continuar.

| Bloque | Migraciones (una por ejecución) | Kit (read-only) | Validación clave |
|---|---|---|---|
| **A** | 0082 → 0083 → 0084 → 0085 → 0086 | `ACCOUNTING_VALIDATION.sql` | plan seedeado · balance cuadra · 0 descuadrados |
| **B** | 0087 → 0088 → 0089 | `PHASE10_FISCAL_VALIDATION.sql` | percep/retenc OK · IVA fiscal≈contable |
| **C** | 0090 → 0091 | `PHASE11_TREASURY_VALIDATION.sql` | pago c/retención **sin residual** en CxP |
| **D** | 0092 → 0093 → 0094 → 0095 | `PHASE12_VALIDATION.sql` | EERR por CC = total · sin doble facturación |
| **E** | 0096 → 0097* → 0098 → 0099 → 0100 → 0101 | `PHASE13_VALIDATION.sql` | sin tarifas solapadas · billing→BORRADOR · simulaciones read-only |

`*0097` requiere `btree_gist`.

**Pruebas funcionales de UI** (sobre los seeds sintéticos) — las 15 de §5 del runbook: plan de
cuentas, libro diario/balance, posición IVA/fiscal, cargar percepción, pago con retención
(bruto/retención/neto sin residual), resultado por CC, vincular orden→factura, billing run
(crear→calcular→aprobar→borrador BORRADOR), pricing "no priceable" con motivo, simular cierre y
refundición anual (read-only).

**Prohibido en el ensayo** (igual que en prod): `acc_execute_closing` real,
`acc_execute_annual_closing` real, emisión ARCA. Solo **simulación**.

---

## 6. Evidencia

### 6.1. Qué capturar (por bloque A–E)
- **Log de aplicación**: qué migraciones corrieron OK (y en qué orden).
- **Salida de cada kit**: tabla con la columna `estado` (idealmente export del resultado; mínimo screenshot).
- **Errores** (si los hay): código `SQLSTATE`, mensaje, hint, y migración/objeto afectado.
- **Capturas de UI** de las pruebas funcionales.
- **Ref/URL del entorno efímero** (para trazabilidad).
- **Nota contable**: observaciones del contador sobre plan/reglas.

### 6.2. Cómo almacenar
- Carpeta dedicada (Drive) o issue del repo: `validacion-efimera-0082-0101-<fecha>`.
- Un subíndice por bloque (A–E) + carpeta "UI" + "errores" + "contador".

### 6.3. Qué constituye evidencia válida
- Kit con **todas** las filas `estado = OK` (los `REVISAR` deben tener explicación escrita y aceptada).
- Captura legible con fecha/hora y ref del entorno.
- Para "sin residual"/"sin duplicación"/"billing→BORRADOR": la **fila concreta** de la vista que lo
  demuestra (`v_pagos_retencion_residual` vacío, `v_billing_vs_factura_diff` = 0,
  `customer_invoices.estado_arca='BORRADOR'`).

---

## 7. GO / NO-GO (criterios formales)

**GO de bloque** (pasar al siguiente) — **todos**:
- [ ] Todas las migraciones del bloque aplicaron sin error.
- [ ] Kit del bloque: `estado = OK` (REVISAR explicados).
- [ ] `v_balance_sumas_saldos` cuadra · `v_asientos_descuadrados` vacío.
- [ ] Pruebas funcionales del bloque correctas.

**GO global del ensayo** (habilita planificar la aplicación en base única) — **todos**:
- [ ] Bloques A–E aplicados sin error.
- [ ] Los 5 kits en `OK`.
- [ ] 0 diferencias fiscal vs contable sin explicación.
- [ ] 0 duplicación (órdenes/billing) · billing solo BORRADOR · pricing no inventa.
- [ ] Cierre/refundición **solo simulados**.
- [ ] Contador validó plan de cuentas/reglas.
- [ ] Evidencia completa archivada.

**NO-GO** (frenar) ante **cualquiera**:
- Migración fallida · balance no cuadra · descuadrados · diferencias sin explicar · error en vista
  · duplicación · borrador emitido (AUTORIZADO_ARCA) · algo contabilizado sin aprobación · una
  "simulación" que escribió.

---

## 8. Rollback

### 8.1. En el entorno efímero (trivial)
- **Rollback técnico = destruir y recrear.** Es la gran ventaja del efímero: ante cualquier falla,
  se descarta el proyecto/instancia y se vuelve a empezar limpio (replay desde `0001`). Sin restore
  points ni cirugía de datos.
- Local: `supabase stop` + `supabase db reset` (o destruir el contenedor). Cloud: borrar el proyecto TEMP.

### 8.2. Rollback lógico (si se quiere probar el mecanismo, no para "salvar" el efímero)
- Asientos → `acc_reverse_entry` · Período → `acc_reopen_period` · Recibos/pagos →
  `tesoreria_void_movement` · Borrador → anulación lógica.
- Útil para **validar que el rollback lógico funciona** (es parte de las pruebas), no como
  contención del efímero.

---

## 9. Aplicación posterior en la base única (post-ensayo exitoso)

Solo si el ensayo cerró **GO global**:
1. Releer **runbook §9** (checklist antes de aplicar en la base única) y **§10** (orden de aplicación).
2. **Autorización explícita de Martín** por escrito.
3. **Restore point de `arsksytgdnzukbmfgkju`** inmediatamente antes (rollback primario).
4. **Ventana de bajo tráfico** (finanzas/tesorería).
5. Aplicar **Bloques A→E, un archivo por ejecución**, validando con los kits read-only tras cada
   bloque, sobre la base única.
6. **No** ejecutar cierres/refundición reales ni ARCA el mismo día; primero observar operación normal.
7. **Monitoreo 24–72 h:** `v_asientos_descuadrados`, `v_balance_sumas_saldos`,
   `v_iva_fiscal_vs_contable`, `v_pagos_retencion_residual`, `v_billing_vs_factura_diff`.
8. **Destruir el entorno efímero** (cerró su propósito).

> En la base única el rollback **no** es "destruir/recrear": es **restore point** + reversa lógica.
> Por eso el restore point previo es obligatorio.

---

## 10. Riesgos residuales (clasificados)

| Sev. | Riesgo | Mitigación |
|---|---|---|
| 🔴 Crítico | **Cargar datos productivos/PII en el efímero por error** (rompe el aislamiento). | Solo seeds sintéticos (§3.2); prohibido dump de prod; destruir de inmediato si ocurre. |
| 🟠 Alto | **Aplicar al ref equivocado** (efímero vs base única). | Confirmar ref antes de cada ejecución (§4); etiqueta "EFÍMERO" en el nombre. |
| 🟠 Alto | **El ensayo no representa la base real** porque los seeds son mínimos (no cubre todos los datos legacy). | El ensayo valida **estructura + comportamiento**, no migración de datos masiva; el riesgo de datos se cubre con el monitoreo §9.7 + restore point en la aplicación real. |
| 🟡 Medio | **`btree_gist` no disponible** en el efímero → falla `0097`. | Habilitar antes del Bloque E (§4). |
| 🟡 Medio | **Migraciones 0001–0081 con supuestos** (usuarios/buckets específicos) que fallen en base vacía. | Replay incremental; capturar el error exacto y resolver el seed mínimo; es justamente lo que el ensayo detecta sin riesgo. |
| 🟢 Bajo | **Paridad imperfecta local vs cloud** (Storage/Realtime). | Para esta cadena (contable/fiscal) no se usan Storage/Realtime críticos; si se requiere paridad, usar opción B (cloud efímero). |
| 🟢 Bajo | **Costo/tiempo de provisión**. | Opción A (local) elimina costo; tiempo acotado (§2.3). |

---

*Documento de planificación. No constituye ejecución. No crea proyectos, no toca Supabase, no
aplica migraciones, no toca producción. Ejecuta Martín en un entorno efímero descartable.*
