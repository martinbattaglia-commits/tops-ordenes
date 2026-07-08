// Pirámide de conocimiento (2026-07-07) · CLASIFICADOR DE INTENCIÓN.
//
// El Copilot tiene capas con prioridad estricta: 1) Nexus (datos internos),
// 2) conocimiento institucional TOPS, 3) investigaciones/capacitaciones
// (NotebookLM), 4) conocimiento general / fuentes externas actuales. Este
// clasificador decide la capa ANTES del motor — determinístico y CONSERVADOR:
// el DEFAULT es nexus_internal (ante la duda, el comportamiento actual; una
// pregunta interna jamás debe desviarse a conocimiento general).
//
// Hallazgo de la sonda FASE 1 que esto corrige: "¿qué día es hoy?" respondía
// con eventos de tareas (/hoy/ → ops_digest) y "¿qué es ANMAT?" con incidentes
// (default → search_knowledge).
//
// Review adversarial (2026-07-07): el VETO de datos internos ahora es GLOBAL —
// se evalúa ANTES de cualquier rama no-Nexus, no solo en general_static — y los
// disparadores de fecha/hora/clima están ANCLADOS para no secuestrar preguntas
// internas por substring ("¿a qué hora es la reunión de dirección?" era hora).

export type TemaActual =
  | "fecha"
  | "hora"
  | "dolar"
  | "noticias"
  | "clima"
  | "inflacion"
  | "normativa";

export type CopilotIntent =
  | { tipo: "nexus_internal" }
  | { tipo: "general_static" }
  | { tipo: "general_current"; tema: TemaActual }
  | { tipo: "company_institutional" }
  | { tipo: "internal_research" }
  | { tipo: "mixed_nexus_external"; tema: "dolar" };

const norm = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// VETO GLOBAL de dato interno (review adversarial): si la pregunta contiene
// cualquiera de estos marcadores, es de Nexus aunque tenga forma de concepto o
// mencione fecha/hora/clima. Cubre: la marca Nexus/TOPS; posesivos;
// verbos de operación en 1ª persona plural (facturamos, gastamos, vendimos,
// pagamos, cobramos, compramos) e impersonales ("se factura/gasta/vende");
// entidades propias concretas (sedes Magaldi/Luján, bancos, cubículos);
// identificadores (FA-/OC-/OS-/INC-/TSK-); dominios operativos con marca de
// pertenencia; y períodos internos. Los CONCEPTOS abstractos NO vetan
// ("¿cómo se calcula la vacancia?", "¿diferencia entre gasto y presupuesto?").
// Verbos de operación SOLO conjugados (1ª persona plural / impersonal): captura
// "facturamos/gastamos/vendimos" pero NO los sustantivos "gasto/pago/cobro"
// (que rompían "diferencia entre gasto y presupuesto"). "tops"/"nuestr" NO van
// en el veto: institucional e internal_research se evalúan ANTES del veto.
const NEXUS_VETO =
  /\bnexus\b|verotin|facturamos|gastamos|vend[ie]mos|pagamos|cobramos|compramos|se (factura|gasta|vende|paga|cobra|compra)|magaldi|lujan|santander|galicia|cubicul|\b(fa|oc|os|inc|tsk)-\d|reunion de direccion|del deposito|este (mes|trimestre|ano)|mes pasado|ultimo mes|cuant[oa]s? (hay|tenemos|estan|facturamos|gastamos)/;

// Marcadores de ENTIDAD/DATO concreto que convierten un "diferencia entre X e Y"
// en comparación de DATOS internos (no un concepto). Deliberadamente incluye
// tipos con pertenencia operativa clara; "gasto vs presupuesto" o "factura
// emitida vs factura proveedor" (conceptos) NO están acá.
const ENTITY_DIFF =
  /magaldi|lujan|santander|galicia|compliance|contratos?|sede|deposito|proveedor|cliente|facturado|facturacion|saldo|cubicul|vacancia de|ingresos? de/;

// Normativa ESPECÍFICA (número de norma) o pregunta por su VIGENCIA actual:
// requiere fuente oficial/actual — jamás inventarla desde la memoria del modelo.
const NORMATIVA_ESPECIFICA =
  /(disposicion|resolucion|ley|decreto|disp\.?)\s*(general\s*)?\d|(sigue|esta) vigente|vigencia (actual|de la)|normativa (vigente|actual|actualizada)/;

