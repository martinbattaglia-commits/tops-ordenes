/**
 * Compliance Cockpit · Centro de Control Regulatorio Corporativo.
 *
 * FUENTE OFICIAL: auditoría regulatoria VEROTIN S.A. / Logística Tops del 08/06/2026
 * (COMPLIANCE-AUDIT-MASTER-REPORT). 33 ítems · 12 categorías · 2 sedes · 747 docs.
 * Los datos NO se asumen: surgen de la documentación auditada. Snapshot point-in-time.
 *
 * Hoy el cockpit lee de esta constante (operativo sin dependencia de DB). La migración
 * 0065_compliance_core.sql deja el modelo DB-backed listo para la futura ingesta automática
 * desde Drive (no implementada aún, sólo arquitectura).
 */

import type { ComplianceCaseLite, EstadoAdministrativo, Etapa, NivelRiesgo, Temporal } from "./cases/types";
import { computeSemaforo, temporalOf, resolveAnticipacion } from "./semaforo";

export type Riesgo = "Verde" | "Amarillo" | "Naranja" | "Rojo";
export type Sede = "MAGALDI" | "LUJAN";

export interface ComplianceItem {
  id: string;
  sede: Sede;
  categoria: string;
  documento: string;
  organismo: string;
  tipo: string;
  emision: string | null;
  vencimiento: string | null;
  frecuencia: string;
  estado: string;
  /** Semáforo (color). Lo computa deriveComplianceStatus; los consumidores lo leen como color. */
  riesgo: Riesgo;
  fuente: string;
  nota: string;
  docs: number;
  dias: number | null;
  venc_fmt: string;
  emi_fmt: string;
  /** Override de anticipación 🟡 (nivel más alto de la jerarquía D6). */
  anticipacion_dias?: number | null;
  /** Caso regulatorio activo asociado (si lo hay). Lo adjunta source.ts. */
  activeCase?: ComplianceCaseLite | null;
  /** Proyecciones del caso para la UI (las setea deriveComplianceStatus). */
  estadoAdministrativo?: EstadoAdministrativo | null;
  etapa?: Etapa | null;
  nivelRiesgo?: NivelRiesgo | null;
}

export const AUDIT_META = {
  fecha: "2026-06-08",
  empresa: "VEROTIN S.A. (Logística Tops)",
  cuit: "33-60489698-9",
  sedeCentral: "Agustín Magaldi 1765",
  sedeAnexa: "Pedro de Luján 3159",
  zona: "Barracas, CABA",
  docsTotal: 747,
  docsMagaldi: 389,
  docsLujan: 358,
} as const;

export const CATEGORIAS = [
  "Habilitación", "Impacto Ambiental", "Residuos", "Incendio", "Seguridad",
  "Simulacros", "Electricidad", "Plagas", "Agua", "Seguros", "ANMAT", "ACUMAR",
] as const;

/** Paleta de riesgo (semáforo). Constante por diseño (cockpit dark enterprise). */
export const RISK_HEX: Record<Riesgo, string> = {
  Verde: "#16a34a", Amarillo: "#d97706", Naranja: "#ea580c", Rojo: "#dc2626",
};
export const RISK_ORDER: Record<Riesgo, number> = { Rojo: 0, Naranja: 1, Amarillo: 2, Verde: 3 };
export const RISK_LABEL: Record<Riesgo, string> = {
  Verde: "Vigente", Amarillo: "Próximo a vencer", Naranja: "En trámite administrativo", Rojo: "Vencido / Falta",
};

