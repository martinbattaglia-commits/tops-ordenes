# F3 · Nexus Link — Paquete de Validación Manual (7 usuarios)

> Instrucciones para que los **7 usuarios internos habilitados** validen Nexus Link F3 en **producción** (`https://nexus.logisticatops.com`), en **sus propias cuentas**, antes del cierre formal de F3.
> Estado del sistema: desplegado (`88add4b`) + búsqueda corregida (migs `0156`/`0157`). Referencias: `F3-PILOT-VALIDATION-RUNBOOK.md`, `F3-FSEARCH-HOTFIX-EXECUTION-LOG.md`, `F3-CLOSURE-CRITERIA-AND-CHECKLIST.md`.

---

## 1. Objetivo del piloto

Validar que Nexus Link (mensajería/canales/búsqueda/notificaciones/actividad/perfil dentro de TOPS NEXUS) **funciona correctamente en producción para usuarios internos**, sin afectar el resto del sistema, para poder **cerrar formalmente F3**.

**Usuarios del piloto (7):**
| Email | Rol(es) RBAC |
|---|---|
| joseluis@logisticatops.com | director_ops + rrhh_admin |
| mariela@sullivancamejo.com.ar | director_ops + rrhh_admin |
| cynthia@logisticatops.com | gerencia |
| martinrinas@logisticatops.com | gerencia |
| ruth@logisticatops.com | gerencia |
| despachos-lujan@logisticatops.com | jefe_deposito |
| despachos-magaldi@logisticatops.com | jefe_deposito |

---

## 2. Reglas

- Cada uno usa **su propia cuenta** (la de siempre). **No compartir contraseñas. Nadie debe pedir credenciales.**
- **No usar datos sensibles** ni clientes reales.
- **Todo dato de prueba debe empezar con `[PRUEBA-F3]`** (canales, mensajes, etc.).
- Ante cualquier **error crítico** (ver §5) → **detener y avisar**, no seguir.
- Es una validación **interna**: no invitar externos/clientes/proveedores.

**Antes de empezar (30 s):** abrir `https://nexus.logisticatops.com`, y opcionalmente `https://nexus.logisticatops.com/api/version` → debe decir `"version":"88add4b"`.

---

## 3. Pruebas mínimas V1–V12

> Ejecutar en tu sesión. Marcá ✅/❌/⚠️. Sacá screenshot ante cualquier duda o fallo. (Recomendado: abrir DevTools → Console + Network para ver errores; opcional.)

| # | Prueba | Pasos | Esperado |
|---|---|---|---|
| V1 | Login | Iniciar sesión normal | Entra sin error |
| V2 | Acceso a Nexus Link | Menú lateral → **Nexus Link → Inicio** (`/connect`) | "Hola, <tu email>" + Actividad reciente + Notificaciones + Favoritos + Canales |
| V3 | Canales | **Nexus Link → Canales** | Lista/estado vacío; botón **Crear** |
| V4 | Crear canal | Crear canal **`[PRUEBA-F3] <tu inicial>`** (privado recomendado) | Canal creado y visible; sos miembro |
| V5 | Conversación / mensaje | Abrir el canal, enviar **`[PRUEBA-F3] hola <inicial>`** | Mensaje aparece y persiste (recargá: sigue ahí) |
| V6 | **Búsqueda** | **Nexus Link → Búsqueda**, buscar **`hola`** o **`PRUEBA-F3`** | Aparece tu mensaje/canal en resultados (ya NO "sin resultados") |
| V7 | Notificaciones | **Nexus Link → Notificaciones** | Lista/estado correcto; sin errores |
| V8 | Actividad | **Nexus Link → Actividad** | Feed con datos, sin error |
| V9 | Perfil (lectura) | **Nexus Link → Perfil** | Tus datos correctos. *Si cambiás algo: anotá el valor previo y restauralo* |
| V10 | Favoritos | Marcá una conversación con ⭐ (si la UI lo muestra), luego desmarcá | Aparece/desaparece en Favoritos. *Si no encontrás el ⭐: anotalo como observación* |
| V11 | Realtime (opcional, 2 personas) | Con otro usuario en simultáneo: uno envía `[PRUEBA-F3]`, el otro mira | Aparece en vivo sin recargar. *Si no hay 2 personas → dejar "pendiente"* |
| V12 | Rutas de siempre | Entrá a tus módulos habituales (órdenes, compras, WMS, tesorería, RRHH, etc. según tu rol) | Cargan normal, sin romperse |

