/** Stub de `next/cache` para probar Server Actions sin runtime de Next. */
export const calls = [];
export function revalidatePath(p) { calls.push(p); }
export function revalidateTag(t) { calls.push(t); }
