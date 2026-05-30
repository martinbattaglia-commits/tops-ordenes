# FASE 1A · UX

**Scope:** wireframes funcionales para Facturación + Cuenta Corriente + Dashboard.
**Estado:** diseño · no implementar · referencia para futura UI.
**Convenciones visuales:** heredadas del proyecto — Tailwind + componentes existentes (`btn`, `card`, `badge`, `kpi`, `tbl`, etc.), tipografía Gotham, paleta TOPS (azul `#050555`, rojo `#C90812`).

---

## 1 · Mapa de navegación

### 1.1 Estructura de sidebar después de FASE 1A

```
COCKPIT
├── Cockpit ejecutivo                         (existente, + widgets nuevos)
└── Mapa operativo                            (existente)

COMPRAS · PROVEEDORES
├── Dashboard compras                         (existente)
├── Órdenes de compra                         (existente)
├── Nueva OC                                  (existente)
└── Proveedores                               (existente)

OPERACIONES · SERVICIOS
├── Dashboard servicio                        (existente)
├── Órdenes de servicio                       (existente)
├── Nueva OS                                  (existente)
└── Clientes (OS)                             (existente)

COMERCIAL · CRM
├── Contactos                                 (existente, Clientify)
└── Pipeline                                  (existente, Clientify)

FACTURACIÓN  ← DOMINIO NUEVO
├── Dashboard facturación                     (existente /billing — re-shell)
├── Facturas emitidas                         (sub-tab)
├── Recurrentes                               🆕  /billing/recurrentes
├── Clientes (cuenta corriente)               🆕  /billing/clientes
├── Cobros                                    🆕  /billing/cobros
└── Vencimientos                              🆕  /billing/vencimientos

COMPLIANCE · ANMAT
├── ANMAT cockpit                             (existente)
├── Centro documental                         (existente)
└── Drive TOPS                                (existente, READY)

SEGURIDAD · CCTV
└── Centro de monitoreo                       (existente)

ANALYTICS & FINANZAS
└── Reportes                                  (existente, esqueleto)

SISTEMA
├── Roles & permisos
├── Usuarios
├── Plantillas OS
└── Configuración
```

### 1.2 Refactor del `/billing` actual

`src/app/(app)/billing/page.tsx` actual = listado simple de facturas.
Propuesta: convertir `/billing` en **shell con tabs** que comparta header + side-card de KPIs.

```
/billing/
├── page.tsx               → shell con tabs "Emitidas | Recurrentes | Clientes | Cobros | Vencimientos"
├── emitidas/page.tsx      → listado actual (movido)
├── recurrentes/
│   ├── page.tsx           → lista de contratos
│   ├── nuevo/page.tsx     → wizard nuevo contrato
│   ├── [id]/page.tsx      → detalle + lines + runs
│   └── [id]/editar/...
├── clientes/
│   ├── page.tsx           → tabla de clientes con saldo
│   └── [clientId]/page.tsx → cuenta corriente del cliente
├── cobros/
│   ├── page.tsx           → lista de cobros
│   ├── nuevo/page.tsx     → wizard nuevo cobro
│   └── [id]/page.tsx      → detalle + aplicaciones
└── vencimientos/page.tsx  → bucket morosidad
```

---

## 2 · Wireframes funcionales

### 2.1 `/billing` — shell + dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Topbar TOPS NEXUS · OPERATING SYSTEM        🔍 buscar...        + Nueva OC  │
├─────────────────────────────────────────────────────────────────────────────┤
│ [eyebrow] FACTURACIÓN · CUENTA CORRIENTE                                    │
│ Dashboard facturación                                  [Exportar][+ Factura]│
│ MRR actual $X • Cobranza pendiente $Y • Clientes morosos N                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌──────────────┐ │
│  │ FACT. MES      │ │ COBRADO MES    │ │ PENDIENTE      │ │ MORA >30d    │ │
│  │ $ 8.450.000    │ │ $ 6.120.000    │ │ $ 2.330.000    │ │ $ 540.000    │ │
│  │ ↑12% vs mes ant│ │ ↑8% vs mes ant │ │ 27 facturas    │ │ 4 clientes   │ │
│  │ ▁▂▄▆▇ sparkline│ │ ▁▃▅▇ sparkline │ │                │ │              │ │
│  └────────────────┘ └────────────────┘ └────────────────┘ └──────────────┘ │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│   Emitidas  │ Recurrentes │ Clientes │ Cobros │ Vencimientos                │
│  ═══════════╧═════════════╧══════════╧════════╧═══════════════════════════ │
│                                                                              │
│  [el contenido del tab activo va acá]                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Componentes reusados:** `page-header`, `eyebrow-tiny`, `kpi` card, `Sparkline`, tabs (CSS).