---

## 4. Criterios PASS / FAIL

| Situación | Clasificación |
|---|---|
| La prueba hace lo esperado | ✅ **PASS** |
| Error 500/502, pantalla rota, pérdida de acceso, datos corruptos, permiso indebido | ❌ **FAIL (crítico)** → detener (§5) |
| Funciona pero con detalle menor (p.ej. no encontrás el ⭐, un texto raro, lentitud puntual) | ⚠️ **Observación no bloqueante** → anotar, seguir |

**Errores ya conocidos (NO cuentan como fallo):** un warning técnico en consola por la fecha del encabezado (hydration) es esperado y no rompe nada.

---

## 5. Criterios de parada

**Detené la validación y avisá inmediatamente** si aparece:
- error **500/502**;
- **pantalla rota** / no carga;
- **pérdida de acceso** o no podés entrar;
- **error crítico** repetido en consola;
- **datos corruptos** o que no corresponden;
- **problema de permisos grave** (ves/hacés algo que no deberías).

No intentar arreglar nada. Solo reportar (con screenshot si se puede).

---

## 6. Registro de resultados

> Cada usuario completa su fila (o una tabla propia por prueba).

| Usuario | Rol | Fecha/hora | Prueba (V#) | Resultado (PASS/FAIL/Obs) | Evidencia | Observaciones |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |

**Consolidación:** los resultados se vuelcan a `F3-PILOT-VALIDATION-LOG.md` y determinan el GO/NO-GO de cierre (ver §8).

---

## 7. Mensaje listo para enviar a los 7 usuarios (Parte E — NO enviado)

> Texto preparado para copiar/pegar (WhatsApp/mail interno). **No fue enviado por el asistente.**

---

**Asunto: Prueba interna de Nexus Link (10 min) — TOPS NEXUS**

Hola 👋

Estamos validando **Nexus Link**, el nuevo espacio de conversaciones/canales dentro de TOPS NEXUS (menú lateral "Nexus Link"). Ya está publicado y queremos que lo pruebes **en tu cuenta de siempre**, unos 10 minutos.

**Qué probar (rápido):**
1. Entrá a TOPS NEXUS → menú **Nexus Link → Inicio**.
2. Andá a **Canales** → **Crear** un canal llamado **`[PRUEBA-F3] <tu nombre>`** (privado).
3. Escribí un mensaje: **`[PRUEBA-F3] hola`**. Verificá que aparece.
4. Andá a **Búsqueda** y buscá **`hola`** o **`PRUEBA-F3`** → tiene que aparecer tu mensaje.
5. Mirá **Notificaciones**, **Actividad** y **Perfil**: que carguen bien.
6. Entrá a tus módulos de siempre (órdenes, compras, etc.): que sigan funcionando igual.

**Importante:**
- Usá **tu propia cuenta**. **No compartas contraseñas** ni se las pidas a nadie.
- Todo lo que crees de prueba tiene que empezar con **`[PRUEBA-F3]`**.
- No uses datos sensibles ni de clientes reales.

**Si algo se rompe** (pantalla en blanco, error, no te deja entrar): **pará y avisá** — mandá captura si podés. No intentes arreglarlo.

**Cuándo:** <completar fecha/hora sugerida>.
**Soporte / reporte:** <completar contacto>.

¡Gracias! 🙌

---

## 8. Qué falta para declarar F3 CERRADA (Parte F)

Detalle completo en `F3-CLOSURE-CRITERIA-AND-CHECKLIST.md`. Resumen:

| Ítem | Estado |
|---|---|
| Producción en `88add4b` | ✅ |
| Nexus Link visible/operativo | ✅ |
| Smoke técnico (fail-closed, 0 5xx) | ✅ |
| **Búsqueda corregida** (`0156`+`0157`) y validada (RPC+UI) | ✅ |
| **Validación manual de los 7 usuarios** | ⏳ **PENDIENTE (este pack)** |
| Resultados consolidados | ⏳ pendiente |
| Deudas no bloqueantes aceptadas (H-1, hydration, `seguridad→knowledge.edit`) | ⏳ nota de Dirección |
| **Dirección aprueba cierre de F3** | ⏳ pendiente |
| **F4 autorizada explícitamente** | 🚫 **bloqueada hasta cerrar F3** |

**Próximo paso:** ejecutar este pack con los 7 usuarios → consolidar resultados → Dirección acepta deudas + aprueba cierre → recién entonces F4.
