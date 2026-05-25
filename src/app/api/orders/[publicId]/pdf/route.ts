import { NextResponse, type NextRequest } from "next/server";
import { renderToStream } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { getOrder } from "@/lib/data/orders";
import { env } from "@/lib/env";
import { OrderPdfDocument } from "@/lib/pdf/OrderPdfDocument";

// Forzamos node runtime — react-pdf no corre en edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { publicId: string } }
) {
  const order = await getOrder(params.publicId);
  if (!order) {
    return new NextResponse("Orden no encontrada", { status: 404 });
  }

  const publicUrl = `${env.app.url}/orders/${order.public_id}`;
  const qrDataUrl = await QRCode.toDataURL(publicUrl, {
    margin: 1,
    color: { dark: "#050555", light: "#ffffff" },
    width: 280,
  });

  const doc = OrderPdfDocument({ order, qrDataUrl });
  const stream = await renderToStream(doc);

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  const buf = Buffer.concat(chunks);

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${order.public_id}.pdf"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
