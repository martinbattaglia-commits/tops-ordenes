import { NextRequest, NextResponse } from "next/server";
import { rejectRecon } from "@/lib/recon/data";
import { RejectSchema } from "@/lib/recon/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { reconId } = body;
    const parsed = RejectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }
    if (!reconId) return NextResponse.json({ error: "reconId requerido" }, { status: 400 });
    await rejectRecon(reconId, parsed.data.note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
