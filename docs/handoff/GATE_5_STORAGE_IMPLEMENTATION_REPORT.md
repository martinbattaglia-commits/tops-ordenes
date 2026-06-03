# GATE 5.1 — Custody Storage Layer (`0037`) · REPORTE DE IMPLEMENTACIÓN

> Estado: **implementado (código). Migración `0037` PENDIENTE de aplicar a Supabase** (la aplica Martín en
> el SQL Editor). Alcance: **solo `0037` Storage Layer** — NO `0038`/`0039`/Gate 6. Sin upload RPC, sin
> evidencia/POD/timeline/PDF/firma/UI/TS/Server Actions. Sin push. Fecha: 2026-06-03.
> Roles: Principal Architect + Security + Compliance + Staff Engineer. Precedente directo: `0010_documents`.

---

## 1. Resumen

`0037_custody_storage.sql` agrega la **capa de almacenamiento** de la Cadena de Custodia: 3 **buckets
privados**, sus **policies de `storage.objects`** (PII con gating más estricto), el **modelo de retención**
(solo columnas) y la RPC **`emit_custody_signed_url`** que **autoriza + audita la lectura** de evidencia.
Es **additive** sobre `0036` (Custody Core) y replica el patrón seguro de `0010_documents`.

---

## 2. Buckets privados (3) — NO reutiliza los legacy

| Bucket | Contenido | `public` | Límite | MIME |
|---|---|---|---|---|
| `custody-evidence` | fotos packing/carga/entrega | **false** | 8 MiB | jpeg/png/webp |
| `custody-pii` | firmas + documentos del receptor (**PII**) | **false** | 2 MiB | png/jpeg/pdf |
| `custody-pod` | PDFs de POD generados | **false** | 10 MiB | pdf |

- Creados con `insert into storage.buckets ... on conflict (id) do update set public=false, ...` (patrón 0010, idempotente).
- **NO** se tocan `signatures`/`pdfs`/`attachments` (0003).

---

## 3. Seguridad (storage.objects RLS · patrón 0010)

| Policy | Acción | Regla |
|---|---|---|
| `custody evidence/pod read` | SELECT | `custody-evidence`/`custody-pod` · `current_role() in (admin,operaciones,supervisor)` |
| `custody pii read strict` | SELECT | `custody-pii` · **`current_role() in (admin,supervisor)`** (sin operaciones) |
| `custody write internal` | INSERT | 3 buckets · personal interno |
| `custody update internal` | UPDATE | 3 buckets · personal interno |
| `custody delete admin` | DELETE | 3 buckets · **solo admin** |

- Defensa en capas: el acceso normal a binarios es por **signed URL**; estas policies gobiernan el acceso
  directo autenticado. **PII más restrictiva.**

---

## 4. RPC `emit_custody_signed_url(p_evidence_id, p_reason, p_ip) → jsonb`

`SECURITY DEFINER` · `revoke from public/anon` · `grant to authenticated, service_role`.

**Hace (patrón 0010):**
1. **Valida permisos** (auto-validación porque SECURITY DEFINER bypassa RLS): `current_role()` no nulo;
   **gating por bucket** — `custody-pii` → `admin/supervisor`; resto → `admin/operaciones/supervisor`.
2. **Rechaza** evidencia inexistente o **redactada** (PII borrada → sin acceso).
3. **Registra auditoría de LECTURA** en `audit_log`: `action='custody.access'`, `entity='custody_evidence'`,
   `entity_id=evidence_id`, `user_id=auth.uid()` (**usuario**), `ts` (**fecha**), `ip`, y `payload` con
   **bucket / path / kind / reason (motivo)**.
4. **Devuelve el grant** (`{evidence_id, bucket, path, kind, reason, issued_by, issued_at}`).

> **Firma del signed URL (decisión arquitectónica, precedente 0010):** Postgres **no** firma URLs de Storage
> (eso lo hace el storage-api con el JWT secret) ni tiene trigger de SELECT. Por eso esta RPC es el **portón de
> autorización + auditoría**; la **firma criptográfica del signed URL la realiza la APP** (Supabase SDK /
> service-role) usando el grant devuelto. Igual que `log_document_event` en 0010. La auditoría de lectura queda
> **DB-enforced** en el único camino autorizado de emisión.

