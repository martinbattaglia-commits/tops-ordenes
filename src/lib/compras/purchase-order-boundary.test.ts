import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const action = readFileSync(
  resolve(process.cwd(), "src/app/(app)/compras/nueva/actions.ts"),
  "utf8",
);
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0243_purchase_order_price_lifecycle.sql"),
  "utf8",
);
const email = readFileSync(resolve(process.cwd(), "src/lib/compras/email.ts"), "utf8");
const pdf = readFileSync(resolve(process.cwd(), "src/lib/compras/pdf/PoPdfDocument.tsx"), "utf8");
const pdfRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/compras/[publicId]/pdf/route.ts"),
  "utf8",
);
const storage = readFileSync(resolve(process.cwd(), "src/lib/compras/storage.ts"), "utf8");
const exportRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/compras/export/route.ts"),
  "utf8",
);
const deliveryStatus = readFileSync(
  resolve(process.cwd(), "src/lib/compras/delivery-status.ts"),
  "utf8",
);
const wizard = readFileSync(
  resolve(process.cwd(), "src/app/(app)/compras/nueva/NewPoWizard.tsx"),
  "utf8",
);

describe("frontera de confianza de emisión OC", () => {
  it("autoriza crear y firmar antes de leer el maestro o producir efectos", () => {
    const auth = action.indexOf('p_slug: "compras.create"');
    const sign = action.indexOf('p_slug: "compras.sign"');
    const vendorRead = action.indexOf('.from("vendors")');
    const issue = action.indexOf('supabase.rpc("purchase_order_issue"');
    expect(auth).toBeGreaterThan(0);
    expect(sign).toBeGreaterThan(auth);
    expect(vendorRead).toBeGreaterThan(sign);
    expect(issue).toBeGreaterThan(vendorRead);
    expect(sql).toContain("has_permission('compras.create')");
    expect(sql).toContain("has_permission('compras.sign')");
  });

  it("no crea proveedores desde el payload y usa identidad/destino canónicos en todo egress", () => {
    expect(action).not.toMatch(/\.from\("vendors"\)[\s\S]{0,120}?\.insert\(/);
    expect(action).not.toContain("data.destino");
    expect(action).toContain("assertCanonicalVendor(data.vendor");
    expect(action).toContain("destino: canonicalDestination");
    expect(action).toContain("razon: documentVendor.razon");
    expect(action).toContain("email: prepared.to_email");
    expect(sql).toContain("Proveedor inexistente o inactivo");
    expect(sql).toContain("Destino inconsistente con el depósito canónico");
  });

  it("registra sent_email sólo al finalizar el ledger idempotente y nunca por WhatsApp", () => {
    expect(action).toContain('"purchase_order_prepare_email_delivery"');
    expect(action).toContain('"purchase_order_begin_email_delivery"');
    expect(action).toContain('deliveryLedger.rpc("purchase_order_finalize_email_delivery"');
    expect(action).toContain("prepared.attempt_key");
    expect(action).toContain('status: ambiguous ? "unknown" : "failed"');
    expect(action).not.toMatch(/p_kind:\s*"sent_email"/);
    expect(action).toContain("No se registra como `sent_email`");
    expect(sql).toContain("function public.purchase_order_prepare_email_delivery");
    expect(sql).toContain("function public.purchase_order_finalize_email_delivery");
    expect(sql).toContain("revoke insert, update, delete, truncate on public.po_events");
    expect(sql).toContain("revoke insert, update, delete, truncate on public.po_email_sends");
    expect(email).toContain('"Idempotency-Key": idempotencyKey');
    expect(sql).toContain("'delivery_kind','notification_only'");
    expect(wizard).not.toContain("Recibirá el PDF firmado automáticamente");
    expect(wizard).toContain("el PDF firmado se entrega sólo por canal autorizado");
    expect(email).toContain("se entrega exclusivamente por un canal autorizado de TOPS");
  });

  it("usa un único snapshot de firmante y sirve el PDF firmado ya materializado", () => {
    expect(sql).toContain("v_emitter_name := v_signer");
    expect(sql).toContain("'signer_name', v_signer");
    expect(action).toContain("name: issued.emisor_name");
    expect(email).toContain("input.emitter.name");
    expect(email).not.toContain("ORG.emitter");
    expect(pdf).toContain("po.signed_by ?? po.emisor_name");
    expect(pdf).not.toContain("ORG.emitter");
    expect(pdfRoute).toContain("downloadPoPdf");
    expect(pdfRoute).not.toContain("buildPoPdf");
    expect(storage).toContain('PO_PDF_BUCKET = "po-pdfs-private"');
    expect(sql).toContain("bucket_id='po-pdfs-private'");
    expect(sql).not.toContain("update storage.buckets\nset public=false");
  });

  it("ata la evidencia de Drive a la RPC y nunca al campo directo", () => {
    expect(action).not.toMatch(/\.update\(\{[\s\S]{0,160}?drive_file_id:/);
    expect(sql).toContain("set drive_file_id=btrim(p_meta->>'file_id')");
    expect(sql).toContain("insert into public.po_events(order_id,kind,actor,meta)");
    expect(deliveryStatus).not.toContain("Boolean(driveFileId)");
  });

  it("consume errores del proveedor sin exponer body, destinatarios ni excepción cruda", () => {
    expect(email).toContain('res.text().catch(() => "")');
    expect(email).toContain('throw new Error("PO_EMAIL_PROVIDER_REJECTED")');
    expect(email).not.toContain("throw new Error(body");
    expect(action).not.toMatch(/console\.(?:error|warn)\([^\n]*(?:issueError|canonicalVendor\.email|data\.vendor\.email)/);
  });

  it("crea header/líneas/created atómicos y sólo firma al congelar el PDF", () => {
    expect(sql).toContain("insert into public.purchase_orders");
    expect(sql).toContain("insert into public.po_items");
    expect(sql).toContain("insert into public.po_events(order_id,kind,actor,actor_email,ip,meta)");
    expect(sql).toContain("into v_signer, v_emitter_email, v_emitter_role");
    expect(sql).toContain("v_signature_hash := encode(sha256(v_signature_bytes), 'hex')");
    expect(sql).toContain("'signer_email', v_emitter_email");
    expect(sql).toContain("(v_id,'created',v_signer");
    expect(sql).toContain("purchase_order_finalize_document");
    expect(sql).toContain("values (v_po.id,'signed',v_po.emisor_name");
    expect(action).not.toContain("data.signature.signed_by");
    expect(action).not.toContain("data.signature.hash");
    expect(sql).toContain("Los eventos de OC son inmutables (append-only)");
    expect(sql).toContain("function public.purchase_order_list_metrics");
    expect(sql).toContain("non_real_count");
  });

  it("protege lectura y exportación con RBAC y neutraliza fórmulas CSV", () => {
    expect(exportRoute).toContain('requirePurchasePermission("compras.export")');
    expect(exportRoute).toContain("PurchaseAccessError");
    expect(exportRoute).toContain("private, no-store");
    expect(exportRoute).toContain("X-Content-Type-Options");
    expect(exportRoute).toContain("^[\\s\\uFEFF]*[=+\\-@]");
    expect(exportRoute).toContain("`'${raw}`");
    expect(sql).toContain("using (coalesce(public.has_permission('compras.view'), false))");
    for (const policy of ["po read", "po_items read", "po_events read", "po_email read"]) {
      expect(sql).toContain(`create policy "${policy}"`);
    }
  });
});
