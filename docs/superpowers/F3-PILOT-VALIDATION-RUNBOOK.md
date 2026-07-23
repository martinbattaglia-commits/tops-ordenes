# F3 · Runbook de Validación Piloto — Nexus Link

> Guía paso a paso para validar Nexus Link F3 en **producción** (`https://nexus.logisticatops.com`, commit `88add4b`) con los usuarios internos habilitados, antes del cierre formal de F3.
> Referencias: `F3-2B-PROD-DEPLOY-REPORT.md`, `F3-2A-RBAC-FINAL-MODEL.md`, `F3-CLOSURE-CRITERIA-AND-CHECKLIST.md`.

---

## 0. Reglas de seguridad de esta validación

- **Alcance:** el piloto valida el uso real de una plataforma colaborativa, por lo que **incluye interacciones reales** (enviar mensajes, crear canales, marcar favoritos). Estas pruebas mutantes se ejecutan **únicamente durante la ventana de piloto autorizada por Dirección**, por los **propios usuarios habilitados**, en sus cuentas.
- **Antes de la ventana autorizada:** NO ejecutar pruebas mutantes en producción, NO enviar mensajes reales, NO crear canales, NO modificar perfiles ni RBAC. La preparación es documental.
- **Datos de prueba:** preferir contenido claramente identificable como prueba (p.ej. canal `#piloto-f3`, mensajes con prefijo `[PRUEBA]`) y registrar qué se creó para limpieza posterior si Dirección lo solicita.
- **NO** modificar roles/permisos durante el piloto (solo validar comportamiento).
- Toda anomalía **crítica** (5xx, crash, fuga de datos entre usuarios, fail-open) → **detener**, documentar, escalar; evaluar rollback a `c310589` con Dirección.

---

## 1. Prerrequisitos

| Ítem | Valor |
|---|---|
| Entorno | Producción — `https://nexus.logisticatops.com` |
| Versión esperada | `/api/version` → `{"version":"88add4b","environment":"production"}` |
| Navegador | Chrome/Edge/Firefox actualizado; abrir **DevTools → Console + Network** |
| Usuarios | 7 usuarios internos habilitados (con rol) + verificación con 3 usuarios sin rol + verificación de acceso externo |
| Rollback point | deploy `6a443775401cf1eb613dd99f` (`c310589`) |

**Verificación previa (cualquier evaluador, read-only):** abrir `https://nexus.logisticatops.com/api/version` y confirmar `version=88add4b`. Si no coincide → detener y avisar.

---

## 2. Matriz de acceso esperado por rol (RBAC)

Basado en el modelo validado en producción (ver `F3-2B-PROD-DEPLOY-REPORT.md` §6):

| Rol | Acceso a `/connect` | `edit` esperado | Notas |
|---|---|---|---|
| director_ops | Sí (full) | Sí | acciones completas |
| admin | Sí (full) | Sí | acciones completas |
| gerencia | Sí | **Sí** | acceso total sin RRHH |
| jefe_deposito | Sí | **Sí** | edit acotado |
| rrhh_admin | Sí | solo `rrhh.edit` | edit acotado a RRHH |
| seguridad | Sí | solo `knowledge.edit` (a revisar) | ver deuda B |
| operaciones / compliance / comercial | Sí | Sí (por dominio) | según permisos |
| rrhh_viewer / employee_self_service | Sí (limitado) | No | solo lectura |
| cliente_b2b | Portal B2B | No | externo — sin acceso interno |
| **(sin rol)** | **No** | — | **fail-closed** |

---

## 3. Casos de prueba

> Marcar cada caso: ✅ Pass / ❌ Fail / ⚠️ Observación. Adjuntar screenshot y, si falla, el error de consola/Network.

### 3.1 Login
| # | Paso | Esperado |
|---|---|---|
| L1 | Ir a `/login`, iniciar sesión con usuario habilitado | Login OK, redirección al app |
| L2 | Verificar redirección post-login | Landing esperada (dashboard/cockpit), sin error |
| L3 | Consola durante login | 0 errores **críticos** (warnings cosméticos aceptables, ver §4) |

### 3.2 Acceso a `/connect` (Inicio)
| # | Paso | Esperado |
|---|---|---|
| C1 | Navegar a `/connect` | "Hola, <usuario>" + Actividad reciente + Notificaciones + Favoritos + Canales |
| C2 | Verificar Actividad reciente | Muestra eventos reales del timeline (orders/custody/treasury) |
| C3 | Título de pestaña | "Nexus Link · Inicio · TOPS NEXUS" |

### 3.3 Canales
| # | Paso | Esperado |
|---|---|---|
| CH1 | `/connect/canales` | Directorio de canales; empty-state si no hay |
| CH2 | (autorizado) Crear canal `#piloto-f3` | Canal creado, visible, usuario como miembro |
| CH3 | (autorizado) Unirse a canal público desde otro usuario | Unión OK (fail-closed: no-miembro no modera) |
| CH4 | Editar tema/archivar (rol con permiso) | Acción permitida; rol sin permiso → bloqueado |

### 3.4 Conversaciones / mensajería
| # | Paso | Esperado |
|---|---|---|
| M1 | (autorizado) Enviar DM `[PRUEBA]` a otro usuario | Mensaje entregado, aparece en tiempo real (realtime) |
| M2 | Ver hilo/bandeja | Orden correcto, sin duplicados, markRead funciona |
| M3 | (autorizado) Pin / react / flag mensaje | Acciones reflejan estado; moderación fail-closed |
| M4 | Conversación contextual de entidad ERP (botón en detalle de orden/cliente/PO) | Crea/abre la conversación única de la entidad + panel Entity360 |