---

## 5. Modelo de retención (solo columnas · sin borrados/cron/workers)

`custody_evidence` += `retention_class text` (CHECK `evidence|pii|pod`) + `retention_until timestamptz` +
índice `(retention_until)`.

- **Tiered por sensibilidad** (lo **setea** la RPC de 0038 al adjuntar evidencia): `pii` retención mínima ·
  `evidence` según SLA · `pod` retención máxima.
- Tras vencer, el binario puede archivarse a frío **conservando siempre** la fila inmutable + `sha256` +
  hash-chain. **NO** se implementa ningún borrado/cron/worker (fuera de alcance).

---

## 6. ⚠️ Backup de Storage — ADVERTENCIA EXPLÍCITA

**El Storage de Supabase NO está cubierto por el backup de la DB NI por PITR** (que además está
deshabilitado). Los binarios de custodia (fotos, firmas, documentos, PDFs de POD) **requieren una estrategia
de backup/replicación SEPARADA y OBLIGATORIA** antes de operar Gate 5 en producción. Documentado en el header
de `0037` y aquí. **Bloqueante operativo** previo a captura real de evidencia (0038+).

---

## 7. Validación

> ⚠️ **`0037` no fue aplicada** (la aplica Martín) → el kit aún no se corrió.

`gate5_storage_validation_report.sql` (**9 casos, 0 footprint**):
C1 3 buckets privados · C2 5 policies de `storage.objects` · C3 columnas de retención · C4 emit autorizado
(grant + auditoría `custody.access`) · C5 emit inexistente rechazado · C6 emit sobre redactada rechazado ·
C7 emit sin rol rechazado · C8 **gating PII** (emit OK ⇔ rol ∈ admin/supervisor) · C9 contenido de la
auditoría (usuario/entity_id/bucket/path/motivo).

- Buckets/policies son **persistentes** (creados por `0037`) → el kit **solo los lee** (0 footprint).
- Los tests de emit corren bajo `BEGIN/ROLLBACK` (el insert en `audit_log` se deshace por savepoint).
- **A confirmar al aplicar:** que `current_role()`/`auth.uid()` resuelvan con el JWT del SQL Editor; que el
  rol del usuario de prueba determine el resultado de C8.

---

## 8. Alcance NO incluido (fases siguientes)

- **`0038` Evidence + Chain RPC:** `attach_custody_evidence` (upload/captura), `register_custody_event`,
  `redact_custody_evidence` (erasure: borra binario + flip), `verify_custody_chain`.
- **`0039` POD + Reads:** `generate_pod`, `get_custody_by_token`, `get_custody_timeline`.
- **Capas app:** TS, UI/React, Server Actions, POD-PDF, captura de fotos/firma. **NO implementado.**

---

## 9. Checklist de cierre

| # | Paso | Estado |
|---|---|---|
| 1 | Migración `0037` | ✅ `supabase/migrations/0037_custody_storage.sql` |
| 2 | Kit SQL de validación | ✅ `gate5_storage_validation_report.sql` · ⏳ correr tras aplicar |
| 3 | Reporte de implementación | ✅ este documento |
| 4 | Commit local | ✅ (sin push) |

---

## 10. Próximos pasos (acción de Martín / OK)

1. **Definir backup de Storage** (no cubierto por DB/PITR) — bloqueante antes de captura real.
2. Backup manual de Supabase (PITR off). Aplicar `0037_custody_storage.sql`.
3. Correr `gate5_storage_validation_report.sql` → esperar **todo OK**.
4. **Con OK explícito:** continuar con `0038` (Evidence RPC). **NO iniciado.**

---

> **FIN — Gate 5.1 Custody Storage (`0037`) implementado (código). Migración pendiente de aplicar. Sin push.**
> **NO iniciado: `0038` Evidence · `0039` POD · Gate 6.** Esperar aprobación explícita. Detenido.
