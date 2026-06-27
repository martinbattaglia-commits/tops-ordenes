import { NextRequest, NextResponse } from "next/server";
import { approveRecon } from "@/lib/recon/data";

export async function POST(req: NextRequest) {
  try {
    const { reconId, note } = await req.json();
    if (!reconId) return NextResponse.json({ error: "reconId requerido" }, { status: 400 });
    await approveRecon(reconId, note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
