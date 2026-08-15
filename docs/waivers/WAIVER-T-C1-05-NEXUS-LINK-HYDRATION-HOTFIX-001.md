# WAIVER · `T-C1-05` · `NEXUS-LINK-HYDRATION-HOTFIX-001`

> **Custody continúa técnicamente en rojo: 449/451.**
> Dirección dispensa exactamente dos aserciones de `T-C1-05`; no las
> reclasifica como PASS y no modifica ningún test ni su semántica.

## Decisión de Dirección

- Fecha: `2026-08-15`.
- Base canónica: `origin/main` =
  `65ca3ed4ced1427a90361a620e701400dbb4d180`.
- Rama: `codex/link-thread-hydration-hotfix`.
- Propósito exclusivo: corregir la divergencia entre el HTML SSR y el primer
  render cliente de `/connect/c/[conversationId]`.
- Test: `tests/custody-db/t-c1-05-append-only-vanilla.test.ts`.
- Resultado autorizado: **449/451 — dos aserciones WAIVED BY DIRECTION**.
- Resultado de referencia sobre `origin/main`: **450/451**, con sólo la primera
  aserción nominada en rojo.

Esta decisión es específica de este candidato. No altera ni amplía
`WAIVER-T-C1-05-NEXUS-LINK-MEDIA-001.md`, que conserva su propia identidad y
alcance histórico.

## Identidad exacta dispensada

```text
base              = 65ca3ed4ced1427a90361a620e701400dbb4d180
rama              = codex/link-thread-hydration-hotfix
huella_funcional  = d4b2d7e6ee17737ea0f12dc713701b19cad740e84c69acaa48df69b64a22624b
rutas_funcionales = 5
delta_funcional   = +284/-4
```

La huella excluye `docs/waivers/` para evitar autorreferencia y se reproduce
sobre los cinco paths exactos, ordenados byte a byte, con:

```bash
for p in \
  'src/app/(app)/connect/_components/ConversationAdmin.tsx' \
  'src/app/(app)/connect/_components/ThreadView.hydration.test.tsx' \
  'src/app/(app)/connect/_components/ThreadView.tsx' \
  'src/app/(app)/connect/c/[conversationId]/page.tsx' \
  'src/lib/connect/format.ts'
do
  h=$(shasum -a 256 "$p" | cut -d' ' -f1)
  printf '%s\0%s\n' "$p" "$h"
done | shasum -a 256
```

El diff completo del candidato contiene además este único documento de waiver.
No hay ningún otro path autorizado. Si cambia la base, rama, huella, conjunto
de paths o alguno de los hashes siguientes, la dispensa deja de aplicar.

## Cinco paths indispensables

| Estado | Path | SHA-256 | Delta | Motivo exclusivo |
|---|---|---|---:|---|
| `M` | `src/app/(app)/connect/_components/ConversationAdmin.tsx` | `e92d4e8e7ebe6479ed82c6278c41f7d9618469d330f3fb9ed02f084b8785eeed` | `+4/-1` | Transporta sin transformar el snapshot temporal SSR a `ThreadView`. |
| `A` | `src/app/(app)/connect/_components/ThreadView.hydration.test.tsx` | `1204e2973de397182b1f8ff28b2d1a01de07a11ed6c2e69412a995f3035faf3a` | `+242/-0` | Hidrata el componente real entre UTC/ART y a través de medianoche; cubre Realtime, audio, adjuntos, navegación y recarga. |
| `M` | `src/app/(app)/connect/_components/ThreadView.tsx` | `8df35ec3188e09736d5cbcc6dc83e43a799e117d0af809897c9a5efb8cfebc8c` | `+16/-1` | Primer render desde snapshot estable y reloj real únicamente post-mount. |
| `M` | `src/app/(app)/connect/c/[conversationId]/page.tsx` | `535d35f19c1baa52c8c7260f303ce7ba1966d7f7f5ac925bbdcb2f46da6805e6` | `+5/-0` | Calcula un único `initialNowIso` en el límite servidor por request. |
| `M` | `src/lib/connect/format.ts` | `a279ca237eac6d8777c80d6cc7a21c88f9b531e19d241f05ab835414f28cbf38` | `+17/-2` | Fija locale, zona Buenos Aires y ciclo horario; permite snapshot diario estable. |

## Dos aserciones dispensadas

1. **`T-C1-05` · «sólo cambia el ÚNICO archivo autorizado del harness
   vanilla».** Es la aserción histórica ya nominada. `origin/main` produce por
   sí mismo `450/451`; este hotfix no modifica `tests/db/` ni el contrato
   vanilla.

2. **`T-C1-05` · «no se tocó ningún path de WhatsApp, Connect ni Sidebar».**
   Se dispensa únicamente respecto de los cinco paths enumerados arriba. La
   prohibición categórica es incompatible con reparar la hidratación del hilo
   interno, que vive necesariamente en Nexus Link. No se dispensa ningún sexto
   path funcional ni ningún cambio de WhatsApp o Sidebar.

La segunda aserción no representa una regresión funcional de Custodia: detecta
el alcance Connect autorizado de forma deliberada. Ambas deben seguir
reportándose como rojas.

## Evidencia previa a la congelación

| Control | Resultado observado |
|---|---|
| Focales de Link/hidratación | **107/107 PASS** |
| Unitarias | **3376 PASS**, una omisión histórica intacta |
| Typecheck | **PASS** |
| Lint | **PASS**, cero errores |
| Build productivo | **PASS** |
| DB Harness | **728/728 PASS**, cero residuos |
| Custody | **449/451**, sólo las dos aserciones nominadas |

Todos los controles deben reejecutarse sobre la identidad congelada. Esta tabla
no sustituye esa repetición ni autoriza C4, Guardian, commit o publicación.

## Límite fail-closed

La dispensa no cubre:

- una tercera falla en `T-C1-05`;
- ninguna falla en otro test de Custodia;
- ningún path funcional distinto de los cinco enumerados;
- cambios en Clientes, Custodia, Tracking, migraciones o base de datos;
- una divergencia de base, rama, fingerprint, hash o diff;
- una regresión de hidratación, Realtime, audio, adjuntos, permisos o Topbar.

Custody se informa **449/451 — dos aserciones WAIVED BY DIRECTION**, nunca PASS.
Ante cualquier otra falla o drift, el candidato debe detenerse.
