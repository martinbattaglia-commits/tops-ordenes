// F5.2-lite · MockProvider — planner/compositor DETERMINISTA, sin red.
// Reglas por palabra clave → tools del catálogo; composición de respuesta
// SOLO desde chunks, con citas [S#]. Si no hay chunks → NO_EVIDENCE exacto.
// Nunca interpreta el contenido de los chunks como instrucciones: solo lo cita.
// Es el provider del piloto (D-F5-9) y el harness de TDD/QA del engine.

import { NO_EVIDENCE } from "../guardrails";
import type {
  AiProvider,
  ProviderTurnRequest,
  ProviderTurnResponse,
  SourceChunk,
  ToolCall,
} from "../types";

/** Normaliza para matching: minúsculas y sin acentos. */
function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const PUBLIC_ID_RE = /\b(INC|TSK)-\d{4}-\d{4}\b/i;

/** Exportada para el test de cobertura del catálogo de sugerencias (command
 *  center): ninguna sugerencia principal puede caer en el default genérico. */
export function pickTools(question: string): ToolCall[] {
  const q = norm(question);
  const calls: ToolCall[] = [];
  const id = question.match(PUBLIC_ID_RE)?.[0]?.toUpperCase();

  if (id) {
    // Entidad puntual: resolverla por búsqueda; el round 2 pide la cronología.
    calls.push({ tool: "search_knowledge", args: { query: id } });
    if (id.startsWith("INC")) {
      calls.push({ tool: "incidents_overview", args: {} });
    } else {
      calls.push({ tool: "tasks_overview", args: { scope: "abiertas" } });
    }
    return calls;
  }
  // fix/f5-2 · NAVEGACIÓN primero: "¿dónde veo X?" pide el mapa, no los datos de X.
  if (/que secciones|que modulos|donde (veo|encuentro|esta|estan|miro)|como (llego|entro|accedo)/.test(q)) {
    calls.push({ tool: "nexus_sections_overview", args: { query: question.slice(0, 200) } });
    return calls;
  }
  // ── Capa de INTENCIÓN de negocio (smoke humano 2026-07-06) ──────────────────
  // singular ("cuál es EL proveedor que más…") = top-1 · ranking/listado = top-N.
  const wantsRanking = /ranking|top \d+|listame|lista de|mostrame todos|todos los/.test(q);
  const singular =
    !wantsRanking &&
    /cual (es|fue) (el|la)\b|quien (es|fue) el\b|la respuesta es unica|un solo|decime solo|solo el|el que mas|la que mas/.test(
      q
    );
  // "mes pasado" = mes calendario anterior (hallazgo smoke: no se interpretaba).
  const periodo = /mes pasado|ultimo mes|pasado mes/.test(q)
    ? "ultimo_mes"
    : /este mes|mes actual/.test(q)
      ? "mes_actual"
      : /30 dias/.test(q)
        ? "ultimos_30_dias"
        : "todo";

  // Documento ESPECÍFICO → docs_browse, NUNCA compliance_pending (hallazgo smoke:
  // "plancheta de habilitación de Luján 3159" devolvía la lista de vencidos).
  // Keyword para el título: la SEDE si aparece; si no, el tipo de documento.
  const sede = q.match(/lujan|magaldi|3159|1765/)?.[0];
  const docWord = q.match(/plancheta|plano\b|certificado|poliza|habilitacion/)?.[0];
  const retrievalVerb = /dame|me das|me podrias|pasame|traeme|busca|conseguime|quiero|necesito/.test(q);
  if (docWord && (retrievalVerb || sede) && !/pendiente|vencid|por vencer/.test(q)) {
    calls.push({ tool: "docs_browse", args: { tipo: "compliance", query: sede ?? docWord } });
    return calls;
  }

  // VACANCIA / CAPACIDAD / CUBÍCULOS (smoke 2026-07-07): métricas del motor
  // corporativo — misma fuente que el dashboard de Vacancia.
  if (
    /vacancia|capacidad comercializable|cubiculo|metros cuadrados|m2 (disponibles|libres|ocupados)|superficie disponible|cuantos m2|ocupacion (fisica|corporativa|del deposito)/.test(
      q
    )
  ) {
    // Intención puntual (número primero): foco + categoría si la pregunta lo pide.
    const focus = /cubiculo/.test(q)
      ? "cubiculos"
      : /vacancia|porcentaje/.test(q)
        ? "vacancia"
        : /disponible|libre|metros cuadrados|m2/.test(q)
          ? "disponible"
          : undefined;
    const categoria = /cargas generales/.test(q)
      ? "general"
      : /anmat/.test(q) && focus !== "cubiculos"
        ? "anmat"
        : /oficina/.test(q)
          ? "oficina"
          : undefined;
    calls.push({
      tool: "vacancy_overview",
      args: { ...(focus ? { focus } : {}), ...(categoria ? { categoria } : {}) },
    });
    return calls;
  }
  // REPORTE por CATEGORÍA (estándar gerencial): porcentajes/distribución/ANMAT vs
  // Cargas de ingresos → tool de reporte, nunca search_knowledge ni el total plano.
  if (
    (/porcentaje|categoria|distribucion|composicion|desglose|reporte/.test(q) ||
      /anmat|cargas generales/.test(q)) &&
    /ingres|factur/.test(q)
  ) {
    calls.push({
      tool: "revenue_by_category_report",
      args: {
        periodo:
          periodo === "mes_actual" ? "mes_actual" : periodo === "todo" ? "todo" : "ultimo_mes",
      },
    });
    return calls;
  }

  // Facturación POR CLIENTE (top-1 o ranking) — antes que el total y que facturas.
  if (/cliente/.test(q) && /factur|ingres|venta/.test(q)) {
    calls.push({
      tool: "customer_revenue_overview",
      args: {
        periodo: periodo === "ultimos_30_dias" ? "todo" : periodo,
        ...(singular ? { limit: 1 } : {}),
      },
    });
    return calls;
  }

  // Total facturado por período (suma).
  if (/cuantos? (se )?factur|cuanto facturamos|facturacion (total|mensual|del mes)/.test(q)) {
    calls.push({
      tool: "billing_summary",
      args: { mode: periodo === "mes_actual" ? "mes_actual" : "ultimo_mes" },
    });
    return calls;
  }

  // Saldos bancarios.
  if (/santander|galicia|saldo|plata hay|cuanta plata/.test(q) && !/proveedor|probador/.test(q)) {
    const bank = q.match(/santander|galicia|caja/)?.[0];
    calls.push({
      tool: "bank_balances_overview",
      args: bank ? { query: bank } : {},
    });
    return calls;
  }

  // Gasto/presupuesto por proveedor. Tolerancia de typo: "probador" en contexto de
  // gasto = proveedor (hallazgo smoke). "insumió/consume" = contexto de gasto.
  if (
    /proveedor|probador/.test(q) &&
    /presupuesto|gast|consum|insumi|mayor|mas caro|ranking|mas plata/.test(q)
  ) {
    const base = /presupuesto|comprom/.test(q) ? "compromiso" : "gasto";
    calls.push({
      tool: "supplier_spend_overview",
      args: { base, periodo, ...(singular ? { limit: 1 } : {}) },
    });
    return calls;
  }
  if (/incident/.test(q)) {
    const severidades = /critic/.test(q) ? ["critica"] : undefined;
    const estados = /(abiert|pendient|activ)/.test(q)
      ? ["abierto", "en_progreso", "en_espera"]
      : undefined;
    calls.push({
      tool: "incidents_overview",
      args: {
        ...(estados ? { estados } : {}),
        ...(severidades ? { severidades } : {}),
      },
    });
    return calls;
  }
  // F5.1-b.0.1.1: "archivo(s)" → docs_browse (fichas documentales); "contrato(s)" →
  // contracts_overview (grano contrato). Van ANTES de compliance_pending para que
  // "archivos de compliance" y "contratos por vencer" no caigan en compliance.
  if (/archivo/.test(q)) {
    calls.push({
      tool: "docs_browse",
      args: { tipo: /contrato/.test(q) ? "contrato" : "compliance" },
    });
    return calls;
  }
  if (/contrato/.test(q)) {
    // Tipo explícito → filtro real del RPC (enum en prod: 'ANMAT' | 'Cargas Generales').
    const tipo = /anmat/.test(q)
      ? "ANMAT"
      : /cargas? generales?/.test(q)
        ? "Cargas Generales"
        : undefined;
    // SINGULAR (smoke 2026-07-07): "el último contrato (firmado)" pide UNA entidad.
    // La RPC ya ordena firmados_recientes por fecha_firma desc → limit=1 devuelve
    // EL último sin migración. "últimos contratos" (plural) NO matchea.
    if (/ultim[oa] contrato/.test(q)) {
      calls.push({
        tool: "contracts_overview",
        args: { mode: "firmados_recientes", limit: 1, ...(tipo ? { query: tipo } : {}) },
      });
      return calls;
    }
    const mode = /vencer|vencimiento/.test(q)
      ? "por_vencer"
      : /firmad|firmo|firma/.test(q)
        ? "firmados_recientes"
        : /vigente/.test(q)
          ? "vigentes"
          : "todos";
    calls.push({
      tool: "contracts_overview",
      args: {
        mode,
        ...(tipo ? { query: tipo } : {}),
        // El KPI de "último mes" SOLO si el usuario acotó el período (honestidad:
        // "contratos firmados" a secas no debe responder "Firmados último mes: 0").
        ...(mode === "firmados_recientes" && periodo === "ultimo_mes"
          ? { periodo: "ultimo_mes" }
          : {}),
        // Dashboard: listar el máximo de la tool; el adaptador avisa si tocó el cap.
        ...(mode === "vigentes" || mode === "todos" ? { limit: 50 } : {}),
      },
    });
    return calls;
  }
  // P2 (fix/f5-2): facturas / órdenes de compra / proveedores. "factura de
  // proveedor" matchea ambos → supplier gana; "factura" a secas → customer.
  if (/factura|facturamos|facturaci|comprobante/.test(q)) {
    const ultima = /ultim|last/.test(q);
    if (/proveedor/.test(q)) {
      const mode = /pendient|aprobaci/.test(q)
        ? "pendientes_aprobacion"
        : ultima
          ? "ultima"
          : "recientes";
      calls.push({ tool: "supplier_invoices_overview", args: { mode } });
    } else {
      calls.push({
        tool: "customer_invoices_overview",
        args: { mode: ultima ? "ultima" : "recientes" },
      });
    }
    return calls;
  }
  if (/orden(es)? de compra|\boc\b|\bocs\b/.test(q)) {
    calls.push({
      tool: "purchase_orders_overview",
      args: { mode: /ultim|last/.test(q) ? "ultima" : "recientes" },
    });
    return calls;
  }
  if (/proveedor/.test(q)) {
    calls.push({ tool: "suppliers_overview", args: {} });
    return calls;
  }
  if (/compliance|habilitacion|vencimiento|documentacion|certificad|documentos?\b/.test(q)) {
    calls.push({ tool: "compliance_pending", args: {} });
    return calls;
  }
  if (/tarea/.test(q)) {
    if (/vencid|atrasad/.test(q)) {
      calls.push({ tool: "tasks_overview", args: { scope: "vencidas" } });
    } else if (/\bmis\b|\bmias\b/.test(q)) {
      calls.push({ tool: "tasks_overview", args: { scope: "mias" } });
    } else {
      // Incluye "¿qué depende de <nombre>?": se listan abiertas y se filtra
      // por nombre en la composición (no hay tool de resolución nombre→uuid).
      calls.push({ tool: "tasks_overview", args: { scope: "abiertas" } });
    }
    return calls;
  }
  if (/workflow|trabad|estancad/.test(q)) {
    calls.push({ tool: "workflows_stuck", args: {} });
    return calls;
  }
  // fix/f5-2: organigrama — quién es X / a cargo de / roles / estructura.
  if (
    /organigrama|presidente|vicepresidente|director|gerente|gerencia|quien (es|esta|maneja|dirige|lidera)|a cargo|jerarquia|estructura|autoridades|quien manda|responsable de/.test(
      q
    )
  ) {
    // extrae el término de rol/área para filtrar (comercial, operaciones, etc.).
    const roleMatch = q.match(
      /(presidente|vicepresidente|director|gerente|comercial|operaciones|administracion|facturaci|mantenimiento|seguridad|legal|contable)/
    );
    calls.push({
      tool: "organization_overview",
      args: roleMatch ? { query: roleMatch[1] } : {},
    });
    return calls;
  }
  if (/cliente/.test(q) && /problema|critic|riesgo/.test(q)) {
    calls.push({ tool: "clients_health", args: {} });
    return calls;
  }
  if (/manana|primero|prioridad|agenda|que miro/.test(q)) {
    calls.push({ tool: "my_agenda", args: {} });
    return calls;
  }
  if (/(que paso|resumen|resumi|novedad)/.test(q) || /hoy|ayer/.test(q)) {
    calls.push({ tool: "ops_digest", args: { hours: /ayer/.test(q) ? 48 : 24 } });
    return calls;
  }
  if (/deposito|almacen|wms/.test(q)) {
    calls.push({ tool: "ops_digest", args: {} });
    calls.push({ tool: "search_knowledge", args: { query: "deposito" } });
    return calls;
  }
  // Default: búsqueda general con la pregunta como query.
  calls.push({
    tool: "search_knowledge",
    args: { query: question.slice(0, 200) },
  });
  return calls;
}

