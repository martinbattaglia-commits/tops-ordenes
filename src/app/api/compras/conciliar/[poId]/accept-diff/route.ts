import { NextRequest, NextResponse } from "next/server";
import { acceptDiff, assertDiffOwnership } from "@/lib/recon/data";
import { createClient } from "@/lib/supabase/server";
import { AcceptDiffSchema } from "@/lib/recon/validation";

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
    const parsed = AcceptDiffSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }
    const { diffId, note } = parsed.data;

    await assertDiffOwnership(diffId, params.poId);
    await acceptDiff(diffId, note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status === 403 ? 403 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status });
  }
}