### 2.2 Tab "Recurrentes" — lista de contratos

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Contratos recurrentes                                     [+ Nuevo contrato] │
│ 14 activos · 3 borradores · 1 pausado · 2 finalizados                       │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Todos] [Activos] [Borradores] [Pausados] [Finalizados]                      │
│                                                                               │
│ 🔍 Buscar por cliente, código, concepto...               Filtros▾  Export▾  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│ Código          Cliente             Concepto         Total/mes  Próximo   ⚙  │
│ ─────────────────────────────────────────────────────────────────────────── │
│ C-ANMAT-22M2-   BIDCOM S.A.        Almacenaje       USD 1.100   01/Jun  ●Activo│
│ BIDCOM-2026                         ANMAT 22m²       $ 1.430.000             │
│                                                                               │
│ C-ANMAT-100M2-  Lab. BAGÓ          Almacenaje       USD 5.000   01/Jun  ●Activo│
│ BAGÓ-2026                           ANMAT 100m²      $ 6.500.000             │
│                                                                               │
│ C-OFI-NEXUS     Empresa X          Oficina priv.    $ 320.000   01/Jun  ●Activo│
│ ...                                                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

Cada fila → click abre detalle.
Badge estado: `●Activo` verde, `○Borrador` gris, `❚❚Pausado` amarillo, `■Finalizado` neutral.

### 2.3 Tab "Recurrentes" — Wizard nuevo contrato

Patrón inspirado en `NewPoWizard.tsx` (compras/nueva).

```
Paso 1 de 5 — Cliente
─────────────────────
🔍 Buscar cliente existente...

[card con info del cliente seleccionado]
Razón Social: ...
CUIT: ...
Condición IVA: ...
Email facturación: ...

[Siguiente →]


Paso 2 de 5 — Frecuencia y plazos
──────────────────────────────────
Frecuencia:  ◉ Mensual  ○ Trimestral  ○ Semestral  ○ Anual

Día de corte (1-28):  [1▼]

Fecha de inicio:    [📅 01/Jun/2026]
Fecha de fin:       [📅 --/----/----]  ☐ Indefinido

Condición de pago:  [30 días ▼]
  └── (preview: vence 01/Jul/2026)

☐ Auto-emisión (sin revisión manual)
   ⚠ Recomendado solo para clientes confiables y montos consistentes

[← Atrás]                              [Siguiente →]


Paso 3 de 5 — Conceptos a facturar
───────────────────────────────────
+ Agregar concepto

┌──────────────────────────────────────────────────────────────┐
│ N° │ Descripción          │ Cat.    │ Cant. │ Precio │ Sub   │
│ 01 │ Almacenaje ANMAT     │ ANMAT▼  │  22.0 │ USD 50 │ U$1.100│
│ 02 │ Cinta perimetral     │ OTRO▼   │   1.0 │ USD 200│ U$ 200 │
└──────────────────────────────────────────────────────────────┘

Moneda contrato: ◉ USD  ○ ARS
Cotización al emitir: [BCRA Oficial ▼]   (fallback: fijo $1.250)

Total estimado/mes: USD 1.300 (~ $ 1.690.000 hoy)
IVA 21%:                       ~ $   354.900
TOTAL:                         ~ $ 2.044.900

[← Atrás]                              [Siguiente →]


Paso 4 de 5 — Punto de venta + ARCA
─────────────────────────────────────
Punto de venta:    [PV 3 — Web Service Nexus ▼]
Tipo comprobante:  [Factura A ▼]
                   (calculado de: VEROTIN RI ⇄ cliente RI)

Concepto ARCA:     ◉ Servicios  ○ Productos  ○ Ambos

Período de servicio:  ◉ Mes calendario natural
                       ○ Días desde inicio (lectura del 1° del mes)

[← Atrás]                              [Siguiente →]


Paso 5 de 5 — Revisión y confirmación
──────────────────────────────────────
Resumen:
  Cliente:           BIDCOM S.A.
  Código:            C-ANMAT-22M2-BIDCOM-2026
  Frecuencia:        Mensual (día 1)
  Inicio:            01/Jun/2026
  Fin:               indefinido
  Conceptos:         2 líneas
  Total estimado:    USD 1.300/mes
  Próxima emisión:   01/Jun/2026 09:00 ART (cron auto)

Estado al guardar:
  ◉ Crear como BORRADOR (revisar y activar después)
  ○ Crear y ACTIVAR

[← Atrás]                              [✓ Guardar contrato]
```