export const ITEMS: ComplianceItem[] = [
  { id: "MAG-01", sede: "MAGALDI", categoria: "Habilitación", documento: "Habilitación Comercial / Ampliación (Depósito Primario 23.6)", organismo: "GCABA – Dir. Gral. de Habilitaciones y Permisos (DGHP/AGC)", tipo: "Disposición / Certificado", emision: "2022-09-26", vencimiento: null, frecuencia: "Permanente (actualización de datos s/ Ley 6.101 art.18)", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "DI-2022-11141-GCABA-DGHP. Ref 440047 (EX-2022-34281856). Plantas: Entrepiso, PA, PB. 16 operarios. Habilitación sin caducidad pero exige actualización periódica de datos.", docs: 11, dias: null, venc_fmt: "Sin venc.", emi_fmt: "26/09/2022" },
  { id: "MAG-02", sede: "MAGALDI", categoria: "Impacto Ambiental", documento: "Certificado de Aptitud Ambiental (CAA) – Ciudad", organismo: "GCABA – APRA / Dir. Gral. Evaluación Ambiental (DGEVA)", tipo: "Certificado (Ley 123) – SRE c/C", emision: "2025-04-09", vencimiento: "2029-04-09", frecuencia: "Renovación (CAA CABA ~4 años)", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "CE-2025-20530028-GCABA-DGEVA. Trámite 295517. Categorización Anexo VI – Sin Relevante Efecto con Condiciones.", docs: 33, dias: 1036, venc_fmt: "09/04/2029", emi_fmt: "09/04/2025" },
  { id: "MAG-03", sede: "MAGALDI", categoria: "Residuos", documento: "Generador de Residuos Peligrosos – Ciudad", organismo: "GCABA – APRA / DGEVA", tipo: "Certificado (Ley 2214 / Dec 2020-07)", emision: "2026-05-05", vencimiento: "2029-05-05", frecuencia: "Trianual (renovación)", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "CE-2026-21210993-GCABA-DGEVA. Actuación 14287. Categorías Y8 (aceites minerales) e Y12 (residuos de tintas/pinturas).", docs: 16, dias: 1062, venc_fmt: "05/05/2029", emi_fmt: "05/05/2026" },
  { id: "MAG-04", sede: "MAGALDI", categoria: "Residuos", documento: "Certificado Ambiental Anual (CAA) – Nación – Generador R. Peligrosos", organismo: "Min. Ambiente Nación – SCyMA / DNSyPQ (APN-MAD)", tipo: "Certificado Ambiental Anual (Ley 24.051 / Dec 831/93)", emision: "2022-10-06", vencimiento: "2023-10-06", frecuencia: "Anual", estado: "Vencido", riesgo: "Rojo", fuente: "Leído", nota: "CRÍTICO. CE-2022-106880370-APN-SCYMA#MAD. Renovación EN TRÁMITE (EX-2023-116887453). Certificado vencido hace ~2,5 años — exposición ante inspección nacional/ACUMAR.", docs: 54, dias: -976, venc_fmt: "06/10/2023", emi_fmt: "06/10/2022" },
  { id: "MAG-05", sede: "MAGALDI", categoria: "Incendio", documento: "Instalación Fija Contra Incendio (IFCI) – Oblea anual", organismo: "GCBA – Agencia Gubernamental de Control (AGC)", tipo: "Oblea de habilitación (Patente 1.898, Inst. 1 – Agua Nivel 3)", emision: "2026-01-01", vencimiento: "2026-12-31", frecuencia: "Oblea anual + mantenimiento mensual + control trimestral de hidrantes", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "Oblea AGC 'Año de Vigencia 2026'. Mantenimiento mensual al día (último informe Abril 2026). Renovar oblea 2027 en enero.", docs: 59, dias: 206, venc_fmt: "31/12/2026", emi_fmt: "01/01/2026" },
  { id: "MAG-06", sede: "MAGALDI", categoria: "Incendio", documento: "Prueba Hidráulica / Certificado de Mangas (hidrantes)", organismo: "Empresa especializada (matriculada)", tipo: "Certificado de prueba hidráulica de mangueras", emision: "2023-10-01", vencimiento: null, frecuencia: "Anual", estado: "No determinado", riesgo: "Amarillo", fuente: "Carpeta/filename", nota: "Último certificado de mangas completo: Octubre 2023. En 2025 sólo consta 'Retiro de mangueras' (sin certificado). Verificar pruebas 2024-2025-2026.", docs: 0, dias: null, venc_fmt: "Sin venc.", emi_fmt: "01/10/2023" },
  { id: "MAG-07", sede: "MAGALDI", categoria: "Seguridad", documento: "Matafuegos – Tarjetas de identificación + Control trimestral", organismo: "GCBA – AGC (tarjeta) / empresa recargadora habilitada", tipo: "Tarjeta de extintor + Planilla de control periódico", emision: "2025-07-01", vencimiento: "2026-07-31", frecuencia: "Recarga anual + control trimestral", estado: "Próximo a vencer", riesgo: "Naranja", fuente: "Leído", nota: "Tarjeta N°37793036 – Venc. Mantenimiento 07/2026. Polvo Químico 5kg. Control trimestral al día (Enero 2026). Programar recarga julio 2026.", docs: 45, dias: 53, venc_fmt: "31/07/2026", emi_fmt: "01/07/2025" },
  { id: "MAG-08", sede: "MAGALDI", categoria: "Simulacros", documento: "Sistema de Autoprotección (SAP) + Simulacros", organismo: "GCABA – Dir. Gral. Defensa Civil (DGDCIV)", tipo: "Disposición aprobatoria (Ley 5920)", emision: "2025-04-14", vencimiento: "2027-04-13", frecuencia: "Reválida bianual + simulacros (semestral/anual)", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "DI-2025-2060-GCABA-DGDCIV. Validez 2 años. Último simulacro aprobado 12/11/2025. Renovación 2026 (13-ABR) en curso.", docs: 71, dias: 309, venc_fmt: "13/04/2027", emi_fmt: "14/04/2025" },
  { id: "MAG-09", sede: "MAGALDI", categoria: "Electricidad", documento: "Puesta a Tierra (PAT) – Medición y continuidad", organismo: "COPIME (profesional matriculado) – Res. SRT 900/15", tipo: "Certificado de Encomienda de Tarea Profesional (medición PAT)", emision: "2026-03-16", vencimiento: "2027-03-16", frecuencia: "Anual", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "CETPD N°811637. Profesional Farga Alejandro (Mat. T014005). Vigencia 12 meses desde emisión.", docs: 6, dias: 281, venc_fmt: "16/03/2027", emi_fmt: "16/03/2026" },
  { id: "MAG-10", sede: "MAGALDI", categoria: "Plagas", documento: "Control de Plagas (Desinsectación/Desratización) – Oblea", organismo: "Empresa habilitada (Toro de Fuego SRL) – Res. 360/APRA, Ord. 33.266", tipo: "Certificado/Oblea de control de plagas", emision: "2026-06-02", vencimiento: "2026-07-02", frecuencia: "Mensual", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "Oblea N°68358. Servicio 02/06/2026, válido hasta 02/07/2026. Renovar servicio julio 2026.", docs: 2, dias: 24, venc_fmt: "02/07/2026", emi_fmt: "02/06/2026" },
  { id: "MAG-11", sede: "MAGALDI", categoria: "Agua", documento: "Limpieza de Tanques + Análisis Bacteriológico y Fisicoquímico", organismo: "SAKRON Servicio Integral (empresa habilitada)", tipo: "Certificado de limpieza + potabilidad", emision: "2026-04-01", vencimiento: "2026-10-01", frecuencia: "Semestral", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "Tratamiento Abril 2026. Resultado: 'Agua bacteriológicamente apta para consumo'. Próxima limpieza ~Octubre 2026.", docs: 29, dias: 115, venc_fmt: "01/10/2026", emi_fmt: "01/04/2026" },
  { id: "MAG-12", sede: "MAGALDI", categoria: "Habilitación", documento: "Ventilación Mecánica – Plano registrado", organismo: "GCABA – Dir. Gral. Registro de Obras y Catastro (DGROC)", tipo: "Plano/registro de ventilación mecánica", emision: "2021-01-01", vencimiento: null, frecuencia: "Registro permanente (integra habilitación)", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "EX-2021-05871004 / IF-2021-06131217-GCABA-DGROC. Registrado 2021; integra la habilitación.", docs: 4, dias: null, venc_fmt: "Sin venc.", emi_fmt: "01/01/2021" },
  { id: "MAG-13", sede: "MAGALDI", categoria: "Seguros", documento: "Seguro de Responsabilidad Civil", organismo: "Galicia Seguros S.A. (Superintendencia de Seguros de la Nación)", tipo: "Póliza RC", emision: "2026-05-15", vencimiento: "2027-05-15", frecuencia: "Anual", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "Póliza N°000273641. Suma asegurada $351.971.295. Vigencia 15/05/2026–15/05/2027.", docs: 4, dias: 341, venc_fmt: "15/05/2027", emi_fmt: "15/05/2026" },
  { id: "MAG-14", sede: "MAGALDI", categoria: "Seguros", documento: "Seguro de Incendio (Mercantil Andina / Swiss Medical)", organismo: "Compañía aseguradora (SSN)", tipo: "Póliza Incendio", emision: null, vencimiento: null, frecuencia: "Anual", estado: "No determinado", riesgo: "Amarillo", fuente: "Carpeta/filename", nota: "Pólizas de incendio presentes (Mercantil Andina y Swiss Medical); verificar fecha de vigencia vigente.", docs: 0, dias: null, venc_fmt: "Sin venc.", emi_fmt: "—" },
  { id: "MAG-15", sede: "MAGALDI", categoria: "Seguridad", documento: "Capacitaciones de Seguridad e Higiene", organismo: "Empresa / profesional S&H", tipo: "Constancia de capacitación", emision: "2024-06-01", vencimiento: null, frecuencia: "Anual", estado: "No determinado", riesgo: "Amarillo", fuente: "Carpeta/filename", nota: "Última constancia registrada: Junio 2024 (también Mayo 2023). Verificar capacitaciones 2025/2026.", docs: 3, dias: null, venc_fmt: "Sin venc.", emi_fmt: "01/06/2024" },
  { id: "MAG-16", sede: "MAGALDI", categoria: "ACUMAR", documento: "ACUMAR – Empadronamiento (Cuenca Matanza Riachuelo)", organismo: "ACUMAR (Nación)", tipo: "DDJJ Reempadronamiento + actuaciones", emision: "2024-09-13", vencimiento: null, frecuencia: "DDJJ anual", estado: "No determinado", riesgo: "Amarillo", fuente: "Carpeta/filename", nota: "DJ reempadronamiento 2022 + Acta 13/09/2024 + Nota Sep 2024. Verificar DDJJ vigente y vínculo con renovación CAA Nación.", docs: 17, dias: null, venc_fmt: "Sin venc.", emi_fmt: "13/09/2024" },
  { id: "MAG-17", sede: "MAGALDI", categoria: "Residuos", documento: "Manifiestos de Residuos Peligrosos + Certificado de Tratamiento", organismo: "Operador/Transportista habilitado", tipo: "Manifiestos + certificados de tratamiento", emision: "2025-01-01", vencimiento: null, frecuencia: "Por retiro (anual operativo)", estado: "Vigente", riesgo: "Verde", fuente: "Carpeta/filename", nota: "Manifiestos 2025 y Certificado de Tratamiento 2024-2025 presentes. Operativa de retiros documentada.", docs: 18, dias: null, venc_fmt: "Sin venc.", emi_fmt: "01/01/2025" },
  { id: "LUJ-01", sede: "LUJAN", categoria: "Habilitación", documento: "Habilitación Comercial (Depósito de mercaderías en tránsito)", organismo: "GCBA – AGC / Dir. Gral. Habilitaciones y Permisos", tipo: "Certificado de Habilitación (Ley 449/2000)", emision: "2011-01-01", vencimiento: null, frecuencia: "Permanente", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "EXPTE 2400804/2011. Rubro 560320 – Depósito de mercaderías en tránsito. Sup. 6.234 m². 5 operarios. Incluye ventilación mecánica y plano contra incendio (EXPTE 27979/2008).", docs: 1, dias: null, venc_fmt: "Sin venc.", emi_fmt: "01/01/2011" },
  { id: "LUJ-02", sede: "LUJAN", categoria: "Impacto Ambiental", documento: "Certificado de Aptitud Ambiental (CAA) – Ciudad", organismo: "GCABA – APRA / DGEVA", tipo: "Certificado (Ley 123) – Sin Relevante Efecto", emision: "2024-09-06", vencimiento: "2028-09-06", frecuencia: "Cuatrienal (4 años)", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "Certificado N°15251. IF-2024-33851842-GCABA-DGEVA. Disp. 731-GCABA-DGEVA/24. Proyecto 8.1.2 Depósito logístico. 'El vencimiento opera a los 4 años de su otorgamiento'.", docs: 26, dias: 821, venc_fmt: "06/09/2028", emi_fmt: "06/09/2024" },
  { id: "LUJ-03", sede: "LUJAN", categoria: "Impacto Ambiental", documento: "RAC / Impacto Acústico (Régimen de Adecuación Ambiental)", organismo: "GCABA – APRA / DGEVA", tipo: "RAC + Estudio de Impacto Acústico (IEIA)", emision: "2023-01-01", vencimiento: null, frecuencia: "Según régimen de adecuación", estado: "No determinado", riesgo: "Amarillo", fuente: "Carpeta/filename", nota: "RAC-5469 / RAC-4676 (Lujan 3151). IEIA 2023 + subsanación 03/04/2024. En proceso de adecuación.", docs: 32, dias: null, venc_fmt: "Sin venc.", emi_fmt: "01/01/2023" },
  { id: "LUJ-04", sede: "LUJAN", categoria: "Incendio", documento: "Instalación Fija Contra Incendio (IFCI) – Oblea anual", organismo: "GCBA – Agencia Gubernamental de Control (AGC)", tipo: "Oblea de habilitación (Patente 1.639, Inst. 1 – Agua Nivel 3)", emision: "2026-01-01", vencimiento: "2026-12-31", frecuencia: "Oblea anual + mantenimiento mensual + control trimestral", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "Oblea AGC 'Año de Vigencia 2026'. Mantenimiento mensual al día (Enero 2026).", docs: 60, dias: 206, venc_fmt: "31/12/2026", emi_fmt: "01/01/2026" },
  { id: "LUJ-05", sede: "LUJAN", categoria: "Incendio", documento: "Prueba Hidráulica / Certificado de Mangas (hidrantes)", organismo: "Empresa especializada (matriculada)", tipo: "Certificado de prueba hidráulica de mangueras", emision: "2023-12-01", vencimiento: null, frecuencia: "Anual", estado: "No determinado", riesgo: "Amarillo", fuente: "Carpeta/filename", nota: "Último certificado completo: Diciembre 2023 (+ Noviembre 2023). Verificar pruebas 2024-2025-2026.", docs: 0, dias: null, venc_fmt: "Sin venc.", emi_fmt: "01/12/2023" },
  { id: "LUJ-06", sede: "LUJAN", categoria: "Seguridad", documento: "Matafuegos – Tarjetas + Control trimestral", organismo: "GCBA – AGC (tarjeta) / empresa recargadora habilitada", tipo: "Tarjeta de extintor + Planilla de control periódico", emision: "2024-07-12", vencimiento: "2026-07-31", frecuencia: "Recarga anual + control trimestral", estado: "Próximo a vencer", riesgo: "Naranja", fuente: "Carpeta/filename", nota: "Reportes de tarjetas vigentes (28/10/2025). Control trimestral al día (Enero 2026). Programar recarga 2026.", docs: 41, dias: 53, venc_fmt: "31/07/2026", emi_fmt: "12/07/2024" },
  { id: "LUJ-07", sede: "LUJAN", categoria: "Simulacros", documento: "Sistema de Autoprotección (SAP) + Simulacros", organismo: "GCABA – Dir. Gral. Defensa Civil (DGDCIV)", tipo: "Informe de reválida por trámite abreviado (Ley 5920)", emision: "2025-07-21", vencimiento: "2027-07-22", frecuencia: "Reválida bianual + simulacros (anual)", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "IF-2025-30291303-GCABA-DGDCIV (reválida aprobada). Simulacros aprobados 29/10/2025 y 04/03/2026.", docs: 51, dias: 409, venc_fmt: "22/07/2027", emi_fmt: "21/07/2025" },
  { id: "LUJ-08", sede: "LUJAN", categoria: "Electricidad", documento: "Puesta a Tierra (PAT) – Medición y continuidad", organismo: "Profesional matriculado (COPIME) – Res. SRT 900/15", tipo: "Certificado de medición PAT", emision: "2025-01-01", vencimiento: "2026-01-01", frecuencia: "Anual", estado: "No determinado", riesgo: "Amarillo", fuente: "Carpeta/filename", nota: "Último estudio en carpeta: 2025 (fecha exacta no confirmada). Renovación anual — verificar/realizar medición 2026.", docs: 4, dias: -158, venc_fmt: "01/01/2026", emi_fmt: "01/01/2025" },
  { id: "LUJ-09", sede: "LUJAN", categoria: "Habilitación", documento: "Montacarga / Ascensor – Oblea anual + Conservación", organismo: "GCBA – Agencia Gubernamental de Control (AGC)", tipo: "Oblea de elevador (Patente 71.301)", emision: "2026-01-01", vencimiento: "2026-12-31", frecuencia: "Oblea anual + mantenimiento mensual (conservador)", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "Oblea AGC 'Año de Vigencia 2026'. Mantenimiento mensual al día (2026: Ene/Feb/Mar). Seguro Pza 266262 (Galicia).", docs: 93, dias: 206, venc_fmt: "31/12/2026", emi_fmt: "01/01/2026" },
  { id: "LUJ-10", sede: "LUJAN", categoria: "Habilitación", documento: "Conservación Edilicia (Ley 257 – Fachadas)", organismo: "GCBA – Agencia Gubernamental de Control (AGC)", tipo: "Certificado de Conservación", emision: "2022-06-10", vencimiento: "2026-06-10", frecuencia: "Cuatrienal (Ley 257)", estado: "Próximo a vencer", riesgo: "Naranja", fuente: "Leído", nota: "CRÍTICO INMINENTE. Certificado N°62902 (Ing. Holm, Mat. 15464). Vence 10/06/2026. Acción inmediata: encomendar nuevo certificado de conservación.", docs: 3, dias: 2, venc_fmt: "10/06/2026", emi_fmt: "10/06/2022" },
  { id: "LUJ-11", sede: "LUJAN", categoria: "Plagas", documento: "Control de Plagas (Desinsectación/Desratización) – Oblea", organismo: "Empresa habilitada – Res. 360/APRA, Ord. 33.266", tipo: "Certificado/Oblea de control de plagas", emision: "2026-06-01", vencimiento: "2026-07-01", frecuencia: "Mensual", estado: "Vigente", riesgo: "Verde", fuente: "Carpeta/filename", nota: "Oblea de mayo y junio presentes. Cobertura mensual al día; renovar servicio julio 2026.", docs: 2, dias: 23, venc_fmt: "01/07/2026", emi_fmt: "01/06/2026" },
  { id: "LUJ-12", sede: "LUJAN", categoria: "Agua", documento: "Limpieza de Tanques + Análisis Bacteriológico y Fisicoquímico", organismo: "SAKRON Servicio Integral (empresa habilitada)", tipo: "Certificado de limpieza + potabilidad", emision: "2026-01-01", vencimiento: "2026-07-01", frecuencia: "Semestral", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "Tratamiento Enero 2026. 'Agua bacteriológicamente apta para consumo'. Próxima limpieza ~Julio 2026 (semestral Ene/Jul).", docs: 24, dias: 23, venc_fmt: "01/07/2026", emi_fmt: "01/01/2026" },
  { id: "LUJ-13", sede: "LUJAN", categoria: "Incendio", documento: "Carga de Fuego (cálculo por sector)", organismo: "Profesional matriculado (COPIME) – Ley 19.587 / Dec 351/79", tipo: "Estudio de carga de fuego", emision: "2024-04-26", vencimiento: null, frecuencia: "Recalcular ante cambios de mercadería/uso", estado: "Vigente", riesgo: "Verde", fuente: "Leído", nota: "Sectores 1, 2, 6 y 8 calculados (abril 2024). Ing. Molinari (Mat. 12088). Recalcular ante cambios sustanciales de estiba.", docs: 6, dias: null, venc_fmt: "Sin venc.", emi_fmt: "26/04/2024" },
  { id: "LUJ-14", sede: "LUJAN", categoria: "ACUMAR", documento: "ACUMAR – Empadronamiento (REAMAR / CURT)", organismo: "ACUMAR (Nación)", tipo: "DDJJ Electrónica de Reempadronamiento", emision: "2023-01-01", vencimiento: null, frecuencia: "DDJJ anual", estado: "No determinado", riesgo: "Amarillo", fuente: "Leído", nota: "REAMAR – CURT 97011223860. Actividad 522099 (almacenamiento). Acta de inspección 08-2023. Verificar DDJJ anual vigente.", docs: 8, dias: null, venc_fmt: "Sin venc.", emi_fmt: "01/01/2023" },
  { id: "LUJ-15", sede: "LUJAN", categoria: "ANMAT", documento: "Proyecto ANMAT (Propuesta de habilitación de depósito)", organismo: "ANMAT (Nación) – pendiente", tipo: "Propuesta de proyecto", emision: null, vencimiento: null, frecuencia: "N/A (proyecto)", estado: "Faltante / En proyecto", riesgo: "Rojo", fuente: "Leído", nota: "CRÍTICO. NO existe habilitación ANMAT formal: sólo una 'Propuesta de proyecto'. Para operar productos regulados por ANMAT se requiere habilitación de depósito, Director Técnico y disposiciones. Brecha regulatoria a cerrar.", docs: 1, dias: null, venc_fmt: "Sin venc.", emi_fmt: "—" },
  { id: "LUJ-16", sede: "LUJAN", categoria: "Seguros", documento: "Seguro (Póliza 88984)", organismo: "Compañía aseguradora (SSN)", tipo: "Póliza", emision: null, vencimiento: null, frecuencia: "Anual", estado: "No determinado", riesgo: "Amarillo", fuente: "Carpeta/filename", nota: "Póliza 88984 presente; verificar cobertura y vigencia.", docs: 1, dias: null, venc_fmt: "Sin venc.", emi_fmt: "—" },
];

