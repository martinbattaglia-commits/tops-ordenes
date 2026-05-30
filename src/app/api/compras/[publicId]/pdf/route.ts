import { NextResponse } from "next/server";
import { getPurchaseOrder } from "@/lib/compras/data";
import { buildPoPdf } from "@/lib/compras/pdf/build";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { publicId: string } }
) {
  const po = await getPurchaseOrder(params.publicId);
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const pdf = await buildPoPdf(po);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${po.public_id}.pdf"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