### 2.4 Tab "Recurrentes" — Detalle de un contrato

```
[← Volver]   C-ANMAT-22M2-BIDCOM-2026     [●Activo ▼]   [⚙ Acciones▾]

┌──────────────────────────────────────────────────────────────────────────────┐
│ BIDCOM S.A. · CUIT 30-12345678-9 · Resp. Inscripto                          │
│ Frecuencia: Mensual · Día 1 · Próximo run: 01/Jun/2026                       │
│ Condición pago: 30 días · Moneda: USD · Cotización: BCRA Oficial            │
└──────────────────────────────────────────────────────────────────────────────┘

  Líneas │ Historial │ Runs │ Facturas │ Auditoría
  ═══════╧═══════════╧══════╧══════════╧══════════

[Tab Líneas]
┌───────────────────────────────────────────────────────────────────────────┐
│ + Agregar línea                                                          │
│                                                                            │
│ N° │ Descripción           │ Cat.   │ Cant.│ Precio│ IVA% │ Subt   │ ⚙  │
│ 01 │ Almacenaje ANMAT      │ ANMAT  │ 22.0 │ U$ 50 │ 21   │U$1.100 │ ✏️🗑│
│ 02 │ Cinta perimetral      │ OTRO   │  1.0 │ U$200 │ 21   │U$  200 │ ✏️🗑│
└───────────────────────────────────────────────────────────────────────────┘

[Tab Runs]
┌────────────────────────────────────────────────────────────────────────────┐
│ Período │ Run Date │ Status │ Factura          │ Total      │ Trigger    │
│ 2026-05 │ 01/May   │ ●OK    │ FC A 0003-00347  │$1.420.000  │ CRON       │
│ 2026-04 │ 01/Apr   │ ●OK    │ FC A 0003-00298  │$1.380.000  │ CRON       │
│ 2026-03 │ 01/Mar   │ ●OK    │ FC A 0003-00256  │$1.310.000  │ CRON       │
│ ...                                                                        │
└────────────────────────────────────────────────────────────────────────────┘

⚙ Acciones del contrato:
  • Pausar
  • Reanudar
  • Cancelar (definitivo)
  • Disparar run manual (genera próxima factura ahora)
  • Duplicar a nuevo contrato
  • Exportar PDF del contrato
```

### 2.5 Tab "Clientes" — cuenta corriente lista

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Cuentas corrientes                                       Total saldo: $ 8.7M │
│ 32 clientes activos · 4 morosos >30d                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ [Todos] [Con saldo] [Al día] [Morosos] [Stop billing]                       │
│                                                                              │
│ 🔍 Buscar cliente...                                       Filtros▾  Export▾│
├─────────────────────────────────────────────────────────────────────────────┤
│ Cliente              │ Saldo $    │ Vencido  │ 30-60d  │ 60-90d │ +90d │ ⚙ │
│ ──────────────────────────────────────────────────────────────────────────  │
│ BIDCOM S.A.          │ 1.420.000  │ 200.000  │   0     │   0    │  0   │ ✓│
│ Laboratorios Bagó    │ 6.500.000  │   0      │   0     │   0    │  0   │ ✓│
│ Distrib. Norte       │   800.000  │ 240.000  │ 240.000 │   0    │  0   │ ⚠│
│ Mercado Libre        │   0        │   0      │   0     │   0    │  0   │ ✓│
│ ...                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

