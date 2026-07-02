// Nexus Link · seeds MOCK del Centro de Incidentes (F4.2). Mismo criterio que mock.ts:
// la capa de lectura devuelve estas constantes cuando isMock() es true. La conversación
// c-inc-1 (mock.ts) es el hilo del primer incidente.

import type { Incident } from "./types";
import { MOCK_CURRENT_USER_ID, MOCK_USERS } from "./mock";

const NOW = "2026-06-30T12:00:00.000Z";
const T = (mins: number) => new Date(Date.parse(NOW) - mins * 60_000).toISOString();

export const MOCK_INCIDENTS: Incident[] = [
  {
    id: "inc-1",
    publicId: "INC-2026-0001",
    conversationId: "c-inc-1",
    titulo: "Avería montacargas sector D4",
    sector: "D4",
    ubicacion: "MAGALDI_1765 · pasillo 3",
    tipoAveria: "Equipo de elevación",
    severidad: "alta",
    estado: "en_progreso",
    reportadoPor: MOCK_USERS.u3.id,
    asignadoA: MOCK_CURRENT_USER_ID,
    reportadoPorName: MOCK_USERS.u3.name,
    asignadoAName: MOCK_USERS[MOCK_CURRENT_USER_ID].name,
    slaDueAt: null,
    resueltoAt: null,
    resolucionText: null,
    createdAt: T(200),
    updatedAt: T(120),
  },
  {
    id: "inc-2",
    publicId: "INC-2026-0002",
    conversationId: "c-inc-2",
    titulo: "Corte de energía en cámara de frío 2",
    sector: "CF2",
    ubicacion: "PEDRO_LUJAN_3159",
    tipoAveria: "Suministro eléctrico",
    severidad: "critica",
    estado: "abierto",
    reportadoPor: MOCK_USERS.u2.id,
    asignadoA: null,
    reportadoPorName: MOCK_USERS.u2.name,
    asignadoAName: null,
    slaDueAt: null,
    resueltoAt: null,
    resolucionText: null,
    createdAt: T(45),
    updatedAt: T(45),
  },
  {
    id: "inc-3",
    publicId: "INC-2026-0003",
    conversationId: "c-inc-3",
    titulo: "Pallet dañado en recepción",
    sector: "REC",
    ubicacion: "MAGALDI_1765 · dock 1",
    tipoAveria: "Mercadería",
    severidad: "baja",
    estado: "resuelto",
    reportadoPor: MOCK_USERS.u4.id,
    asignadoA: MOCK_USERS.u3.id,
    reportadoPorName: MOCK_USERS.u4.name,
    asignadoAName: MOCK_USERS.u3.name,
    slaDueAt: null,
    resueltoAt: T(600),
    resolucionText: "Se repaletizó la mercadería y se documentó el daño con fotos para el cliente.",
    createdAt: T(1440),
    updatedAt: T(600),
  },
];
