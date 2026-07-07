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

function pickTools(question: string): ToolCall[] {
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
  // fix/f5-2 · ANALYTICS: totales/saldos/rankings van a tools agregadas (SQL calcula).
  if (/cuanto (se )?factur|cuanto facturamos|facturacion (total|mensual|del mes)/.test(q)) {
    calls.push({
      tool: "billing_summary",
      args: { mode: /este mes|mes actual/.test(q) ? "mes_actual" : "ultimo_mes" },
    });
    return calls;
  }
  if (/santander|galicia|saldo|plata hay|cuanta plata/.test(q) && !/proveedor/.test(q)) {
    const bank = q.match(/santander|galicia|caja/)?.[0];
    calls.push({
      tool: "bank_balances_overview",
      args: bank ? { query: bank } : {},
    });
    return calls;
  }
  if (
    /proveedor/.test(q) &&
    /presupuesto|gast|consume|mayor|mas caro|ranking|mas plata/.test(q)
  ) {
    const base = /presupuesto|comprom/.test(q) ? "compromiso" : "gasto";
    const periodo = /este mes|mes actual/.test(q)
      ? "mes_actual"
      : /ultimo mes/.test(q)
        ? "ultimo_mes"
        : /30 dias/.test(q)
          ? "ultimos_30_dias"
          : "todo";
    calls.push({ tool: "supplier_spend_overview", args: { base, periodo } });
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
    const mode = /vencer|vencimiento/.test(q)
      ? "por_vencer"
      : /firmad|firmo|firma/.test(q)
        ? "firmados_recientes"
        : "todos";
    calls.push({ tool: "contracts_overview", args: { mode } });
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
