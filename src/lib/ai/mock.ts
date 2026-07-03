// F5.2-lite · Fixtures de demo mode (isMock) — datos FICTICIOS para evaluar la
// UI y correr E2E sin DB ni provider real. Patrón mock.ts de connect/knowledge.

import type { ToolName } from "./types";

type Row = Record<string, unknown>;

export const MOCK_TOOL_ROWS: Record<ToolName, Row[]> = {
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
    {
      public_id: "CTR-2024-014",
      razon_social: "Distribuidora Ficticia SRL",
      tipo: "locacion",
      estado: "vigente",
      fecha_firma: "2024-03-10",
      fecha_inicio: "2024-04-01",
      fecha_fin: "2026-09-30",
      dias_para_vencer: 89,
      detalle: "Contrato · locacion · estado vigente · firmado 2024-03-10 · vence 2026-09-30",
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
};
