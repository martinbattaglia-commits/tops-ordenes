import { NextRequest, NextResponse } from "next/server";
import { startRecon } from "@/lib/recon/data";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const StartSchema = z.object({
  invoiceId: z.string().uuid("invoiceId debe ser un UUID válido"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { poId: string } },
) {
  const supabase = createClient();
  if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // Validar que poId pertenece a una OC existente y accesible
  const { data: po, error: poErr } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("id", params.poId)
    .maybeSingle();
  if (poErr) return NextResponse.json({ error: "Error al verificar la OC" }, { status: 500 });
  if (!po) return NextResponse.json({ error: "OC no encontrada" }, { status: 404 });

  try {
    const body = await req.json();
    const parsed = StartSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }
    const { invoiceId } = parsed.data;
    const result = await startRecon(params.poId, invoiceId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
