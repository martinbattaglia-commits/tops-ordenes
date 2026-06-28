# Informe B — HTTP 503 al guardar factura de proveedor (Observación de infraestructura)

| | |
|---|---|
| **Fecha** | 2026-06-28 |
| **Módulo** | Compras · Cuentas por Pagar — Alta de factura (`/compras/facturas/nueva`) |
| **Origen** | Validación funcional E2E del OCR en el Preview de Netlify (deploy draft `6a40d58fd1723c15ae4f4188`) |
| **Estado** | ✅ Investigación CONCLUIDA — registrada como **observación de infraestructura** para seguimiento |
| **Decisión (Martín B.)** | Sin pérdida de datos; comportamiento sólo en Preview. **No se justifica modificar el flujo de producción.** Hardening al **backlog** (no urgente). **No implementar ahora.** |
| **Rama** | `feat/conciliacion-oc` (sin push / merge / deploy) |

---

## Causa

### Evidencia recogida
1. El RPC `ap_create_supplier_invoice` **commiteó con éxito**: la factura `FP-2026-0025` quedó persistida con su renglón de IVA, y los logs de Postgres **no muestran ningún error** del RPC ⇒ la **capa de datos funcionó perfecto**.
2. Los 503 ocurrieron en la capa **HTTP / Netlify, después** del commit:
   - `POST /compras/facturas/nueva` (server action) → **503** (×2)
   - `GET /compras/facturas?_rsc=…` (prefetch RSC de la navegación) → **503** (×3)
3. Al recargar, la lista de Facturas cargó normal y mostró la factura ⇒ **síntoma transitorio**, no persistente.
4. El deploy es un **draft/preview** (`6a40d58fd1723c15ae4f4188--tops-ordenes.netlify.app`, generado con `netlify deploy --build` **sin** `--prod`). Los drafts **no** tienen funciones pre-calentadas y corren con cold-start + concurrencia acotada.

### Diagnóstico
El 503 proviene del **entorno Preview de Netlify** — funciones serverless con cold-start y concurrencia limitada en deploys *draft* — **saturadas por una ráfaga de requests concurrentes** disparada justo después de guardar. **No es un error de la lógica de negocio ni de la validación.**

### Amplificador a nivel código (contribuye, no es la causa raíz)
El handler `submit()` (`NuevaFacturaForm.tsx:382-448`) dispara casi simultáneamente **5 llamadas** a funciones serverless:

| # | Llamada | Detalle |
|---|---|---|
| 1 | `createSupplierInvoiceAction` (POST) | El guardado. ✅ commitea. |
| 2 | `saveRetenciónAction` (POST) | Disparado por el `useEffect` del panel al setear `createdInvoiceId` (`RetenciongananciasPanel.tsx:319-329`). **No se espera** — corre en paralelo. |
| 3 | `attachSupplierInvoiceFileAction` (POST) | Sube el **archivo completo (hasta 12 MB)** — la llamada más pesada (`ocr-actions.ts`). |
| 4 | `router.push("/compras/facturas")` (GET RSC) | Navegación. |
| 5 | `router.refresh()` (GET RSC) | Refetch. |

5 requests casi simultáneos contra un pool de funciones frío/limitado ⇒ algunas devuelven 503. Esto explica el patrón exacto observado (POST 503 + varios `?_rsc` 503).

---

## Análisis por vector

| Vector | ¿Causa el 503? | Detalle |
|---|---|---|
| **Netlify Functions** | **Causa raíz** | Cold-start + concurrencia limitada en draft, bajo ráfaga. |
| Server Actions | Síntoma | El POST 503 a nivel infra; el action en sí ejecutó el RPC OK. |
| RSC | Síntoma | Los `?_rsc` 503 son los fetch de navegación; misma saturación. |
| `revalidatePath` | No | Sólo invalida caché; provoca el refetch RSC que luego 503ó por infra, pero no genera el 503. |
| Redirects | No (efecto lateral) | No hay redirect server-side; el `/login?from=…` fue el middleware rebotando un request que 503ó en la ventana. |
| Streaming | Síntoma | El streaming RSC muestra 503 si la función muere; consecuencia, no causa. |
| Timeouts | Improbable | El RPC es rápido; único riesgo: el upload del adjunto en función fría. |
| **Race conditions** | **Amplificador** | La ráfaga concurrente satura, pero **no corrompe datos** (RPC atómico + la clave única del Informe A evita duplicado por reintento). |

---

## Impacto

- **Datos:** **nulo.** El RPC es atómico; la factura persiste íntegra. La clave única (Informe A) impide que un reintento del 503 cree un duplicado.
- **UX:** alto en el momento — la UI queda colgada en "Guardando…" aunque el guardado haya tenido éxito; el usuario no recibe confirmación y podría reintentar.
- **Producción:** **probabilidad baja** — funciones de prod calientes (tráfico sostenido), mayor concurrencia, sin el cold-start por-request de un draft recién creado. El patrón de ráfaga sigue siendo un riesgo latente bajo carga.

---

## Solución propuesta (hardening — diferido)

1. **Secuenciar** los efectos post-guardado: `await` del adjunto y de la retención **antes** de navegar (no en paralelo con `push` + `refresh`).
2. **Una sola navegación:** `redirect()` server-side en el action (o un único `router.replace`), evitando `push` + `refresh` back-to-back (dos fetch RSC).
3. Consolidar retención + adjunto para que no compitan con la navegación.

**Complejidad:** Baja-Media (~1 archivo, `submit()` + posible `redirect()` en el action), ~3–4 h con verificación.

---

## Recomendación

- **Conclusión:** con alta confianza, el 503 es **comportamiento del entorno Preview de Netlify** (cold-start + concurrencia de draft) bajo una ráfaga concurrente. **No hay un bug de código que lo provoque de forma determinística**, pero el patrón de ráfaga post-guardado lo amplifica.
- **Decisión:** registrado como **observación de infraestructura**; **no se modifica el flujo de producción** por este comportamiento. El hardening de `submit()` queda en **backlog** (baja-media prioridad).
- **Cierre definitivo del origen (si en el futuro se quisiera certeza 100%):** revisar los logs de función en la **UI de Netlify** para ese deploy, o ejecutar una **reproducción controlada** sobre un deploy estable. *(No se pueden traer los logs retroactivamente por MCP/CLI; no se crearon facturas de prueba adicionales para reproducir.)*

---

## Anexo — Evidencia

- Logs de Postgres (`get_logs` service=postgres): sin error del RPC `ap_create_supplier_invoice`; FP-2026-0025 persistida con 1 `supplier_invoice_vat_lines`.
- Network (Preview): `POST /compras/facturas/nueva` → 503 (×2); `GET /compras/facturas?_rsc=…` → 503 (×3); `GET /login?from=%2Fcompras%2Ffacturas%2Fnueva` (pending).
- Código: `NuevaFacturaForm.tsx:382-448` (`submit`), `RetenciongananciasPanel.tsx:319-329` (efecto retención), `ocr-actions.ts` (adjunto), `netlify.toml` (plugin `@netlify/plugin-nextjs`, sin config de timeout de función).
- Deploy draft: `6a40d58fd1723c15ae4f4188--tops-ordenes.netlify.app` (`netlify deploy --build`, sin `--prod`).
