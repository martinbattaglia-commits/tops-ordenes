import type { DedupKeyExtractorPort } from "@/lib/udie/kernel/ports";
import type { ProspectImportInput } from "../../../domain/prospect";
import { DeduplicationPolicy } from "../../../domain/services/deduplication-policy";

const norm = (s: string | null | undefined) => {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
};

export const prospectDedupKeys: DedupKeyExtractorPort<ProspectImportInput> = {
  keysOf(row) {
    const cuit = norm(row.cuit)?.replace(/\D/g, "") ?? null;
    const email = norm(row.email)?.toLowerCase() ?? null;
    const linkedinUrl = norm(row.linkedin_url)?.toLowerCase() ?? null;
    return { cuit, email, linkedinUrl };
  },
  primaryKey(row) {
    const k = this.keysOf(row);
    return DeduplicationPolicy.primaryKey({ cuit: k.cuit, email: k.email, linkedinUrl: k.linkedinUrl });
  },
};
