# RRHH-19-EMPLOYEES-REVIEW

**Fecha:** 2026-06-08 · Fuente: `Recibos sueldos 2026 05 (1).PDF` (34 págs · Verotin S.A. · CUIT 33-60489698-9).
**Propósito:** validar la nómina completa **antes** de aplicar `0062`/`0063`/`0064`. **Nada se aplicó ni se escribió en prod.**
Datos tomados **directamente del PDF** (ground-truth), contrastados contra los seeds.

## Nómina — 19 empleados

| Legajo | Apellido y nombre | CUIL | Ingreso | Cargo | Categoría | Banco (cuenta) | Modalidad (según recibo) |
|--:|---|---|---|---|---|---|---|
| 1 | Reynoso, Juan Carlos | 20-14824517-8 | 01/04/1988 | Encargado de depósito | Maestranza C | Galicia · 400318521513 | Tiempo completo indeterminado |
| 3 | Fernandez, Carlos Miguel | 20-18345361-1 | 18/03/2004 | Chofer | Conductor cat. 2 | Galicia · 400651711517 | Tiempo completo indeterminado |
| 4 | Fernandez Battaglia, Martin | 20-28032178-9 | 01/08/2006 | Agente contable | Director | Galicia · 803740 | **LRT (Directores SA)** |
| 6 | Martinez, Victor Nicolas | 20-17833256-3 | 17/05/2010 | Operario 4 | Operario categ. 4 | Galicia · 401087661518 | Tiempo completo indeterminado |
| 7 | Rodriguez Silva, Jose Luis | 23-94837779-9 | 18/04/2012 | Administ. de ventas | Administ. vtas. cat 3 | Galicia · 4013600179 | Tiempo completo indeterminado |
| 8 | Rodriguez Ayala, Eliezer | 20-94838520-2 | 01/03/2012 | Chofer | Conductor cat. 2 | Galicia · 4013601813 | Tiempo completo indeterminado |
| 9 | Serrano Zapata, Jaime Alberto | 20-95021287-0 | 06/12/2012 | Maestranza | Maestranza A | Galicia · 401334285 | Tiempo completo indeterminado |
| 10 | Merino, Jorge Gabriel | 20-24011564-7 | 14/04/2015 | Gerente general | Gerencia General | Galicia · 4016815763 | Tiempo completo indeterminado |
| 11 | Alba, Cynthia Paola | 27-29245752-4 | 10/08/2015 | Administración | Administrativo A | Galicia · 4018410164 | Tiempo completo indeterminado |
| 13 | Fernandez Calvo, Angel Benito | 20-04416209-2 | 01/07/2017 | Directivo | Director | Santander Río · 8800000080374 | **LRT (Directores SA)** |
| 14 | Silva Nuñez, Manuel Fernando | 20-95555080-4 | 14/05/2018 | Operario 3 | Operario cat 3 | Galicia · 4020727-6 151-9 | Tiempo completo indeterminado |
| 15 | Velazquez, Jose Ezequiel | 20-41969130-6 | 16/05/2018 | Chofer | Conductor cat. 2 | Galicia · 4020726-8 151-5 | Tiempo completo indeterminado |
| 16 | Mendoza, Ricardo Anibal | 23-12644035-9 | 05/10/2018 | Sereno | Maestranza A | Galicia · 4021160-5 151-8 | **Tiempo parcial indeterminado** |
| 21 | Rodriguez Rodriguez, Silvio Ivan | 27-96182735-9 | 01/04/2022 | Operario 4 | Operario cat 4 | Galicia · 4023815-5 151-8 | **Tiempo parcial indeterminado** |
| 22 | Gonzalez, Valentina Silvia | 27-28311907-1 | 03/10/2022 | Limpieza | Maestranza A | Galicia · 402495051510 | **Tiempo parcial indeterminado** |
| 23 | Carrasquero Jimenez, Ruth Ylianis | 27-19102426-0 | 01/02/2023 | Administración | Administrativo A | Galicia · 4025219-0 151-9 | Tiempo completo indeterminado |
| 25 | Ojeda, Juan Carlos | 20-17832359-9 | 04/07/2025 | Maestranza | Maestranza A | **Efectivo** | **Tiempo parcial indeterminado** |
| 26 | Veliz, Ramon Nestor | 20-12835097-8 | 27/09/2025 | Portero | Maestranza A | **Efectivo** | **Período de prueba** (jubilado) |
| 27 | Guadalupe, Alberto Jorge | 20-18072454-1 | 14/01/2026 | Sereno | Maestranza A | **Efectivo** | **Período de prueba** |

## Contraste con los seeds (verificación)
- **CUIL (19/19):** coinciden con `0062`. ✅
- **Cuentas bancarias (16/16):** coinciden exactamente con `0063` (15 Galicia + 1 Santander). ✅
- **Efectivo (3):** legajos 25/26/27 sin cuenta — correcto en `0063`. ✅
- **Ingreso / categoría / cargo:** coinciden con `0062`. ✅

## ⚠️ Discrepancia a decidir — Modalidad de contratación
`0062` carga **a los 19** como `modalidad_contratacion='tiempo_indeterminado'`. Los recibos muestran **4 modalidades distintas**:

| Modalidad (recibo) | Legajos | ¿Coincide con 0062? |
|---|---|---|
| Tiempo completo indeterminado | 1, 3, 6, 7, 8, 9, 10, 11, 14, 15, 23 (11) | ✅ |
| Tiempo parcial indeterminado | 16, 21, 22, 25 (4) | ❌ (0062 dice indeterminado pleno) |
| LRT — Directores SA | 4, 13 (2) | ❌ (régimen de director) |
| Nuevo período de prueba | 26, 27 (2) | ❌ (26 además figura "jubilado") |

**Recomendación:** antes de aplicar `0062`, decidir si se refina `modalidad_contratacion` para reflejar parcial / directores / período de prueba.
- **No modifiqué `0062`** (criterio conservador: lo aprobás vos).
- Si confirmás, preparo `0062` v2 con la modalidad real por legajo (requiere validar que el enum/columna acepte esos valores; hoy el seed usa un único valor).
- Observación menor: legajo 26 (Veliz) figura "jubilado" y "período de prueba" simultáneamente → confirmar con liquidación.

## Decisión requerida
1. ✅/✏️ **Aprobar la nómina** tal cual, **o** pedir refinamiento de modalidad (legajos 16/21/22/25/4/13/26/27).
2. Una vez aprobada → se habilita aplicar `0062` → `0063` → `0064` → CH5-b.

> Sin escritura en producción. Sin commit/push.
