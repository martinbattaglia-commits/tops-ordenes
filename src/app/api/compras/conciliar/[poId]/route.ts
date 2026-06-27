import { NextRequest, NextResponse } from "next/server";
import { startRecon } from "@/lib/recon/data";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  req: NextRequest,
  { params }: { params: { poId: string } },
) {
  const supabase = createClient();
  if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

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