// ── Selectores derivados (puros) ─────────────────────────────────────────────
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ── Derivación dinámica de vencimientos (FIX confiabilidad · 2026-06-11) ────
// ITEMS es un snapshot manual (auditoría AUDIT_META.fecha), pero los
// vencimientos NO pueden quedar congelados: para los ítems CON fecha de
// vencimiento, `dias`, `estado` y `riesgo` se recalculan en runtime contra la
// fecha actual (zona AR). Los `dias` hardcodeados del snapshot dejan de ser
// fuente de verdad (quedan solo como dato histórico del archivo).
//
// Reglas (deriveComplianceStatus):
//   · sin vencimiento  → conserva estado/riesgo documental base (cubre
//     faltante / inexistente / proyecto: siguen siendo hallazgo crítico).
//   · vencido (d < 0)  → Rojo · "Vencido" (aunque figure "en trámite": computa
//     riesgo hasta que exista fecha renovada / documento vigente).
//   · 0–30 días        → Naranja · "Vencimiento inminente".
//   · 31–60 días       → Amarillo · "Alerta preventiva".
//   · > 60 días        → Verde · "Vigente".

const AR_TZ = "America/Argentina/Buenos_Aires";

/** Fecha actual (solo día) en zona AR, como "YYYY-MM-DD". */
export function todayAr(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: AR_TZ }).format(now);
}

