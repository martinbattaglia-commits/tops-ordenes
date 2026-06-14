/**
 * ContractsDataModel.tsx — Modelo de datos conceptual (Cap. 6.7). Seis entidades
 * (contracts + amendments / documents / alerts / events / status) materializadas en
 * la migración 0076. Vista documental — sin interacción.
 */

interface Entity {
  name: string;
  desc: string;
  fields: string[];
}

const ENTITIES: Entity[] = [
  {
    name: "contracts",
    desc: "Entidad central — un registro por contrato",
    fields: [
      "id PK", "client_id FK", "tipo (ANMAT/CG)", "razon_social · cuit",
      "deposito · ubicacion · m2", "canon · moneda", "ajuste_indice · frecuencia",
      "fecha_firma/inicio/fin", "plazo_meses · preaviso_dias",
      "renovacion_automatica · max_periodos", "status_id FK", "riesgo",
    ],
  },
  {
    name: "contract_amendments",
    desc: "Adendas, renovaciones, rescisiones, ajustes",
    fields: [
      "id PK", "contract_id FK", "tipo (adenda/renovacion/rescision)",
      "fecha · vigencia_desde", "campo_modificado", "valor_anterior → valor_nuevo",
      "documento_id FK",
    ],
  },
  {
    name: "contract_documents",
    desc: "Instrumentos vinculados a Google Drive",
    fields: ["id PK", "contract_id FK", "tipo_doc", "titulo · drive_file_id · url", "fecha · firmado", "hash_firma"],
  },
  {
    name: "contract_alerts",
    desc: "Alertas del motor de vencimientos",
    fields: ["id PK", "contract_id FK", "nivel (90/60/30/15/7/vencido)", "fecha_disparo · estado", "destinatario · canal"],
  },
  {
    name: "contract_events",
    desc: "Bitácora de auditoría (log inmutable)",
    fields: ["id PK", "contract_id FK", "tipo_evento", "fecha · usuario", "detalle"],
  },
  {
    name: "contract_status",
    desc: "Catálogo de estados + color de semáforo",
    fields: ["id PK", "nombre", "color", "orden"],
  },
];

export function ContractsDataModel() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {ENTITIES.map((e) => (
          <div key={e.name} className="card overflow-hidden p-0">
            <div className="bg-[#15406B] px-3.5 py-2 text-[13px] font-bold text-white">⛁ {e.name}</div>
            <ul className="px-3.5 py-2.5">
              <li className="py-0.5 text-[12px] text-fg-muted">{e.desc}</li>
              {e.fields.map((f) => (
                <li key={f} className="border-b border-dotted border-stroke-soft py-1 text-[12px] text-fg-secondary last:border-0">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="rounded-lg border-l-4 border-[#C8A24B] bg-[#FBF6E9] px-4 py-3 text-[12.5px] text-[#1C2733]">
        <b>Relaciones:</b> contracts 1—N amendments · 1—N documents · 1—N alerts · 1—N events · N—1
        status. <b>Métricas derivadas:</b> dias_a_vencimiento, meses_restantes, semáforo,
        facturación mensual/anual comprometida, % por riesgo, renovaciones pendientes, contratos sin
        instrumento, canon desactualizado. <b>Persistencia:</b> migración{" "}
        <code className="rounded bg-bg-surface-alt px-1">0076_crm_contracts.sql</code> (pendiente de
        aplicar).
      </div>
    </div>
  );
}
