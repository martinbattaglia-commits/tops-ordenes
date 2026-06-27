import { NextRequest, NextResponse } from "next/server";
import { addNote } from "@/lib/recon/data";
import { AddNoteSchema } from "@/lib/recon/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AddNoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }
    const { reconId } = body;
    if (!reconId) return NextResponse.json({ error: "reconId requerido" }, { status: 400 });
    await addNote(reconId, parsed.data.note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
