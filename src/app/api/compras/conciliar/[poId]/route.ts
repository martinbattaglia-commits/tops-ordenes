import { NextRequest, NextResponse } from "next/server";
import { startRecon } from "@/lib/recon/data";

export async function POST(
  req: NextRequest,
  { params }: { params: { poId: string } },
) {
  try {
    const { invoiceId } = await req.json();
    if (!invoiceId) {
      return NextResponse.json({ error: "invoiceId requerido" }, { status: 400 });
    }
    const result = await startRecon(params.poId, invoiceId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