/** Diferencia en días entre una fecha YYYY-MM-DD y `today` (UTC date-only, sin DST). */
function diffDays(venc: string, today: string): number {
  const [vy, vm, vd] = venc.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return Math.round((Date.UTC(vy, vm - 1, vd) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

/** Default de anticipación cuando no se inyecta config (espejo del seed 0125). */
export const ANTICIPACION_DEFAULT: Record<string, number> = {
  Mensual: 7, Trimestral: 15, Semestral: 30, Anual: 60, Bienal: 90, Trienal: 120, Cuatrienal: 180, __default__: 60,
};

/**
 * Recalcula dias + semáforo (riesgo) + estado contra la fecha actual y el caso activo.
 * El color sale de (temporal + estado administrativo); el riesgo (prioridad) viaja aparte.
 */
export function deriveComplianceStatus(
  item: ComplianceItem,
  today: string = todayAr(),
  anticConfig: Record<string, number> = ANTICIPACION_DEFAULT,
): ComplianceItem {
  const caso = item.activeCase ?? null;
  const estadoAdm = caso?.estadoAdministrativo ?? null;
  // "falta": base documental indica faltante/proyecto (Rojo sin vencimiento en el snapshot).
  const baseFalta = !item.vencimiento && item.riesgo === "Rojo";

  const dias = item.vencimiento ? diffDays(item.vencimiento, today) : null;
  const anticipacion = resolveAnticipacion({
    itemOverride: item.anticipacion_dias ?? null,
    frecuencia: item.frecuencia || null,
    config: anticConfig,
  });
  const temporal: Temporal = temporalOf({ vencimiento: item.vencimiento, dias, baseFalta, anticipacion });

  // Estado efectivo para la cascada: el del caso, o uno inferido del eje temporal.
  const estadoEfectivo = estadoAdm ?? (temporal === "vigente" ? "vigente" : temporal === "falta" ? "sin_iniciar" : "sin_iniciar");

  // Si NO hay caso y NO hay vencimiento NI falta (permanente vigente del snapshot) → conservar base.
  if (!caso && !item.vencimiento && !baseFalta) {
    return { ...item, dias, estadoAdministrativo: estadoAdm, etapa: null, nivelRiesgo: null };
  }

  const semaforo = computeSemaforo(temporal, estadoEfectivo as EstadoAdministrativo);
  const estadoTxt =
    semaforo === "Verde" ? "Vigente"
    : semaforo === "Amarillo" ? (estadoAdm === "pendiente_emision" ? "Pendiente de emisión" : "Próximo a vencer")
    : semaforo === "Naranja" ? "En trámite administrativo"
    : "Vencido / Falta";

  return {
    ...item,
    dias,
    riesgo: semaforo,
    estado: estadoTxt,
    estadoAdministrativo: estadoAdm,
    etapa: caso?.etapa ?? null,
    nivelRiesgo: caso?.nivelRiesgo ?? null,
  };
}

/** Inventario con vencimientos VIVOS — la entrada que deben usar page/ficha/score. */
export function deriveItems(items: ComplianceItem[] = ITEMS, today: string = todayAr()): ComplianceItem[] {
  return items.map((i) => deriveComplianceStatus(i, today));
}

/** Ficha por ítem (ruta /anmat/[id]) — devuelve el ítem ya derivado a hoy. */
export function getItem(id: string): ComplianceItem | undefined {
  const base = ITEMS.find((i) => i.id === id);
  return base ? deriveComplianceStatus(base) : undefined;
}

// ── Modelo de score (parametrizable) ─────────────────────────────────────────
// Compliance Score = % de cumplimiento ponderado por estado (positivo, ↑ mejor).
// Risk Score = exposición saturante por severidad (negativo, ↑ peor).
// Reemplaza la fórmula punitiva 100−críticos×20−warnings×5 (no representaba el cumplimiento global).
export const COMPLIANCE_WEIGHTS: Record<Riesgo, number> = { Verde: 1.0, Naranja: 0.8, Amarillo: 0.5, Rojo: 0.0 };
export const RISK_SEVERITY: Record<Riesgo, number> = { Rojo: 20, Naranja: 8, Amarillo: 3, Verde: 0 };
export const RISK_K = 100; // tolerancia: severidad acumulada que equivale a RS ≈ 50

export type RiskBand = "Bajo" | "Medio" | "Alto" | "Crítico";

/** Compliance Score 0–100 (↑ mejor): atainment ponderado. */
export function complianceScore(items: ComplianceItem[]): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((s, i) => s + COMPLIANCE_WEIGHTS[i.riesgo], 0);
  return Math.round(clamp((sum / items.length) * 100, 0, 100));
}

/** Risk Score 0–100 (↑ peor): exposición saturante R/(R+K). */
export function riskScore(items: ComplianceItem[]): number {
  const R = items.reduce((s, i) => s + RISK_SEVERITY[i.riesgo], 0);
  return Math.round((100 * R) / (R + RISK_K));
}

export function riskBand(rs: number): RiskBand {
  if (rs <= 20) return "Bajo";
  if (rs <= 40) return "Medio";
  if (rs <= 70) return "Alto";
  return "Crítico";
}

/** Color del gauge de Compliance (↑ mejor). */
export function complianceColor(cs: number): Riesgo {
  if (cs >= 90) return "Verde";
  if (cs >= 75) return "Amarillo";
  if (cs >= 60) return "Naranja";
  return "Rojo";
}

/** Color del gauge/badge de Risk (↑ peor) por banda. */
export function riskBandColor(band: RiskBand): Riesgo {
  return band === "Bajo" ? "Verde" : band === "Medio" ? "Amarillo" : band === "Alto" ? "Naranja" : "Rojo";
}

export function criticalCount(items: ComplianceItem[]): number {
  return items.filter((i) => i.riesgo === "Rojo").length;
}

export function riskDistribution(items: ComplianceItem[]) {
  const total = items.length || 1;
  return (["Verde", "Amarillo", "Naranja", "Rojo"] as Riesgo[]).map((riesgo) => {
    const count = items.filter((i) => i.riesgo === riesgo).length;
    return { riesgo, count, pct: Math.round((count / total) * 100) };
  });
}

export function byCategory(items: ComplianceItem[]) {
  return CATEGORIAS.map((categoria) => {
    const rows = items.filter((i) => i.categoria === categoria);
    const r = (rg: Riesgo) => rows.filter((i) => i.riesgo === rg).length;
    return { categoria, Verde: r("Verde"), Amarillo: r("Amarillo"), Naranja: r("Naranja"), Rojo: r("Rojo"), total: rows.length };
  }).filter((c) => c.total > 0);
}

export interface TimelineBucket { key: string; label: string; riesgo: Riesgo; items: ComplianceItem[]; }
export function timelineBuckets(items: ComplianceItem[]): TimelineBucket[] {
  const dated = items.filter((i) => i.dias !== null) as (ComplianceItem & { dias: number })[];
  const pick = (f: (d: number) => boolean) => dated.filter((i) => f(i.dias)).sort((a, b) => a.dias - b.dias);
  return [
    { key: "vencido", label: "Vencido", riesgo: "Rojo", items: pick((d) => d < 0) },
    { key: "30", label: "≤ 30 días", riesgo: "Naranja", items: pick((d) => d >= 0 && d <= 30) },
    { key: "60", label: "31 – 60 días", riesgo: "Amarillo", items: pick((d) => d > 30 && d <= 60) },
    { key: "90", label: "61 – 90 días", riesgo: "Amarillo", items: pick((d) => d > 60 && d <= 90) },
    { key: "90plus", label: "> 90 días", riesgo: "Verde", items: pick((d) => d > 90) },
  ];
}

export function alertCenter(items: ComplianceItem[]) {
  const criticos = items.filter((i) => i.riesgo === "Rojo")
    .sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999));
  const inmediatos = items.filter((i) => i.riesgo !== "Rojo" && i.dias !== null && (i.dias as number) <= 30)
    .sort((a, b) => (a.dias as number) - (b.dias as number));
  const proximos = items.filter((i) => i.dias !== null && (i.dias as number) > 30 && (i.dias as number) <= 90)
    .sort((a, b) => (a.dias as number) - (b.dias as number));
  return { criticos, inmediatos, proximos };
}

