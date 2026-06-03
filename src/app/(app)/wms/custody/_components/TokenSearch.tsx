"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";

/** Resolver de QR por token → navega a /c/{token} (resolución sin PII). */
export function TokenSearch() {
  const router = useRouter();
  const [token, setToken] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); const t = token.trim(); if (t) router.push(`/c/${t}`); }}
      className="flex items-end gap-2"
    >
      <label className="flex flex-col gap-1">
        <span className="kpi-label">Resolver token (QR)</span>
        <input value={token} onChange={(e) => setToken(e.target.value)} className="input" placeholder="custody_token…" />
      </label>
      <button type="submit" className="btn btn-primary btn-sm"><Icon name="qr" size={12} /> Resolver</button>
    </form>
  );
}