Click en row → `/billing/clientes/[clientId]`

### 2.6 `/billing/clientes/[clientId]` — Cuenta corriente del cliente

```
[← Volver]  BIDCOM S.A.                              [✏️ Editar config] [+ Cobro]

┌──────────────────────────────────────────────────────────────────────────────┐
│  SALDO ACTUAL                              VENCIMIENTOS                       │
│  $ 1.420.000                                                                  │
│  ↑ +5.2% vs mes anterior                  30 días:    $   200.000             │
│                                            60 días:    $         0             │
│  Límite crédito: $ 3.000.000               90 días:    $         0             │
│  Disponible:     $ 1.580.000               +90 días:   $         0             │
│                                                                                │
│  Último cobro:    15/May ($ 800.000)       Total vencido: $ 200.000           │
│  Última factura:  01/May ($ 1.420.000)                                        │
└──────────────────────────────────────────────────────────────────────────────┘

  Movimientos │ Facturas │ Cobros │ Contratos │ Auditoría
  ════════════╧══════════╧════════╧═══════════╧══════════

[Tab Movimientos] (default)
┌──────────────────────────────────────────────────────────────────────────────┐
│ Fecha    │ Tipo        │ Detalle                  │ Débito   │ Crédito │ Saldo│
│ ────────────────────────────────────────────────────────────────────────────  │
│ 15/May   │ Cobro       │ Transf. Galicia ref 81928│          │800.000  │ 1.42M│
│ 01/May   │ Factura     │ FC A 0003-00347 · 2026-05│ 1.420.000│         │ 2.22M│
│ 28/Abr   │ Cobro       │ Cheque B/Macro #4421     │          │700.000  │ 0.80M│
│ 01/Abr   │ Factura     │ FC A 0003-00298 · 2026-04│ 1.380.000│         │ 1.50M│
│ ...                                                                            │
└──────────────────────────────────────────────────────────────────────────────┘

[Tab Facturas]
similar a /billing emitidas pero filtrado por client_id

[Tab Cobros]
listado de payments + apps

[Tab Contratos]
recurring_contracts del cliente con estado, próximo run, total mensual

[Tab Auditoría]
customer_transactions append-only sin agrupar
```

### 2.7 `/billing/cobros` — nuevo cobro (wizard 3 pasos)

```
Paso 1 de 3 — Cliente y cobro
──────────────────────────────
Cliente:    [🔍 BIDCOM S.A. ▼]

Saldo actual del cliente:  $ 1.420.000
Vencido:                   $   200.000

Fecha de cobro:    [📅 28/May/2026]
Monto:             [$ 800.000______]
Moneda:            ◉ ARS  ○ USD ($/USD: 1.250)

Medio de pago:     [Transferencia ▼]
Banco origen:      [Galicia ▼]
Referencia:        [81928_________________]

Comprobante PDF:   [📎 Subir PDF (opcional)]

[Siguiente →]


Paso 2 de 3 — Aplicar a facturas
────────────────────────────────
Monto disponible para aplicar:  $ 800.000

Facturas pendientes del cliente:

  ☐ FC A 0003-00256 · 2026-03 · Vence 31/Mar · Pendiente: $ 240.000  [Aplicar: $___]
  ☐ FC A 0003-00298 · 2026-04 · Vence 30/Apr · Pendiente: $ 380.000  [Aplicar: $___]
  ☐ FC A 0003-00347 · 2026-05 · Vence 31/May · Pendiente: $ 800.000  [Aplicar: $___]
  ☐ FC A 0003-00388 · 2026-05 · Vence 31/May · Pendiente: $   0      [-]

  Auto-aplicar FIFO (más vieja primero)  [✓ Sugerir]

Aplicado:     $ 800.000
Anticipo:     $       0

[← Atrás]                              [Siguiente →]


Paso 3 de 3 — Revisión
──────────────────────
Cliente:        BIDCOM S.A.
Cobro:          $ 800.000 ARS
Medio:          Transferencia Galicia ref 81928
Aplicado a:     FC A 0003-00256 ($240k) + FC A 0003-00298 ($380k) + parte FC A 0003-00347 ($180k)

Saldo cliente post-cobro:  $ 620.000

[← Atrás]                              [✓ Confirmar cobro]
```

