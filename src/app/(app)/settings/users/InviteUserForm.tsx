"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { inviteUser } from "./actions";

export function InviteUserForm() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"admin" | "operaciones" | "supervisor" | "cliente">(
    "operaciones"
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await inviteUser({ email, full_name: fullName, role });
      if (!res.ok) {
        setError(res.error ?? "No pudimos invitar al usuario.");
        return;
      }
      setInfo(`Invitación enviada a ${email}.`);
      setEmail("");
      setFullName("");
    });
  };

  return (
    <form
      onSubmit={submit}
      className="card card-pad flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <label className="field-label">Nombre completo<span className="req">*</span></label>
        <input
          className="input"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Apellido y nombre"
        />
      </div>
      <div className="flex-1">
        <label className="field-label">Email<span className="req">*</span></label>
        <input
          className="input"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nombre@logisticatops.com"
        />
      </div>
      <div className="w-full sm:w-44">
        <label className="field-label">Rol</label>
        <select
          className="input"
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
        >
          <option value="operaciones">Operaciones</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Admin</option>
          <option value="cliente">Cliente</option>
        </select>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        <Icon name="send" size={14} />
        {pending ? "Enviando…" : "Invitar"}
      </button>

      {(error || info) && (
        <div className="w-full">
          {error && (
            <div className="rounded-md bg-status-danger/10 text-status-danger text-sm px-3 py-2 border border-status-danger/20">
              {error}
            </div>
          )}
          {info && (
            <div className="rounded-md bg-status-success/10 text-status-success text-sm px-3 py-2 border border-status-success/20">
              {info}
            </div>
          )}
        </div>
      )}
    </form>
  );
}
