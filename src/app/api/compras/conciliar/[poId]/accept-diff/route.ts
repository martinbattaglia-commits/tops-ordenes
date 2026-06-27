import { NextRequest, NextResponse } from "next/server";
import { acceptDiff } from "@/lib/recon/data";
import { AcceptDiffSchema } from "@/lib/recon/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = AcceptDiffSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }
    await acceptDiff(parsed.data.diffId, parsed.data.note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}
