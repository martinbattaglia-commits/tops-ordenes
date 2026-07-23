"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { searchProfilesAction, type ProfileHit } from "@/lib/connect/adapters/driving/channel-actions";

/**
 * DEFECT-3 (piloto F3): autocomplete de usuarios internos para agregar miembros.
 * Reemplaza el input "profile_id (uuid)". Busca por nombre/email vía RPC segura
 * (connect_search_profiles, gate connect.view), NO expone externos, resuelve el
 * profile_id de la selección. Debounce + descarte de respuestas fuera de orden.
 */
export function MemberSearch({
  onAdd,
  disabled = false,
  placeholder = "Agregar: buscá por nombre o email…",
  ariaLabel = "Buscar usuario interno para agregar al canal",
  hint = "Solo usuarios internos. Buscá por nombre o email y seleccioná.",
}: {
  onAdd: (profileId: string) => Promise<boolean>;
  disabled?: boolean;
  /** F4.1C: textos configurables — el componente también se reusa para delegar notificaciones. */
  placeholder?: string;
  ariaLabel?: string;
  hint?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProfileHit[]>([]);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();
  const seqRef = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setMsg(null);
      setOpen(false);
      return;
    }
    const seq = ++seqRef.current;
    const t = setTimeout(() => {
      startSearch(async () => {
        const r = await searchProfilesAction({ q: query });
        if (seq !== seqRef.current) return; // descarta respuestas fuera de orden (race)
        if (!r.ok) {
          setHits([]);
          setMsg(r.message);
          setOpen(true);
          return;
        }
        setHits(r.hits);
        setMsg(r.hits.length === 0 ? "No se encontró un usuario interno con ese dato." : null);
        setOpen(true);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function pick(hit: ProfileHit) {
    setMsg(null);
    startAdd(async () => {
      const ok = await onAdd(hit.profileId);
      if (ok) {
        setQ("");
        setHits([]);
        setOpen(false);
      }
    });
  }

  const label = (h: ProfileHit) => h.fullName?.trim() || "Usuario interno";
  const busy = disabled || adding;

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (hits.length > 0 || msg) setOpen(true);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={busy}
        className="w-full rounded border border-stroke-soft bg-bg-page px-2 py-1 text-[11px] text-fg-primary outline-none focus:border-tops-red disabled:opacity-60"
      />
      {open && (msg !== null || hits.length > 0) && (
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-full overflow-y-auto rounded border border-stroke-soft bg-bg-surface shadow-lg">
          {hits.map((h) => (
            <button
              key={h.profileId}
              type="button"
              disabled={adding}
              onClick={() => pick(h)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-bg-surface-alt disabled:opacity-50"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bg-surface-alt text-[9px] font-bold text-fg-secondary">
                {label(h).slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-fg-primary">{label(h)}</span>
              </span>
              <Icon name="plus" size={12} className="shrink-0 text-fg-link" />
            </button>
          ))}
          {msg !== null && <p className="px-2 py-1.5 text-[11px] text-fg-muted">{msg}</p>}
        </div>
      )}
      <p className="mt-1 text-[10px] text-fg-muted">
        {searching ? "Buscando…" : hint}
      </p>
    </div>
  );
}
