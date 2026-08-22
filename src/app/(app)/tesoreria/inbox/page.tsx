import React from "react";
import { IngestaClient } from "@/app/(app)/finanzas/ingesta/IngestaClient";
import { listDocumentInbox } from "@/lib/finanzas/data";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bandeja de Inbox · Tesorería",
  description: "Recepción, escaneo con IA y carga automática de facturas de proveedores.",
};

export default async function TesoreriaInboxPage() {
  const items = await listDocumentInbox();
  return <IngestaClient initialItems={items} />;
}
