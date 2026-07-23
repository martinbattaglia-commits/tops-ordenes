// Nexus Link · seeds MOCK del Centro de Tareas (F4.3). Mismo criterio que
// incidents-mock.ts: la capa de lectura devuelve estas constantes con isMock().

import type { Task, WorkflowTemplate } from "./types";
import { MOCK_CURRENT_USER_ID, MOCK_USERS } from "./mock";

const NOW = "2026-06-30T12:00:00.000Z";
const T = (mins: number) => new Date(Date.parse(NOW) - mins * 60_000).toISOString();
const IN = (mins: number) => new Date(Date.parse(NOW) + mins * 60_000).toISOString();

export const MOCK_TASKS: Task[] = [
  {
    id: "tsk-1",
    publicId: "TSK-2026-0001",
    titulo: "Reparar portón del dock 2",
    descripcion: "Surgió del incidente del montacargas: el portón quedó desalineado.",
    estado: "en_progreso",
    prioridad: "alta",
    dueAt: IN(60 * 24),
    creadoPor: MOCK_USERS.u3.id,
    asignadoA: MOCK_CURRENT_USER_ID,
    creadoPorName: MOCK_USERS.u3.name,
    asignadoAName: MOCK_USERS[MOCK_CURRENT_USER_ID].name,
    conversationId: "c-inc-1", // demo: reusa un hilo existente para render
    incidentId: "inc-1",
    workflowInstanceId: null,
    stepNo: null,
    area: null,
    cancelReason: null,
    completedAt: null,
    createdAt: T(300),
    updatedAt: T(60),
  },
  {
    id: "tsk-2",
    publicId: "TSK-2026-0002",
    titulo: "Registrar acciones correctivas",
    descripcion: "Paso 1 del workflow Seguimiento post-incidente.",
    estado: "pendiente",
    prioridad: "media",
    dueAt: IN(60 * 24 * 2),
    creadoPor: MOCK_USERS.u2.id,
    asignadoA: null, // vacante: reclamable
    creadoPorName: MOCK_USERS.u2.name,
    asignadoAName: null,
    conversationId: null,
    incidentId: null,
    workflowInstanceId: "wfi-1",
    stepNo: 1,
    area: "operaciones",
    cancelReason: null,
    completedAt: null,
    createdAt: T(120),
    updatedAt: T(120),
  },
  {
    id: "tsk-3",
    publicId: "TSK-2026-0003",
    titulo: "Actualizar cartelería de seguridad",
    descripcion: null,
    estado: "completada",
    prioridad: "baja",
    dueAt: T(60 * 24),
    creadoPor: MOCK_CURRENT_USER_ID,
    asignadoA: MOCK_USERS.u4.id,
    creadoPorName: MOCK_USERS[MOCK_CURRENT_USER_ID].name,
    asignadoAName: MOCK_USERS.u4.name,
    conversationId: null,
    incidentId: null,
    workflowInstanceId: null,
    stepNo: null,
    area: null,
    cancelReason: null,
    completedAt: T(30),
    createdAt: T(60 * 48),
    updatedAt: T(30),
  },
];

export const MOCK_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "wft-1",
    nombre: "Seguimiento post-incidente",
    descripcion: "Acciones correctivas, verificación y cierre informativo.",
    activo: true,
    steps: [
      { stepNo: 1, titulo: "Registrar acciones correctivas", rolSugerido: "operaciones" },
      { stepNo: 2, titulo: "Verificar normalización del sector", rolSugerido: "supervisor" },
      { stepNo: 3, titulo: "Informar cierre a Dirección", rolSugerido: "admin" },
    ],
  },
  {
    id: "wft-2",
    nombre: "Preparación de documentación entre áreas",
    descripcion: "Reunir, revisar y distribuir documentación operativa.",
    activo: true,
    steps: [
      { stepNo: 1, titulo: "Reunir documentación del caso", rolSugerido: "operaciones" },
      { stepNo: 2, titulo: "Revisión y visto bueno", rolSugerido: "supervisor" },
      { stepNo: 3, titulo: "Archivo y distribución interna", rolSugerido: "admin" },
    ],
  },
];