### 2.8 `/billing/vencimientos` — bucket de morosidad

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Vencimientos                                            Total vencido: $ 1.2M │
│ 12 facturas vencidas · 8 clientes con deuda                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ 🚨 CRÍTICO     ⚠️ ATENCIÓN    📅 PRÓXIMOS                                    │
│ +90 días        60-90 d        ≤ 30 d                                         │
│ $   0           $ 240.000      $ 540.000                                      │
│ 0 facturas      1 factura      4 facturas                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│ ─── 🚨 CRÍTICO +90 DÍAS ────────────────────────────────────────────────────  │
│   (vacío)                                                                      │
│                                                                                │
│ ─── ⚠️ ATENCIÓN 60-90 DÍAS ────────────────────────────────────────────────── │
│   FC A 0003-00256 · BIDCOM S.A. · Vence 31/Mar/2026 · 60 días · $ 240.000   │
│     [Enviar recordatorio] [Aplicar mora] [Ver factura]                       │
│                                                                                │
│ ─── 📅 PRÓXIMOS A VENCER ≤ 7 DÍAS ─────────────────────────────────────────── │
│   FC A 0003-00347 · BIDCOM S.A. · Vence 31/May/2026 · 3 días · $ 800.000     │
│   ...                                                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.9 Configuración global de facturación (en `/settings`)

```
/settings/facturacion
├── Punto de venta default
├── Condiciones de pago (CRUD)         [Tabla payment_terms]
├── Reglas de mora (CRUD)              [Tabla late_fee_rules]
├── Auto-aplicación de cobros (FIFO/LIFO/Manual)
├── Cron de facturación recurrente
│   ├── Hora del día (default: 09:00 ART)
│   └── Notificaciones a Ruth tras runs OK/FAILED
└── Datos fiscales empresa             [Tabla fiscal_config]  (ya existente)
```

---

## 3 · Componentes UI nuevos a construir

| Componente | Propósito | Reusable |
|------------|-----------|----------|
| `<RecurringContractWizard>` | 5-step wizard nuevo contrato | sí |
| `<RecurringLineEditor>` | Inline editor de líneas con cálculo live | sí |
| `<CustomerAccountSummary>` | Card grande del header de CC | sí |
| `<AgedReceivablesTable>` | Tabla de saldos por bucket de mora | sí |
| `<TransactionLedger>` | Tabla append-only con tipos coloridos | sí |
| `<PaymentWizard>` | 3-step wizard de cobros | sí |
| `<PaymentApplicationTable>` | Tabla de facturas pendientes con monto a aplicar | sí |
| `<DueDateBucket>` | Card por bucket (crítico/atención/próximo) | sí |
| `<RunStatusTimeline>` | Línea de tiempo de runs por contrato | sí |
| `<MRRWidget>` | Widget MRR/ARR para dashboard ejecutivo | sí |

---

## 4 · Dashboard ejecutivo — widgets nuevos

A agregar en `/ejecutivo` (sin tocar lo existente):

### 4.1 Card "Facturación del mes"

```
┌─────────────────────────────────┐
│ 💰 FACTURACIÓN MES              │
│                                  │
│ $ 8.450.000                     │
│ ↑ +12% vs mes ant.              │
│                                  │
│ ▁▂▄▆▇▇█  (últimos 7 meses)      │
└─────────────────────────────────┘
```

### 4.2 Card "Facturación futura proyectada"

