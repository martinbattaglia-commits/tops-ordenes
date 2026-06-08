# OPEN-ISSUES

**Fecha:** 2026-06-08 · TOPS NEXUS · Hallazgos QA clasificados. Política: corregir Críticos + Importantes; Menores/Cosméticos → backlog post-release.

---

## 🔴 Críticos (bloquean deploy)
_Ninguno._

---

## 🟠 Importantes (corregidos en esta fase)

### I-1 · `next lint` se rompía en el worktree (config cascade) — ✅ RESUELTO
- **Síntoma:** `npm run lint` → `Plugin "@next/next" was conflicted between ".eslintrc.json …" and "../../../.eslintrc.json …"` → EXIT 1.
- **Causa:** el worktree vive bajo `.../tops-ordenes/.claude/worktrees/…`; ESLint cascada hacia arriba y encuentra también el `.eslintrc.json` del repo raíz → plugin duplicado.
- **Impacto real:** solo afectaba `next lint` ejecutado dentro del worktree anidado. El lint interno de `next build` y CI (checkout standalone, sin config padre) no se ven afectados.
- **Fix:** se agregó `"root": true` a `.eslintrc.json` (detiene la cascada; inocuo en CI). `next lint` ahora → EXIT 0.

---

## 🟡 Menores (backlog)
_Ninguno detectado por los gates._

---

## ⚪ Cosméticos (backlog post-release)

### C-1 · 5 warnings `jsx-a11y/alt-text` en PDFs
- **Ubicación:** `src/lib/compras/pdf/PoPdfDocument.tsx` (216, 238) · `src/lib/custody/PodPdfDocument.tsx` (169, 218, 226).
- **Naturaleza:** los `<Image>` son de `@react-pdf/renderer` (render de PDF), **no** `<img>` del DOM → la regla de accesibilidad no aplica. Falso positivo.
- **Sugerencia backlog:** extender el override existente de `.eslintrc.json` (que ya silencia `src/lib/pdf/**`) para incluir `src/lib/compras/pdf/**` y `src/lib/custody/**`. No afecta runtime ni el build.

---

## 📋 Pendientes de gestión (no son bugs)

### P-1 · Migración 0069 `clientify_deal_name` — preparada, NO aplicada
- `supabase/migrations/0069_crm_opportunities_deal_name.sql` (aditiva, idempotente). Requiere **autorización explícita** para aplicar en prod. El front degrada con elegancia sin ella (muestra fallback comercial, nunca URL). No bloquea deploy. Ver CRM360-CLIENTIFY-DEAL-NAME-FIX.md.

### P-2 · Conteos antes/después del filtro de pipelines
- Verificación de cantidades de CRM360 quedó como SQL read-only para que el usuario ejecute (lectura de prod no autorizada al asistente). No bloquea deploy. Ver CRM360-KANBAN-DEFAULT-REPORT.md.

### P-3 · QA visual/runtime
- Navegación, responsive, mobile, dark mode, contraste, accesibilidad, consola/hydration en runtime: validados visualmente por el usuario. El asistente no puede auditar headless (auth gate). Sign-off final del usuario en el preview.