export function classifyCopilotIntent(question: string): CopilotIntent {
  const q = norm(question);
  const vetoNexus = NEXUS_VETO.test(q);

  // ── mixed: dato Nexus + dato externo (FX) — primero (contiene ambos mundos) ─
  if (
    /dolar|tipo de cambio|cotizacion/.test(q) &&
    /factur|ingres|nuestr|convert|usd|en dolares/.test(q) &&
    /factur|ingres|nexus|nuestr/.test(q)
  ) {
    return { tipo: "mixed_nexus_external", tema: "dolar" };
  }

  // ── company_institutional: la empresa, sus servicios y su discurso ─────────
  // ANTES del veto (mencionan "TOPS"/"nuestra web" pero preguntan por servicios/
  // propuesta, no por datos operativos medibles).
  if (
    /(que )?servicios (ofrece|ofrecemos|brinda|tiene) (logistica )?tops|servicios (ofrece|brinda)\b|propuesta (comercial|de valor)|como (trabaja|opera) (logistica )?tops|(nuestra|la) (web|pagina|sitio)|que dice (nuestra|la) web|como vendemos|diferenciadores|como presentar (la|nuestra) propuesta|que ofrece (logistica )?tops/.test(
      q
    )
  ) {
    return { tipo: "company_institutional" };
  }

  // ── internal_research: capacitaciones, investigaciones, trabajos de campo ──
  // ANTES del veto ("nuestra operación vs mejores prácticas" es research).
  if (
    /capacitacion|capacitar|investigacion|trabajo de campo|notebooklm|material (de|para) (formacion|capacitacion)|mejores practicas|que aprendimos/.test(
      q
    )
  ) {
    return { tipo: "internal_research" };
  }

  // ── company_institutional (C1 · post-smoke 2026-07-07): PRODUCTOS de TOPS
  // (TOPS Nexus/Connect), UBICACIÓN/infraestructura y COMPARACIÓN de unidades de
  // negocio (ANMAT vs cargas generales). Va ANTES del veto —que capturaría
  // 'nexus'— para que "¿qué es TOPS Nexus?" no caiga en datos internos y termine
  // en "no encontré registros en Nexus" (hallazgo del smoke institucional).
  if (
    /\btops (nexus|connect)\b/.test(q) ||
    /\bque (es|son)\b[^?]*\b(tops )?(nexus|connect)\b/.test(q) ||
    /\bdonde (opera|operan|esta|estan|queda|quedan|trabaja)\b[^?]*\b(tops|logistica)\b/.test(q) ||
    // 'diferencia entre ANMAT y cargas generales' = concepto institucional; PERO
    // si nombra una ENTIDAD/dato interno ('diferencia entre los CONTRATOS ANMAT…')
    // es comparación de datos → NO institucional (review A del clasificador).
    (/\bdiferencia\b[^?]*\b(anmat|cargas generales|regulad|3pl)\b/.test(q) && !ENTITY_DIFF.test(q)) ||
    /\bque (ofrece|hace|brinda)\b[^?]*\btops\b[^?]*\b(anmat|cargas generales|regulad|3pl)\b/.test(q)
  ) {
    return { tipo: "company_institutional" };
  }

  // ── VETO GLOBAL: cualquier marcador de dato interno → Nexus (fail-safe) ─────
  // Va ANTES de las ramas general_*: "¿a qué hora es la reunión de dirección?",
  // "¿qué día de la semana facturamos más?", "¿qué es lo que más gastamos?" son
  // de Nexus pese a su forma. Excepciones ya resueltas arriba: mixtas con dólar,
  // institucional y research.
  if (vetoNexus) return { tipo: "nexus_internal" };

  // ── general_current: normativa específica / vigente (fuente oficial actual) ─
  if (NORMATIVA_ESPECIFICA.test(q)) {
    return { tipo: "general_current", tema: "normativa" };
  }

  // ── general_current: triviales del reloj del servidor (ANCLADAS al foco) ────
  // El disparador exige que la pregunta SEA sobre el día/fecha, no que lo
  // contenga: "¿a qué hora es X?" (agenda) no matchea "¿qué hora es?".
  if (/^¿?\s*(que|cual) (dia|fecha) (es (hoy)?|de hoy)|^¿?\s*que dia de la semana es|^¿?\s*fecha (de hoy|actual)/.test(q.trim())) {
    return { tipo: "general_current", tema: "fecha" };
  }
  if (/^¿?\s*que hora es|^¿?\s*(cual es la|decime la) hora( actual)?/.test(q.trim())) {
    return { tipo: "general_current", tema: "hora" };
  }
  // ── general_current: requieren fuente externa en tiempo real ───────────────
  if (/cotiza el dolar|cotizacion del dolar|precio del dolar|dolar (oficial|blue|mep|hoy)|cuanto (esta|cotiza|vale) el dolar/.test(q)) {
    return { tipo: "general_current", tema: "dolar" };
  }
  if (/noticias? (mas )?(importantes|relevantes|del dia)|que paso hoy en (argentina|el pais|el mundo|la economia)|ultimas noticias/.test(q)) {
    return { tipo: "general_current", tema: "noticias" };
  }
  // "clima" anclado al meteorológico: "clima laboral" ya lo vetó NEXUS_VETO si
  // menciona la operación; acá se exige el sentido de pronóstico.
  if (/(como esta|cual es|que dice) el clima( hoy| de hoy| actual)?\??$|pronostico del tiempo|clima (de|en|para) (hoy|manana)|va a llover/.test(q)) {
    return { tipo: "general_current", tema: "clima" };
  }
  if (/inflacion (actual|mensual|de este mes|del mes)|indice de inflacion|cuanto (es|esta|fue) la inflacion/.test(q)) {
    return { tipo: "general_current", tema: "inflacion" };
  }

  // ── general_static: conceptos sin actualidad. Openers INEQUÍVOCOS de concepto
  //    ("qué es / qué significa / cómo se calcula"). "Diferencia entre" solo si
  //    NO compara entidades/datos concretos (review: era la fuga máxima).
  const q2 = q.trim();
  const openerConcepto = /^¿?\s*(que es|que significa|que quiere decir|explicame que es|que es un[ao]?|como se calcula)\b/;
  const openerDiferencia = /^¿?\s*(cual es la diferencia entre|que diferencia hay entre|diferencia entre)\b/;
  if (openerConcepto.test(q2) || (openerDiferencia.test(q2) && !ENTITY_DIFF.test(q))) {
    return { tipo: "general_static" };
  }

  return { tipo: "nexus_internal" };
}