/** KPIs ejecutivos (Sección 2). href = deep link a la matriz filtrada. */
export function executiveKpis(items: ComplianceItem[]) {
  const mag = items.filter((i) => i.sede === "MAGALDI");
  const luj = items.filter((i) => i.sede === "LUJAN");
  const noVerde = items.filter((i) => i.riesgo !== "Verde");
  return [
    { key: "auditados", label: "Documentos auditados", value: AUDIT_META.docsTotal, tone: "neutral" as const, href: "#matriz", suffix: "" },
    { key: "vigentes", label: "Vigentes", value: items.filter((i) => i.riesgo === "Verde").length, tone: "Verde" as const, href: "#matriz", suffix: "" },
    { key: "proximos", label: "Próximos a vencer", value: items.filter((i) => i.riesgo === "Naranja").length, tone: "Naranja" as const, href: "#timeline", suffix: "" },
    { key: "vencidos", label: "Vencidos / Faltantes", value: items.filter((i) => i.riesgo === "Rojo").length, tone: "Rojo" as const, href: "#alertas", suffix: "" },
    { key: "criticos", label: "Hallazgos críticos", value: items.filter((i) => i.riesgo === "Rojo").length, tone: "Rojo" as const, href: "#alertas", suffix: "" },
    { key: "abiertos", label: "Riesgos abiertos", value: noVerde.length, tone: "Naranja" as const, href: "#matriz", suffix: "" },
    { key: "cerrados", label: "Riesgos cerrados", value: items.filter((i) => i.riesgo === "Verde").length, tone: "Verde" as const, href: "#matriz", suffix: "" },
    { key: "score_mag", label: "Compliance Magaldi", value: complianceScore(mag), tone: complianceColor(complianceScore(mag)), href: "#sede-MAGALDI", suffix: "/100" },
    { key: "score_luj", label: "Compliance Luján", value: complianceScore(luj), tone: complianceColor(complianceScore(luj)), href: "#sede-LUJAN", suffix: "/100" },
  ];
}

