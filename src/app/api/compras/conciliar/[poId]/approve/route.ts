import { NextRequest, NextResponse } from "next/server";
import { approveRecon, assertReconOwnership } from "@/lib/recon/data";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const ApproveSchema = z.object({
  reconId: z.string().uuid("reconId debe ser un UUID válido"),
  note:    z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { poId: string } },
) {
  const supabase = createClient();
  if (!supabase) return NextResponse.json({ error: "Servicio no disponible" }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const body = await req.json();
    const parsed = ApproveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }
    const { reconId, note } = parsed.data;

    await assertReconOwnership(reconId, params.poId);
    await approveRecon(reconId, note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status === 403 ? 403 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status });
  }
}
