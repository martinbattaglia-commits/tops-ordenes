"use client";

/**
 * Registrar movimiento operativo de Tesorería (operatoria diaria, sin proveedor).
 * RPC-First: solo registerOperationalMovementAction. Ninguna regla financiera acá.
 *
 * Una sola cuenta (ingreso o egreso). Las transferencias entre cuentas NO se
 * gestionan acá: usan el flujo de Transferencias existente (no se duplica lógica).
 */
import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerOperationalMovementAction } from "@/lib/tesoreria/actions";
import {
  OPERATIONAL_CATEGORY_VALUES,
  OPERATIONAL_CATEGORY_LABELS,
  OPERATIONAL_CATEGORY_DIRECTION,
  OPERATIONAL_CATEGORY_REQUIRES_BENEFICIARY,
  BENEFICIARY_KIND_VALUES,
  BENEFICIARY_KIND_LABELS,
  type BankAccount,
  type Beneficiary,
  type BeneficiaryKind,
  type OperationalCategory,
} from "@/lib/tesoreria/types";

const today = () => new Date().toISOString().slice(0, 10);

/** Valor centinela del selector: "no está en la lista, lo doy de alta ahora". */
const NUEVO = "__nuevo__";

export function MovimientoOperativoForm({
  accounts,
  beneficiaries,
}: {
  accounts: BankAccount[];
  beneficiaries: Beneficiary[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [category, setCategory] = useState<OperationalCategory>("gasto_operativo");
  const [direction, setDirection] = useState<string>(OPERATIONAL_CATEGORY_DIRECTION["gasto_operativo"] ?? "egreso");
  const [bankId, setBankId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [concept, setConcept] = useState("");

  // Beneficiario: id del catálogo, "" (ninguno) o NUEVO (alta implícita).
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<BeneficiaryKind>("tercero");
  const [newDoc, setNewDoc] = useState("");

  const requiresBeneficiary = OPERATIONAL_CATEGORY_REQUIRES_BENEFICIARY[category];
  const creatingNew = beneficiaryId === NUEVO;
  // Espejo de la regla de la RPC: avisamos antes de ir al servidor.
  const beneficiaryMissing =
    requiresBeneficiary && (beneficiaryId === "" || (creatingNew && !newName.trim()));

  function onCategory(next: OperationalCategory) {
    setCategory(next);
    const suggested = OPERATIONAL_CATEGORY_DIRECTION[next];
    if (suggested) setDirection(suggested);
    // Sugerencia de tipo cuando se dé de alta un beneficiario nuevo.
    if (next === "honorarios") setNewKind("profesional");
    else if (next === "adelanto_director") setNewKind("director");
    else if (next === "adelanto_sueldo") setNewKind("empleado");
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const r = await registerOperationalMovementAction({
        date,
        category,
        direction,
        bank_account_id: bankId,
        amount,
        concept,
        beneficiary_id: creatingNew || beneficiaryId === "" ? null : beneficiaryId,
        beneficiary_name: creatingNew ? newName : null,
        beneficiary_kind: creatingNew ? newKind : null,
        beneficiary_document: creatingNew ? newDoc : null,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setAmount("");
        setConcept("");
        setNewName("");
        setNewDoc("");
        // Si se dio de alta un beneficiario, el selector se repuebla al refrescar.
        if (creatingNew) setBeneficiaryId("");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="card p-5 grid gap-3 max-w-xl">
      <h3 className="font-semibold">Registrar movimiento operativo</h3>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="field-label block mb-1.5">Tipo de movimiento</span>
          <select className="input" value={category} onChange={(e) => onCategory(e.target.value as OperationalCategory)}>
            {OPERATIONAL_CATEGORY_VALUES.map((c) => (
              <option key={c} value={c}>{OPERATIONAL_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="field-label block mb-1.5">Dirección</span>
          <select className="input" value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="egreso">Egreso (sale dinero)</option>
            <option value="ingreso">Ingreso (entra dinero)</option>
          </select>
        </label>

        <label className="block">
          <span className="field-label block mb-1.5">Cuenta</span>
          <select className="input" value={bankId} onChange={(e) => setBankId(e.target.value)} required>
            <option value="">Seleccionar…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.bank_name} · {a.account_name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="field-label block mb-1.5">Importe</span>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
        </label>

        <label className="block">
          <span className="field-label block mb-1.5">Fecha</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>

      <label className="block">
        <span className="field-label block mb-1.5">
          Beneficiario {requiresBeneficiary ? <span className="text-red-600">*</span> : <span className="text-fg-muted">(opcional)</span>}
        </span>
        <select className="input" value={beneficiaryId} onChange={(e) => setBeneficiaryId(e.target.value)}>
          <option value="">{requiresBeneficiary ? "Seleccionar…" : "Sin beneficiario"}</option>
          {beneficiaries.map((b) => (
            <option key={b.id} value={b.id}>
              {b.full_name}
              {b.document_id ? ` · ${b.document_id}` : ""}
            </option>
          ))}
          <option value={NUEVO}>+ Registrar un beneficiario nuevo…</option>
        </select>
      </label>

      {creatingNew && (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-dashed p-3">
          <label className="block col-span-2">
            <span className="field-label block mb-1.5">Nombre y apellido / Razón social</span>
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ej.: Juan Pérez"
              required
            />
          </label>
          <label className="block">
            <span className="field-label block mb-1.5">Tipo</span>
            <select className="input" value={newKind} onChange={(e) => setNewKind(e.target.value as BeneficiaryKind)}>
              {BENEFICIARY_KIND_VALUES.map((k) => (
                <option key={k} value={k}>{BENEFICIARY_KIND_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label block mb-1.5">CUIT / CUIL / DNI</span>
            <input className="input" value={newDoc} onChange={(e) => setNewDoc(e.target.value)} placeholder="20-12345678-9" />
          </label>
          <p className="col-span-2 text-xs text-fg-muted">
            Queda registrado en el catálogo de Tesorería y disponible para los próximos movimientos.
          </p>
        </div>
      )}

      <label className="block">
        <span className="field-label block mb-1.5">Concepto</span>
        <input className="input" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej.: Adelanto a Dirección — septiembre" required />
      </label>

      {msg && <p className={msg.ok ? "text-green-600 text-sm" : "text-red-600 text-sm"}>{msg.text}</p>}
      {beneficiaryMissing && (
        <p className="text-amber-600 text-sm">
          La categoría «{OPERATIONAL_CATEGORY_LABELS[category]}» exige identificar al beneficiario.
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || beneficiaryMissing}>
          {pending ? "Registrando…" : "Registrar movimiento"}
        </button>
        <span className="text-xs text-fg-muted">
          ¿Transferencia entre cuentas? <Link href="/tesoreria/bancos" className="fg-link underline">Usá Transferencias</Link>
        </span>
      </div>
    </form>
  );
}
