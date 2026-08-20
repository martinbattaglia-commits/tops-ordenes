import React from "react";
import { IngestaClient } from "./IngestaClient";
import { listDocumentInbox } from "@/lib/finanzas/data";

export const dynamic = "force-dynamic";

export default async function IngestaPage() {
  const items = await listDocumentInbox();
  return <IngestaClient initialItems={items} />;
}