```
┌─────────────────────────────────┐
│ 📅 PROYECCIÓN JUN-JUL-AGO       │
│                                  │
│ $ 28.5M proyectado              │
│                                  │
│ Recurrentes activos:  $ 24.3M   │
│ Estimado directas:    $  4.2M   │
└─────────────────────────────────┘
```

(Calculado de `recurring_contracts.lines × frequency` para los próximos 3 períodos.)

### 4.3 Card "MRR / ARR"

```
┌─────────────────────────────────┐
│ 📈 MRR / ARR                    │
│                                  │
│ MRR: $ 9.5M    (real-time)      │
│ ARR: $ 114M    (extrapolado)    │
│                                  │
│ ↑ +3 contratos este mes         │
│ ↓ -1 cancelado                  │
└─────────────────────────────────┘
```

### 4.4 Card "Cobranza pendiente"

```
┌─────────────────────────────────┐
│ ⏳ COBRANZA PENDIENTE           │
│                                  │
│ $ 2.330.000                     │
│ 27 facturas · 18 clientes       │
│                                  │
│ Vencido:        $    540.000    │
│ Por vencer ≤7d: $    820.000    │
│ Vigente:        $    970.000    │
└─────────────────────────────────┘
```

### 4.5 Card "Clientes morosos"

```
┌─────────────────────────────────┐
│ 🚨 CLIENTES MOROSOS             │
│                                  │
│ 4 clientes >30d                 │
│ Total mora:  $ 540.000          │
│                                  │
│ Top moroso:                      │
│ Distrib. Norte · $ 240k · 67d   │
│ [Ver detalle →]                  │
└─────────────────────────────────┘
```

Pattern visual: replica del **Compliance Alert Engine** ya hecho — colores semáforo (rojo/amarillo/verde).

### 4.6 Card "Ocupación ANMAT / General"

(Ya existe en `/operaciones/mapa` y `/ejecutivo` — sólo conectar al recurring_contracts:)

```
┌─────────────────────────────────┐
│ 📦 OCUPACIÓN ANMAT              │
│                                  │
│ Magaldi:   87% · $ 6.500/mes    │
│ Pedro de Luján: 61% · $ 2.100/mes│
│                                  │
│ Total m² facturables: 122       │
│ MRR ANMAT: $ 6.100/m²           │
└─────────────────────────────────┘
```

---

## 5 · Estados visuales y badges

| Estado | Badge | Color |
|--------|-------|-------|
| Contrato Activo | `●Activo` | verde (`badge-success`) |
| Contrato Borrador | `○Borrador` | gris (`badge-muted`) |
| Contrato Pausado | `❚❚Pausado` | amarillo (`badge-warning`) |
| Contrato Finalizado | `■Finalizado` | neutro |
| Contrato Cancelado | `✕Cancelado` | rojo claro (`badge-danger`) |
| Run OK | `✓OK` | verde |
| Run Pending | `⌛Pendiente` | amarillo |
| Run Failed | `✕Failed` | rojo |
| Run Skipped | `─Skipped` | gris |
| Run Manual Override | `⚒Manual` | azul |
| Payment Borrador | `○` | gris |
| Payment Confirmado | `●` | verde |
| Payment Anulado | `✕` | rojo |
| Mora 30-60d | semáforo amarillo |
| Mora 60-90d | semáforo naranja |
| Mora +90d | semáforo rojo |

---

## 6 · Microinteracciones (reusando capa premium ya hecha)

| Elemento | Animación reusada |
|----------|--------------------|
| Cards de KPI | `card-lift` (`globals.css`) |
| Botones primarios | `btn-shimmer` |
| Wizards | `nexus-page-fade` |
| Filas de tablas en hover | `transition-colors` existente |
| Score regulatorio de morosidad | `ce-ring-stroke` del Compliance Alert Engine — re-stylable |
| Sparklines | componente existente `<Sparkline>` |
| Loading inicial /billing | `loading.tsx` global (rebrandeado) |

---

## 7 · Accesibilidad y mobile

