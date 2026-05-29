import { MOCK_PURCHASE_ORDERS } from "@/lib/compras/compras-mock";
import { DOCS as ANMAT_DOCS } from "@/lib/anmat/data";

export type DocType =
  | "OC PDF"
  | "Contrato"
  | "Habilitación"
  | "Auditoría"
  | "Procedimiento"
  | "Capacitación"
  | "Factura"
  | "Remito";

export interface DocItem {
  id: string;
  title: string;
  type: DocType;
  vendor?: string;
  client?: string;
  uploadedAt: string;
  size: string;
  hash: string;
  href?: string;
  tags: string[];
}

/**
 * Centro documental unificado: combina OC PDFs, contratos ANMAT,
 * habilitaciones, auditorías, capacitaciones, facturas y remitos.
 */
export function listDocs(): DocItem[] {
  const ocDocs: DocItem[] = MOCK_PURCHASE_ORDERS.slice(0, 12).map((po) => ({
    id: `oc-${po.id}`,
    title: `OC ${po.public_id} · ${po.vendor?.razon}`,
    type: "OC PDF",
    vendor: po.vendor?.razon,
    uploadedAt: po.date.slice(0, 10),
    size: "312 KB",
    hash: po.integrity_hash ?? "—",
    href: `/api/compras/${po.public_id}/pdf`,
    tags: [po.vendor?.categoria ?? "", po.signed_by ? "Firmada" : "Sin firma"].filter(Boolean),
  }));

  const anmat: DocItem[] = ANMAT_DOCS.map((d) => ({
    id: d.id,
    title: d.title,
    type: d.type as DocType,
    client: d.client,
    uploadedAt: d.uploadedAt,
    size: d.size,
    hash: d.hash,
    tags: ["ANMAT", d.type],
  }));

  const extras: DocItem[] = [
    {
      id: "fact-001",
      title: "Factura A-0003-00080012 · Pallets Sur S.R.L.",
      type: "Factura",
      vendor: "Pallets Sur S.R.L.",
      uploadedAt: "2026-05-24",
      size: "184 KB",
      hash: "8c1e4a7f2b9d6c...",
      tags: ["Factura A", "Conciliada"],
    },
    {
      id: "fact-002",
      title: "Factura A-0003-00080015 · Combustibles AMBA",
      type: "Factura",
      vendor: "Combustibles AMBA S.A.",
      uploadedAt: "2026-05-22",
      size: "166 KB",
      hash: "3a9c2e5b8d1f7e...",
      tags: ["Factura A"],
    },
    {
      id: "rem-001",
      title: "Remito R-0034-00021876 · Bidcom S.A.",
      type: "Remito",
      client: "Bidcom S.A.",
      uploadedAt: "2026-05-23",
      size: "92 KB",
      hash: "6d4f1a8c3e5b9d...",
      tags: ["Remito", "Despacho"],
    },
    {
      id: "cont-001",
      title: "Contrato de almacenaje · Roemmers S.A.I.C.F.",
      type: "Contrato",
      client: "Roemmers S.A.I.C.F.",
      uploadedAt: "2026-04-30",
      size: "624 KB",
      hash: "f1c8a4e9b2d6c3...",
      tags: ["Contrato", "ANMAT", "Vigente"],
    },
    {
      id: "cont-002",
      title: "Contrato logística integral · L'Oréal Argentina",
      type: "Contrato",
      client: "L'Oréal Argentina",
      uploadedAt: "2026-03-18",
      size: "812 KB",
      hash: "9b2e7d4a1c8f3e...",
      tags: ["Contrato", "Cosmética", "ANMAT"],
    },
  ];

  return [...ocDocs, ...anmat, ...extras].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
}

export function getDocTypes(): DocType[] {
  return ["OC PDF", "Contrato", "Habilitación", "Auditoría", "Procedimiento", "Capacitación", "Factura", "Remito"];
}