/** Obligaciones recurrentes (Sección 9). */
const RECUR_DEF: { label: string; categoria?: string; match: (i: ComplianceItem) => boolean; ult: string; prox: string }[] = [
  { label: "Matafuegos", match: (i) => /Matafuegos/i.test(i.documento), ult: "Último control", prox: "Próximo vencimiento" },
  { label: "Plagas", match: (i) => i.categoria === "Plagas", ult: "Último certificado", prox: "Próximo servicio" },
  { label: "Limpieza de Tanques", match: (i) => i.categoria === "Agua", ult: "Último análisis", prox: "Próximo análisis" },
  { label: "SAP / Simulacros", match: (i) => i.categoria === "Simulacros", ult: "Última aprobación", prox: "Próxima renovación" },
  { label: "PAT", match: (i) => /Puesta a Tierra/i.test(i.documento), ult: "Última medición", prox: "Próxima medición" },
  { label: "ACUMAR", match: (i) => i.categoria === "ACUMAR", ult: "DDJJ", prox: "Estado" },
  { label: "ANMAT", match: (i) => i.categoria === "ANMAT", ult: "Proyecto", prox: "Estado" },
];
export function recurringObligations(items: ComplianceItem[]) {
  return RECUR_DEF.map((def) => ({
    label: def.label, ult: def.ult, prox: def.prox,
    magaldi: items.find((i) => i.sede === "MAGALDI" && def.match(i)) ?? null,
    lujan: items.find((i) => i.sede === "LUJAN" && def.match(i)) ?? null,
  }));
}

/** Calendario regulatorio anual: ítems con vencimiento agrupados por mes. */
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export function calendar(items: ComplianceItem[], year: number) {
  return MESES.map((mes, idx) => ({
    mes, idx,
    items: items
      .filter((i) => i.vencimiento && new Date(i.vencimiento).getUTCFullYear() === year && new Date(i.vencimiento).getUTCMonth() === idx)
      .sort((a, b) => (a.vencimiento as string).localeCompare(b.vencimiento as string)),
  }));
}