| Aspecto | Decisión |
|---------|----------|
| Mobile breakpoints | mantener actuales (`md:`, `lg:`) |
| Tablas en mobile | convertir a cards (pattern `tbl-mobile-cards` ya en `globals.css`) |
| Wizards en mobile | 1 step por pantalla full-height |
| Botones de acción primarios | sticky bottom en mobile |
| Confirmaciones destructivas | modal con texto a tipear (ej "CANCELAR-C-ANMAT-...") |
| Atajos teclado | `Cmd+K` para buscar (ya existe en topbar) |
| Lectores de pantalla | `aria-label` en badges, `role="status"` en KPI cards |
| Prefers-reduced-motion | respetado vía CSS existente |

---

## 8 · Decisiones explícitas de UX

| Decisión | Elegida | Alternativa |
|----------|---------|-------------|
| `/billing` es shell con tabs | Sí | múltiples páginas top-level — pierde unidad |
| Wizard para contrato nuevo (5 pasos) | Sí | form único — abruma |
| Auto-aplicación FIFO de cobros | Sí (sugerencia, modificable) | siempre manual — fricción |
| Auto-emisión opcional por contrato | Sí (flag `auto_emit`) | siempre manual — bottleneck Ruth |
| Score ring para morosidad | Sí (replica Compliance Engine) | tabla plana — menos visual |
| Dashboard widgets agregados a `/ejecutivo` | Sí | nuevo `/finanzas` dashboard — más click |
| Modal confirmación con texto a tipear para cancelación | Sí | solo click — riesgo fat-finger |
| Notificaciones tras run del cron | Sí (a Ruth) | silencioso — falta visibilidad |
| Tab "Auditoría" en CC del cliente | Sí (vista append-only) | esconder — pierde compliance value |
| Sticky button "Cargar más" en lista | Sí — patrón ya en Drive Browser | scroll infinito puro |

---

## 9 · Recursos visuales necesarios

| Recurso | Estado | Notas |
|---------|--------|-------|
| Iconos `cash`, `receipt`, `invoice`, `recurring`, `due-date` | ❌ no existen en Icon.tsx | proponer SVGs nuevos (reusar Phosphor o Lucide) |
| Avatar default de cliente | ✅ ya hay | reusar |
| Logo PDF para recibos | ✅ existe | reusar |
| Plantilla email "recibo de cobro" | ❌ | proponer template MJML reusando service email existente |

---

## 10 · Casos de uso de TOPS aplicados

### 10.1 ANMAT — BIDCOM 22 m² × USD 50

- Cliente: BIDCOM S.A.
- Contrato: `C-ANMAT-22M2-BIDCOM-2026`
- Frecuencia: MENSUAL, día 1
- Línea 1: categoría `ALMACENAJE_ANMAT` · "Almacenaje ANMAT 22 m² · Magaldi" · cant 22 · precio USD 50 · IVA 21%
- Currency: USD · cotización: BCRA_OFICIAL al día de emisión
- Auto-emit: false (Ruth revisa)
- Próximo run: 01/Jun/2026 09:00 ART
- Factura generada: tipo A, PV 3, ARCA WS

### 10.2 Cargas Generales — Distrib. Norte 100 m² × USD 10

- Cliente: Distribuidora Norte
- Contrato: `C-GRAL-100M2-DNORTE-2026`
- Línea 1: categoría `ALMACENAJE_GRAL` · 100 m² · USD 10 · IVA 21%
- Resto idem

### 10.3 Oficina privada · abono fijo $320.000/mes ARS

- Cliente: Empresa X
- Línea 1: categoría `OFICINA` · "Oficina privada Nexus" · cant 1 · precio ARS 320.000 · IVA 21%
- Currency: PES · cotización: N/A
- Auto-emit: true (monto consistente)

### 10.4 Coworking · abono $80.000/mes ARS

- Idem oficina pero categoría `COWORK`

---

## Restricciones honradas

- 🛑 NO IMPLEMENTAR UI · diseño puro
- 🛑 NO TOCAR componentes existentes
- 🛑 NO MODIFICAR rutas vivas
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 Reutilización de componentes/clases CSS marcada explícitamente para no duplicar
