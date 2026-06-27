// src/lib/recon/validation.ts
import { z } from "zod";

export const RejectSchema = z.object({
  note: z.string().min(5, "La nota es obligatoria (mín. 5 caracteres)"),
});

export const AcceptDiffSchema = z.object({
  diffId: z.string().uuid(),
  note: z.string().optional(),
});

export const AddNoteSchema = z.object({
  note: z.string().min(1, "La nota no puede estar vacía"),
});