### 3.5 Búsqueda
| # | Paso | Esperado |
|---|---|---|
| S1 | `/connect/buscar?q=magaldi` (autenticado) | Resultados de conversaciones/contextos/mensajes acordes al query |
| S2 | Buscar término inexistente | Empty-state correcto, sin error |

### 3.6 Notificaciones
| # | Paso | Esperado |
|---|---|---|
| N1 | `/connect/notificaciones` | Lista de notificaciones del usuario; "Sin pendientes" si vacío |
| N2 | Generar evento que notifica (autorizado) | Notificación aparece (realtime/polling) |

### 3.7 Actividad
| # | Paso | Esperado |
|---|---|---|
| A1 | `/connect/actividad` | Feed de actividad del usuario, datos reales |

### 3.8 Perfil
| # | Paso | Esperado |
|---|---|---|
| P1 | `/connect/perfil` | Perfil del usuario, datos correctos |
| P2 | (NO en preparación) Editar perfil | Solo durante ventana autorizada; validar guardado |

### 3.9 Favoritos
| # | Paso | Esperado |
|---|---|---|
| F1 | `/connect/favoritos` | Lista de favoritos; empty-state si vacío |
| F2 | (autorizado) Marcar conversación como favorita | Aparece en Favoritos |

### 3.10 Permisos RBAC (por rol)
| # | Paso | Esperado |
|---|---|---|
| R1 | Login con cada uno de los 7 roles habilitados | Acceso acorde a la matriz §2 |
| R2 | Intentar acción `edit` con rol sin ese permiso | **Bloqueado** (no visible/deshabilitado/denegado) |
| R3 | `gerencia` / `jefe_deposito` → acciones edit | Permitidas |
| R4 | `rrhh_admin` → edit solo en RRHH | Permitido en RRHH, no fuera |

### 3.11 Fail-closed / sin rol / externos
| # | Paso | Esperado |
|---|---|---|
| FC1 | Acceder a `/connect` **sin autenticar** | `307 → /login` |
| FC2 | Usuario **sin rol** intenta `/connect` | Sin acceso (fail-closed) |
| FC3 | Usuario **externo** (cliente_b2b) intenta rutas internas | Sin acceso |
| FC4 | API `/api/today` sin auth | `401` |

### 3.12 Rutas preexistentes (regresión)
| # | Paso | Esperado |
|---|---|---|
| RG1 | Navegar autenticado a: ejecutivo, dashboard, orders, pedidos, compras, compras/ordenes, anmat, knowledge/admin, wms, tesoreria, rrhh, comercial/prospeccion, settings/roles | Cada uno **renderiza** para el rol correspondiente; sin romper |
| RG2 | Sin auth, mismas rutas | `307 → /login` (fail-closed) |

### 3.13 Consola del navegador
| # | Paso | Esperado |
|---|---|---|
| CO1 | Revisar Console en cada página | **0 errores críticos**. Aceptables (documentados, deuda A): React #425/#422 (hydration del shell) + warnings PWA/preload. |
| CO2 | Cualquier error NUEVO distinto de los documentados | Registrar como hallazgo |

### 3.14 Errores 500 / 502
| # | Paso | Esperado |
|---|---|---|
| E1 | Revisar Network en cada interacción | **0 respuestas 500/502**. Llamadas a `/rest/v1/*` y `/api/*` → 200/2xx (o 401 si corresponde) |

### 3.15 Experiencia general de usuario
| # | Paso | Esperado |
|---|---|---|
| UX1 | Recorrido general por un usuario real | Fluido, sin bloqueos, tiempos aceptables, layout correcto (light/dark) |
| UX2 | Feedback cualitativo | Registrar comentarios/fricciones para backlog |

---

## 4. Errores conocidos (NO cuentan como fallo del piloto)

- **React #425 / #422** (hydration del shell por fecha localizada): recoverable, sin crash, sin 5xx. Deuda A.
- **Warnings de consola**: `apple-mobile-web-app-capable` deprecado; preload de imagen del logo no usado a tiempo. Cosméticos.
- **RBAC `seguridad → knowledge.edit`**: observación de configuración (deuda B), no fallo del deploy.

---

## 5. Registro de evidencia por usuario

| Usuario | Rol | Fecha/hora | Casos ejecutados | Pass | Fail | Observaciones | Evidencia (screenshots) |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
| | | | | | | | |

*(Completar una fila por usuario piloto. Adjuntar screenshots y export de consola/Network ante cualquier hallazgo.)*

---

## 6. Criterio de aprobación del piloto

El piloto se considera **APROBADO** si, para los 7 usuarios habilitados:
- Login y acceso a `/connect` OK;
- Canales/conversaciones/búsqueda/notificaciones/actividad/perfil/favoritos operativos;
- RBAC se comporta según la matriz (edit acotado correcto; sin fail-open);
- Fail-closed confirmado (sin rol / externos / sin auth → sin acceso);
- Rutas preexistentes no rompen;
- **0 errores críticos de consola** (más allá de los conocidos §4);
- **0 respuestas 500/502**;
- Rollback no requerido.

Resultado del piloto → se traslada a `F3-CLOSURE-CRITERIA-AND-CHECKLIST.md`.