/** Filtro opcional por nombre propio ("¿qué depende de José Luis?"). */
function filterByPersonName(question: string, chunks: SourceChunk[]): SourceChunk[] {
  const m = norm(question).match(/(?:depende[n]? de|tareas de)\s+([a-z]+(?:\s+[a-z]+)?)/);
  if (!m) return chunks;
  const name = m[1].trim();
  const filtered = chunks.filter((c) => norm(`${c.title} ${c.excerpt}`).includes(name));
  return filtered.length > 0 ? filtered : chunks;
}

function compose(question: string, chunks: SourceChunk[]): string {
  const relevant = filterByPersonName(question, chunks).slice(0, 8);
  if (relevant.length === 0) return NO_EVIDENCE;
  const intro = `Esto es lo que encuentro en Nexus (${relevant.length} fuente${
    relevant.length === 1 ? "" : "s"
  }):`;
  const bullets = relevant.map((c) => {
    const excerpt = c.excerpt.length > 220 ? `${c.excerpt.slice(0, 220)}…` : c.excerpt;
    return `• ${c.title}${excerpt ? ` — ${excerpt}` : ""} [${c.sourceId}]`;
  });
  const outro =
    "Verificá el detalle en las fuentes citadas antes de tomar una decisión.";
  return [intro, ...bullets, outro].join("\n");
}

