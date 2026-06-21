# Resumen para el contador — Email / WhatsApp / Checklist (listo para enviar)

> **Naturaleza:** documentación pura, para **consulta externa al contador** antes del backfill real.
> No modifica datos, no aplica migraciones, no contabiliza. Es la versión "lista para enviar" del
> documento técnico completo: **`docs/auditoria/paquete-contador-reglas-contables-backfill.md`**.
> Estado al redactar: motor contable instalado (`0085`/`0086`), **0 asientos generados**, 27
> comprobantes pendientes por **$85.066.531,50**, backfill real **bloqueado** hasta validar reglas.

---

## 1. Versión email (formal)

**Asunto:** Validación de criterios de imputación contable antes de generar asientos — requiere tu definición

Estimado/a [Nombre],

Te escribo para pedirte una validación profesional **previa** a un paso importante en el sistema de gestión de Logística TOPS.

Ya está instalado y probado el **motor contable** (genera automáticamente los asientos por partida doble a partir de cada comprobante) junto con los libros y reportes (libro diario, mayor, balance de sumas y saldos, estado de resultados, posición de IVA). **Sin embargo, todavía no se generó ningún asiento:** la contabilización masiva de los comprobantes históricos (lo que llamamos "backfill") está **deliberadamente frenada** hasta que vos valides los criterios de imputación.

**Situación a contabilizar:** hay **27 comprobantes pendientes** por un total de **$85.066.531,50**.

Antes de contabilizarlos necesitamos tu visto bueno sobre **5 reglas de imputación provisorias**. Las **dos más relevantes** son:

1. **Ingresos por ventas** → hoy todas las ventas gravadas se imputan a una **única cuenta general** de ingresos (`4.1.05 – Ventas Servicios Logísticos`).
2. **Gastos de proveedores** → hoy todo el neto de compras se imputa a una **única cuenta general** de gasto (`6.1.10 – Otros Gastos Operativos`).

Las otras tres son de menor impacto (percepciones y tributos): queremos confirmar que las cuentas usadas correspondan a IVA y si hace falta separar IIBB / municipal / otros.

**Qué te proponemos (recomendación técnica):** aprobar provisionalmente estas reglas y hacer un primer backfill que, además de la cuenta general, permita **análisis por centro de costo / unidad de negocio** (rentabilidad por área). Esto requiere completar una actualización del sistema que ya tenemos planificada.

**Importante:** si preferís un Estado de Resultados con **desglose más fino por cuenta** (ingresos separados por tipo de servicio, gastos separados por naturaleza: transporte, sueldos, servicios, etc.), eso se puede hacer, pero **debe diseñarse ANTES** de contabilizar. **Una vez generados los asientos, cambiar el criterio implica reversar y rehacer toda la contabilización** — por eso te consultamos en este momento, que es cuando aún no hay nada contabilizado y no hay impacto irreversible.

Te adjunto el documento técnico completo con el detalle de las 5 reglas y las cuentas disponibles. Para avanzar necesitamos tu decisión entre tres caminos (ver checklist al final).

Quedamos a tu disposición para una llamada si te resulta más práctico.

Saludos,
[Tu nombre] — Logística TOPS

---

## 2. Versión WhatsApp (breve)

> Hola [Nombre], consulta contable importante 👇
>
> Ya tenemos el motor contable del sistema funcionando, pero **todavía no generamos ningún asiento**: lo frenamos a propósito para que vos valides los criterios primero.
>
> Hay **27 comprobantes pendientes por $85.066.531,50** para contabilizar.
>
> Antes de hacerlo necesitamos que valides **5 reglas de imputación**. Las 2 clave:
> • **Ventas** → hoy van todas a una cuenta general de ingresos (4.1.05)
> • **Gastos de proveedores** → hoy van todos a una cuenta general (6.1.10 Otros Gastos)
>
> Si las aprobás, hacemos un primer cierre con **análisis por centro de costo** (rentabilidad por área), aunque la cuenta sea general.
> Si querés **más detalle por cuenta** (ventas por servicio, gastos por naturaleza), se puede, pero hay que diseñarlo **antes** de contabilizar.
>
> ⚠️ Clave: **después de contabilizar, cambiar el criterio obliga a reversar y rehacer todo**. Por eso te consultamos ahora que está todo en cero.
>
> Necesitamos tu decisión entre 3 opciones (te paso el detalle y un checklist por mail). ¿Lo vemos en una llamada de 10 min?

---

## 3. Checklist de decisión (para que el contador responda)

Marcar **una** opción principal (1 a 3) y los complementos que correspondan:

**Decisión principal:**
- [ ] **1) Apruebo las reglas actuales** tal cual (cuenta general de ingresos y de gastos) para el primer backfill.
- [ ] **2) Apruebo las reglas actuales SOLO si se incorpora análisis por centro de costo** (recomendado) — se completa la actualización hasta `0094` y luego se contabiliza.
- [ ] **3) NO apruebo todavía: requiero desglose más fino por cuenta** (ingresos por tipo de servicio / gastos por naturaleza) **antes** de contabilizar.

**Complementos (marcar si aplica):**
- [ ] Requiero **cuentas separadas para percepciones / tributos** (distinguir IVA / IIBB / municipal / otros).
- [ ] Requiero **modificaciones al plan de cuentas**.
- [ ] Requiero **revisar facturas o proveedores específicos** antes de contabilizar.

**Confirmación sobre percepciones (responder Sí/No):**
- ¿Las percepciones de **venta** (`2.1.04`) y las **sufridas en compras** (`1.1.06`) son de **IVA**? ☐ Sí ☐ No → especificar: __________
- ¿"Otros tributos" (`2.1.10`) necesita cuenta propia para algún tributo? ☐ Sí ☐ No → cuál: __________

**Observaciones del contador:**
> ____________________________________________________________

---

## 4. Nota final

Este documento es **material de consulta externa para el contador**, previo al **backfill contable
real** (la generación masiva de asientos). Al momento de enviarlo **no existe ningún asiento
generado** y **no hay impacto contable irreversible**: es el momento correcto para definir los
criterios de imputación. **Después del backfill, cambiar el criterio implica reversar y repostear**
los asientos (son append-only). La decisión del contador (sección 3) determina si se avanza con las
reglas actuales (camino recomendado: análisis por centro de costo tras aplicar hasta `0094`) o si se
diseña una extensión del modelo de imputación con desglose por cuenta antes de contabilizar.

## 5. Referencia al documento técnico completo

Detalle completo (las 5 reglas con su análisis, matriz A/B/C, qué resuelve y qué no resuelve `0094`,
próximos pasos según la decisión): **`docs/auditoria/paquete-contador-reglas-contables-backfill.md`**.

---

*Documento de consulta para el contador. No constituye asesoramiento contable ni ejecución.
No modifica datos ni contabiliza.*
