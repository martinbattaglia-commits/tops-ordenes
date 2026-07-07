// F5.2-lite · Fixtures de demo mode (isMock) — datos FICTICIOS para evaluar la
// UI y correr E2E sin DB ni provider real. Patrón mock.ts de connect/knowledge.

import type { ToolName } from "./types";

type Row = Record<string, unknown>;

// Partial: las tools LOCALES (resolve, p.ej. organization_overview) no leen de acá
// —resuelven datos estáticos del repo—, así que no necesitan fixture de demo.
export const MOCK_TOOL_ROWS: Partial<Record<ToolName, Row[]>> = {
  search_knowledge: [
    {
      entity_type: "connect_incident",
      entity_id: "demo-inc-1",
      public_id: "INC-2026-0001",
      title: "Corte de energía en cámara 3",
      excerpt: "Incidente crítico reportado en MAGALDI. Generador en marcha.",
      status: "abierto",
      entity_date: "2026-07-02T14:10:00Z",
      rank: 0.9,
    },
    {
      entity_type: "connect_task",
      entity_id: "demo-tsk-2",
      public_id: "TSK-2026-0002",
      title: "Auditar temperatura cámara 3",
      excerpt: "Tarea derivada del incidente INC-2026-0001.",
      status: "pendiente",
      entity_date: "2026-07-02T15:00:00Z",
      rank: 0.7,
    },
  ],
  connect_search: [
    {
      result_type: "message",
      conversation_id: "demo-conv-1",
      title: "Operaciones MAGALDI",
      snippet: "Se restableció la energía, monitoreando temperatura…",
      entity_type: "connect_message",
      entity_ref: "demo-msg-1",
      occurred_at: "2026-07-02T16:20:00Z",
    },
  ],
  incidents_overview: [
    {
      public_id: "INC-2026-0001",
      titulo: "Corte de energía en cámara 3",
      sector: "Cámara 3",
      severidad: "critica",
      estado: "abierto",
      asignado: "Cynthia Alba",
      sla_due_at: "2026-07-03T14:00:00Z",
      created_at: "2026-07-02T14:10:00Z",
    },
    {
      public_id: "INC-2026-0002",
      titulo: "Diferencia de stock en picking",
      sector: "Depósito PL",
      severidad: "media",
      estado: "en_progreso",
      asignado: "Martin Rinas",
      created_at: "2026-07-01T10:00:00Z",
    },
  ],
  tasks_overview: [
    {
      public_id: "TSK-2026-0002",
      titulo: "Auditar temperatura cámara 3",
      estado: "pendiente",
      prioridad: "urgente",
      due_at: "2026-07-02T18:00:00Z",
      asignado: "Ruth Carrasquero",
      incident_public_id: "INC-2026-0001",
      created_at: "2026-07-02T15:00:00Z",
    },
    {
      public_id: "TSK-2026-0003",
      titulo: "Actualizar checklist ANMAT sede Magaldi",
      estado: "en_progreso",
      prioridad: "alta",
      asignado: "Cynthia Alba",
      workflow: "Alta de habilitación",
      created_at: "2026-06-30T09:00:00Z",
    },
  ],
  workflows_stuck: [
    {
      workflow: "Alta de habilitación",
      current_step: 2,
      step_titulo: "Presentación de expediente",
      task_public_id: "TSK-2026-0003",
      task_estado: "en_progreso",
      idle_days: 4,
      iniciado: "2026-06-25T12:00:00Z",
    },
  ],
  entity_timeline: [
    {
      event_type: "incident.created",
      occurred_at: "2026-07-02T14:10:00Z",
      actor_label: "Cynthia Alba",
      summary: "Incidente INC-2026-0001 creado con severidad crítica.",
    },
    {
      event_type: "incident.assigned",
      occurred_at: "2026-07-02T14:25:00Z",
      actor_label: "Dirección",
      summary: "Asignado a mantenimiento; generador encendido.",
    },
  ],
  entity_360: [
    {
      event_type: "incident.created",
      occurred_at: "2026-07-02T14:10:00Z",
      actor_label: "Cynthia Alba",
      summary: "Incidente INC-2026-0001 creado con severidad crítica.",
      concept_label: "cadena de frío",
      concept_kind: "riesgo",
    },
  ],
  compliance_pending: [
    {
      kind: "documento",
      ref: "MAG-04",
      titulo: "Habilitación municipal Magaldi",
      estado: "por_vencer",
      riesgo: "alto",
      fecha_clave: "2026-08-15",
      detalle: "Habilitaciones",
    },
  ],
  contracts_overview: [
    // Paridad demo/real (smoke 2026-07-07): la primera fila es la firmada más
    // reciente (la RPC ordena firmados_recientes por firma desc) y las tres filas
    // cubren la escalera documental completa: archivo Drive / carpeta / sin vínculo.
    {
      public_id: "CTR-2026-001",
      razon_social: "Distribuidora Ficticia SRL",
      tipo: "ANMAT",
      estado: "vigente",
      fecha_firma: "2026-05-21",
      fecha_inicio: "2026-06-01",
      fecha_fin: "2028-05-31",
      dias_para_vencer: 694,
      detalle: "Contrato · ANMAT · estado vigente · firmado 2026-05-21 · vence 2028-05-31",
      file_url: "https://drive.google.com/file/d/demo-contrato-001/view",
    },
    {
      public_id: "CTR-2024-014",
      razon_social: "Logística Ejemplo SA",
      tipo: "Cargas Generales",
      estado: "vigente",
      fecha_firma: "2024-03-10",
      fecha_inicio: "2024-04-01",
      fecha_fin: "2026-09-30",
      dias_para_vencer: 89,
      detalle: "Contrato · Cargas Generales · estado vigente · firmado 2024-03-10 · vence 2026-09-30",
      folder_url: "https://drive.google.com/drive/folders/demo-carpeta-014",
    },
    {
      public_id: "CTR-2023-007",
      razon_social: "Depósitos Modelo SRL",
      tipo: "ANMAT",
      estado: "vigente",
      fecha_firma: "2023-11-02",
      fecha_inicio: "2023-12-01",
      fecha_fin: "2027-03-01",
      dias_para_vencer: 237,
      detalle: "Contrato · ANMAT · estado vigente · firmado 2023-11-02 · vence 2027-03-01",
    },
  ],
  docs_browse: [
    {
      entity_type: "compliance_documento",
      entity_id: "demo-cmp-1",
      public_id: "MAG-04#abc12345",
      title: "Habilitación municipal Magaldi",
      excerpt:
        "[ficha metadata] documento compliance cumplimiento · Habilitación municipal Magaldi · Habilitaciones · vencimiento vence 2026-08-15",
      status: null,
      entity_date: "2026-08-15T03:00:00Z",
      // demo del enrichment de Drive (ficticio).
      source_url: "https://drive.google.com/file/d/demo-file-id/view",
    },
  ],
  clients_health: [
    { cliente: "Cliente Demo SA", incidentes_abiertos: 2, tareas_abiertas: 3, total_abiertos: 5 },
    { cliente: "Distribuidora Ficticia SRL", incidentes_abiertos: 1, tareas_abiertas: 0, total_abiertos: 1 },
  ],
  ops_digest: [
    {
      event_type: "task.completed",
      entity_type: "connect_task",
      entity_id: "demo-tsk-9",
      summary: "Se completó la recepción de mercadería del turno mañana.",
      actor_label: "Depósito Magaldi",
      occurred_at: "2026-07-03T11:00:00Z",
    },
    {
      event_type: "incident.created",
      entity_type: "connect_incident",
      entity_id: "demo-inc-1",
      summary: "Incidente crítico en cámara 3 (corte de energía).",
      actor_label: "Cynthia Alba",
      occurred_at: "2026-07-02T14:10:00Z",
    },
  ],
  my_agenda: [
    {
      kind: "incidente",
      public_id: "INC-2026-0001",
      titulo: "Corte de energía en cámara 3",
      detalle: "Cámara 3",
      prioridad: "critica",
      fecha: "2026-07-03T14:00:00Z",
      created_at: "2026-07-02T14:10:00Z",
    },
    {
      kind: "notificacion",
      titulo: "Te mencionaron en Operaciones MAGALDI",
      detalle: "Revisá el hilo del incidente de la cámara.",
      prioridad: "alta",
      created_at: "2026-07-02T16:30:00Z",
    },
  ],
  // P2 (fix/f5-2): facturas emitidas / de proveedor / OC / proveedores (ficticio).
  customer_invoices_overview: [
    {
      public_id: "FACTURA_A 2-45",
      razon_social: "Distribuidora Ficticia SRL",
      total: "450000.00",
      fecha: "2026-07-01",
      estado: "AUTORIZADO_ARCA",
      detalle:
        "Factura · cliente Distribuidora Ficticia SRL · total ARS 450.000,00 · estado ARCA AUTORIZADO_ARCA · emitida 2026-07-01",
    },
  ],
  supplier_invoices_overview: [
    {
      public_id: "FACTURA_A 00345",
      proveedor: "Insumos Demo SA",
      total: "12100.00",
      fecha: "2026-06-28",
      estado: "pendiente",
      detalle:
        "Factura de proveedor · Insumos Demo SA · total ARS 12.100,00 · estado pendiente · aprobación cargada · emitida 2026-06-28",
    },
  ],
  purchase_orders_overview: [
    {
      public_id: "OC-2026-0371",
      proveedor: "Insumos Demo SA",
      total: "89000.00",
      fecha: "2026-07-06",
      estado: "firmada",
      detalle:
        "Orden de compra · Insumos Demo SA · total ARS 89.000,00 · estado firmada · 2026-07-06",
    },
  ],
  suppliers_overview: [
    {
      public_id: "PROV#demo1234",
      razon: "Insumos Demo SA",
      categoria: "insumos",
      detalle: "Proveedor · categoría insumos · activo",
    },
  ],
  // fix/f5-2 · analytics (ficticio).
  // Slice B: mes EN CURSO (parcial, generado dinámicamente) + DOS meses cerrados
  // (orden desc, igual que la RPC). Habilita en demo la comparación m/m Y el caso
  // prod-crítico del review adversarial: mes parcial vs mes cerrado (el visual y
  // el brief deben declararlo, jamás fabricar una "caída"). El demoFilter de la
  // tool espeja el p_mode real de la RPC.
  billing_summary: [
    {
      periodo: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
      total: "1000000.00",
      cantidad: 1,
      desde: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`,
      hasta: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-07`,
      detalle:
        "Facturación del mes en curso (parcial) · total ARS 1,000,000.00 · 1 factura autorizada",
    },
    {
      periodo: "2026-06",
      total: "12500000.00",
      cantidad: 9,
      desde: "2026-06-01",
      hasta: "2026-06-30",
      detalle:
        "Facturación 2026-06 · total ARS 12,500,000.00 · 9 facturas autorizadas · del 2026-06-01 al 2026-06-30",
    },
    {
      periodo: "2026-05",
      total: "9800000.00",
      cantidad: 7,
      desde: "2026-05-01",
      hasta: "2026-05-31",
      detalle:
        "Facturación 2026-05 · total ARS 9,800,000.00 · 7 facturas autorizadas · del 2026-05-01 al 2026-05-31",
    },
  ],
  bank_balances_overview: [
    {
      bank_name: "Banco Santander",
      account_name: "Cuenta corriente",
      balance: "45000000.00",
      detalle: "Banco Santander · Cuenta corriente · saldo ARS 45,000,000.00 (derivado de movimientos)",
    },
    {
      bank_name: "Banco Galicia",
      account_name: "Cuenta corriente",
      balance: "12000000.00",
      detalle: "Banco Galicia · Cuenta corriente · saldo ARS 12,000,000.00 (derivado de movimientos)",
    },
  ],
  customer_revenue_overview: [
    {
      cliente: "Cliente Demo SA",
      total: "85000000.00",
      cantidad: 12,
      periodo: "todo",
      detalle:
        "Facturación por cliente · Cliente Demo SA · ARS 85,000,000.00 · 12 facturas autorizadas · período: todo",
    },
    {
      cliente: "Distribuidora Ficticia SRL",
      total: "41000000.00",
      cantidad: 6,
      periodo: "todo",
      detalle:
        "Facturación por cliente · Distribuidora Ficticia SRL · ARS 41,000,000.00 · 6 facturas autorizadas · período: todo",
    },
  ],
  vacancy_overview: [
    {
      alcance: "Corporativo",
      capacidad_m2: 10000,
      ocupado_m2: 6300,
      disponible_m2: 3700,
      vacancia_pct: 37,
      cubiculos_total: 26,
      cubiculos_disponibles: 9,
      cubiculos_alquilados: 17,
      detalle:
        "Capacidad corporativa · comercializable 10000 m² · ocupado 6300 m² · disponible 3700 m² · vacancia 37% · cubículos ANMAT: 17 alquilados de 26 (9 disponibles)",
    },
    {
      alcance: "ANMAT",
      capacidad_m2: 5200,
      ocupado_m2: 4000,
      disponible_m2: 1200,
      vacancia_pct: 23.1,
      detalle: "ANMAT · capacidad 5200 m² · disponible 1200 m² · vacancia 23.1%",
    },
    {
      alcance: "Cargas Generales",
      capacidad_m2: 3800,
      ocupado_m2: 1700,
      disponible_m2: 2100,
      vacancia_pct: 55.3,
      detalle: "Cargas Generales · capacidad 3800 m² · disponible 2100 m² · vacancia 55.3%",
    },
  ],
  revenue_by_category_report: [
    {
      categoria: "ANMAT",
      monto: "10000000.00",
      porcentaje: "80.0",
      cantidad: 6,
      total_periodo: "12500000.00",
      periodo: "ultimo_mes",
      detalle:
        "Ingresos ANMAT · ARS 10,000,000.00 · 80.0% del total ARS 12,500,000.00 · 6 facturas · método: tags de cliente",
    },
    {
      categoria: "Cargas Generales",
      monto: "1500000.00",
      porcentaje: "12.0",
      cantidad: 2,
      total_periodo: "12500000.00",
      periodo: "ultimo_mes",
      detalle:
        "Ingresos Cargas Generales · ARS 1,500,000.00 · 12.0% del total · 2 facturas · método: tags de cliente",
    },
    {
      categoria: "Sin clasificar",
      monto: "1000000.00",
      porcentaje: "8.0",
      cantidad: 1,
      total_periodo: "12500000.00",
      periodo: "ultimo_mes",
      detalle:
        "Ingresos Sin clasificar · ARS 1,000,000.00 · 8.0% del total · 1 factura · método: sin tag ni keyword (brecha de clasificación)",
    },
  ],
  // Slice B: fixtures por BASE y PERÍODO (el demoFilter de la tool espeja los
  // filtros p_base/p_periodo de la RPC). Habilita en demo: gasto vs compromiso,
  // variación m/m de proveedores y el fix del mislabel "gasto" → filas compromiso.
  supplier_spend_overview: [
    {
      proveedor: "Mobiliarios Demo SA",
      total: "580000000.00",
      cantidad: 3,
      periodo: "todo",
      base: "compromiso",
      detalle:
        "Presupuesto comprometido · Mobiliarios Demo SA · ARS 580,000,000.00 · 3 OC firmadas · período: todo",
    },
    {
      proveedor: "Insumos Demo SA",
      total: "1670000.00",
      cantidad: 1,
      periodo: "todo",
      base: "compromiso",
      detalle: "Presupuesto comprometido · Insumos Demo SA · ARS 1,670,000.00 · 1 OC firmada",
    },
    {
      proveedor: "Mobiliarios Demo SA",
      total: "3400000.00",
      cantidad: 4,
      periodo: "todo",
      base: "gasto",
      detalle: "Gasto · Mobiliarios Demo SA · ARS 3,400,000.00 · 4 comprobantes · período: todo",
    },
    {
      proveedor: "Insumos Demo SA",
      total: "1670000.00",
      cantidad: 2,
      periodo: "todo",
      base: "gasto",
      detalle: "Gasto · Insumos Demo SA · ARS 1,670,000.00 · 2 comprobantes · período: todo",
    },
    {
      // Con gasto pero SIN OC firmada asociada: la comparación gasto-vs-compromiso
      // lo muestra con compromiso 0 (declarado), nunca lo esconde.
      proveedor: "Logística Ejemplo SA",
      total: "450000.00",
      cantidad: 1,
      periodo: "todo",
      base: "gasto",
      detalle: "Gasto · Logística Ejemplo SA · ARS 450,000.00 · 1 comprobante · período: todo",
    },
    {
      proveedor: "Mobiliarios Demo SA",
      total: "1200000.00",
      cantidad: 2,
      periodo: "ultimo_mes",
      base: "gasto",
      detalle: "Gasto · Mobiliarios Demo SA · ARS 1,200,000.00 · 2 comprobantes · período: último mes",
    },
    {
      proveedor: "Insumos Demo SA",
      total: "800000.00",
      cantidad: 1,
      periodo: "ultimo_mes",
      base: "gasto",
      detalle: "Gasto · Insumos Demo SA · ARS 800,000.00 · 1 comprobante · período: último mes",
    },
    {
      proveedor: "Mobiliarios Demo SA",
      total: "1900000.00",
      cantidad: 1,
      periodo: "mes_actual",
      base: "gasto",
      detalle: "Gasto · Mobiliarios Demo SA · ARS 1,900,000.00 · 1 comprobante · período: mes en curso",
    },
    {
      proveedor: "Logística Ejemplo SA",
      total: "450000.00",
      cantidad: 1,
      periodo: "mes_actual",
      base: "gasto",
      detalle: "Gasto · Logística Ejemplo SA · ARS 450,000.00 · 1 comprobante · período: mes en curso",
    },
    {
      proveedor: "Insumos Demo SA",
      total: "640000.00",
      cantidad: 1,
      periodo: "mes_actual",
      base: "gasto",
      detalle: "Gasto · Insumos Demo SA · ARS 640,000.00 · 1 comprobante · período: mes en curso",
    },
  ],
};