export class MockProvider implements AiProvider {
  readonly name = "mock";
  readonly model = "mock-deterministic-v1";

  async plan(req: ProviderTurnRequest): Promise<ProviderTurnResponse> {
    // Harness de test (F5.1-b.0.1.1): sentinela que fuerza un 'final' VACÍO para
    // verificar que el engine NO deja pasar 'answered' vacío. No matchea preguntas reales.
    if (norm(req.question).includes("__force_empty_answer__")) {
      return { kind: "final", answer: "" };
    }
    // Harness (F5.1-b.0.1.1): round 1 recupera chunks (tool), luego devuelve 'final' VACÍO
    // → prueba el guard de respuesta vacía DESPUÉS de recuperar evidencia (empty-after-tools).
    if (norm(req.question).includes("__empty_after_tools__")) {
      if (req.round === 1 && req.chunks.length === 0) {
        return { kind: "tool_calls", toolCalls: [{ tool: "incidents_overview", args: {} }] };
      }
      return { kind: "final", answer: "" };
    }
    // Harness (P1b · fix/f5-2): sentinela que fuerza un tool-call con args INVÁLIDOS
    // (enum inexistente) → el engine debe SALTEAR la call y degradar limpio, nunca
    // caer en outcome 'error' (reproduce el crash real de Gemini con limit>50).
    if (norm(req.question).includes("__bad_tool_args__")) {
      if (req.round === 1 && req.chunks.length === 0) {
        return {
          kind: "tool_calls",
          toolCalls: [{ tool: "tasks_overview", args: { scope: "todas" } }],
        };
      }
      return { kind: "final", answer: NO_EVIDENCE };
    }
    // Round 1 sin evidencia: pedir tools según la pregunta.
    if (req.round === 1 && req.chunks.length === 0) {
      return { kind: "tool_calls", toolCalls: pickTools(req.question) };
    }
    // Round 2 con id puntual resuelto vía search: pedir cronología.
    const id = req.question.match(PUBLIC_ID_RE)?.[0]?.toUpperCase();
    if (id && req.round === 2) {
      const hit = req.chunks.find((c) => c.publicId?.toUpperCase() === id);
      if (hit && hit.tool === "search_knowledge") {
        return {
          kind: "tool_calls",
          toolCalls: [
            {
              tool: "entity_timeline",
              args: { entityType: hit.entityType, entityId: hit.entityId },
            },
          ],
        };
      }
    }
    // Composición final (determinista, solo desde chunks).
    return { kind: "final", answer: compose(req.question, req.chunks) };
  }
}
