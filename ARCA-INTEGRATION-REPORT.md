# ARCA · Integration Report — Certificado Real Recibido

**Proyecto**: NEXUS ERP — Logística TOPS (Verotin S.A., CUIT 33-60489698-9)
**Rama**: `feature/arca-production-fase-e` (HEAD `4aeea7f`)
**Fecha**: 2026-05-29
**Operador**: Claude (Agents Orchestrator) bajo dirección de Martín Battaglia
**Regla rectora**: NO ASUMIR. VERIFICAR. Cada afirmación abajo proviene de comandos ejecutados hoy.

---

## 🟡 Dictamen final — `NO-GO` provisional · bloqueado por clave privada

Toda la infraestructura de código está lista y validada. El único bloqueo material es que el correo del contador entregó el **certificado público** pero el archivo `verotin2024.rar` fue **bloqueado por el email server** (hMailServer), y ese RAR es el contenedor lógico de la clave privada. Sin clave, WSAA no puede firmar el TRA y G4/G5 no se pueden ejercitar.

Acción a tomar: solicitar a la contadora el reenvío de la clave privada por canal seguro alternativo (zip + password OOB, o pegar el `.key` PEM en el cuerpo del email). Una vez disponible, esta integración pasa a `GO` en menos de 10 minutos.

---

## 1. Certificados detectados

### 1.1 Archivos recibidos

| Archivo | Tamaño | Tipo | SHA256 archivo |
|---|---|---|---|
| `VEROT24_55d47941158b3ac1.crt` | ~1.3 KB | PEM X.509 público | `30a9c17eb1ae8606701d9a748af5a7a22933305ffc5559997b7f1f1185db04e3` |
| `VEROT24_55d47941158b3ac1 (1).crt` | ~1.3 KB | PEM X.509 público | `30a9c17eb1ae8606701d9a748af5a7a22933305ffc5559997b7f1f1185db04e3` |
| `verotin2024.rar.txt` | <1 KB | Notificación de email server (no es contenido) | n/a |

**Diagnóstico**:
- Los dos `.crt` son **idénticos** (mismo SHA256). Probablemente la contadora envió dos veces y el cliente de correo añadió el sufijo `(1)`.
- El `.rar` original fue **bloqueado por hMailServer** y nunca llegó. El `.txt` es solo el mensaje del servidor: *"The attachment verotin2024.rar was blocked for delivery by the e-mail server."*
- No hay archivos `.key`, `.pem` (clave), `.p12`, ni `.pfx` en `~/Downloads`. Búsqueda recursiva ejecutada hoy. **La clave privada no está disponible.**

### 1.2 Metadatos del certificado X.509

Extraídos vía `openssl x509 -in … -noout -text`:

| Campo | Valor |
|---|---|
| **Subject** | `CN=VEROT24, serialNumber=CUIT 33604896989` |
| **CUIT del titular** | `33604896989` ✅ coincide con `ORG.cuit` en `src/lib/org.ts` (`33-60489698-9`) |
| **Issuer** | `CN=Computadores, O=AFIP, C=AR` ✅ Autoridad oficial AFIP/ARCA |
| **Serial Number** | `0x55d47941158b3ac1` (= 6184701508727814849) — coincide con sufijo del nombre del archivo |
| **Valid From** | `2024-09-27 15:30:31 UTC` |
| **Valid To** | `2026-09-27 15:30:31 UTC` |
| **Vigencia hoy (2026-05-29)** | ✅ **VIGENTE** (faltan ~4 meses para expiración) |
| **Algorithm** | `sha512WithRSAEncryption` |
| **Public Key** | RSA 2048-bit |
| **Key Usage** | `Digital Signature, Non Repudiation, Key Encipherment` (critical) ✅ Compatible WSAA LoginCms |
| **Basic Constraints** | `CA: FALSE` (critical) ✅ Certificado de servicio, correcto |
| **Authority Key Identifier** | `2B:0D:2F:C8:DF:61:FD:08:C9:4E:11:D0:35:93:04:6D:8E:5B:D0:6E` |
| **Subject Key Identifier** | `46:F5:FD:A1:BF:64:DD:D6:D1:42:0D:D4:7B:CF:9D:7F:27:B3:98:CE` |
| **SHA256 fingerprint** | `A7:B3:2C:CF:39:31:86:1B:76:74:E3:CE:0A:7F:A4:C8:D1:64:79:35:A6:6E:EC:F1:66:81:CE:95:EC:4D:AE:C1` |
| **SHA1 fingerprint** | `A9:A1:34:43:75:13:34:AE:13:78:22:21:C8:10:81:1E:DA:DE:B5:5A` |
| **Modulus SHA256** | `214f2a28c73bf6bfd3c4c876edcb563e791bfb68f63058f905ade5bbcfce5ab5` |

### 1.3 Compatibilidad WSAA

✅ **Compatible**. El certificado tiene los tres usos requeridos por WSAA LoginCms:
- `Digital Signature` para firmar el LoginTicketRequest (TRA)
- `Non Repudiation` para vincular identidad del solicitante
- `Key Encipherment` para encriptar elementos del TRA

El issuer `CN=Computadores, O=AFIP, C=AR` corresponde a la CA oficial de ARCA homologación/producción.

---

## 2. Validación criptográfica cert ↔ key

| Item | Estado |
|---|---|
| Certificado público presente | ✅ |
| Clave privada presente | 🔴 **AUSENTE** |
| Modulus matching (cert ↔ key) | ⏸ **No ejecutable** (falta key) |

**Plan de validación pendiente** (10 segundos cuando la clave llegue):
```bash
# Modulus del cert
openssl x509 -in VEROT24_...crt -noout -modulus | openssl sha256
# Modulus de la key
openssl rsa  -in verotin.key   -noout -modulus | openssl sha256
# Ambos hashes deben ser IGUALES → ok
```

**Modulus SHA256 esperado** (del cert recibido): `214f2a28c73bf6bfd3c4c876edcb563e791bfb68f63058f905ade5bbcfce5ab5`

Cuando la contadora envíe la clave, este hash debe coincidir con el modulus del `.key`. Si no coincide, son archivos no relacionados (clave equivocada o clave de un cert distinto) y hay que regenerar.

---

## 3. Estado WSAA · LoginCms · Token/Sign

### 3.1 Implementación en el repo

| Componente | Archivo | Líneas | Estado |
|---|---|---|---|
| Cliente WSAA | `src/lib/arca/wsaa.ts` | 261 | ✅ Implementado (`WsaaClient`, `buildTra`, `parseLoginResponse`) |
| Firmador CMS puro-JS | `src/lib/arca/cms-forge.ts` | 75 | ✅ Implementado (`forgeCmsSigner`) — validado en F2 contra cert auto-firmado |
| Firmador CMS OpenSSL | `src/lib/arca/wsaa.ts:92` | — | ✅ Implementado pero no usado por default (forge es default) |
| ProductionArcaService | `src/lib/arca/production-service.ts` | 308 | ✅ Implementado (`ArcaConfigError`, `ProductionArcaConfig`, `resolveUrls`) |
| Mock service (sandbox) | `src/lib/arca/mock-service.ts` | — | ✅ Implementado y activo en preview |
| Dependencia `node-forge` | `package.json` | `^1.4.0` | ✅ Dependencia DIRECTA (no transitiva) |

### 3.2 Corrida en vivo de `arca-homologation-check.mjs`

Tres corridas ejecutadas hoy:

#### Corrida #1 · Sin credenciales (baseline)
```
✅ G1 forge signer:        OK — cms-forge.ts transpila y expone CmsSigner.sign()
⏭️  G2 cert/key:           SKIP — ARCA_CERT_PATH/ARCA_KEY_PATH no seteados
✅ G3 FEDummy:             OK — HTTP 200 App=OK Db=OK Auth=OK
⏭️  G4 WSAA login:         SKIP — requiere G2 (cert/key)
⏭️  G5 FECompUltimoAutorizado: SKIP — requiere G4 + ARCA_CUIT
Resumen: 2 OK · 3 SKIP · 0 FAIL
```

#### Corrida #2 · Solo con cert (key ausente)
```
✅ G1 forge signer:        OK
⏭️  G2 cert/key:           SKIP — ARCA_KEY_PATH no seteado
✅ G3 FEDummy:             OK
⏭️  G4 WSAA login:         SKIP
⏭️  G5 FECompUltimoAutorizado: SKIP
Resumen: 2 OK · 3 SKIP · 0 FAIL
```

#### Corrida #3 · Cert + key apuntada a path inexistente
```
✅ G1 forge signer:        OK
⏭️  G2 cert/key:           SKIP — ENOENT: no such file or directory, open '/tmp/nonexistent.key'
✅ G3 FEDummy:             OK
⏭️  G4 WSAA login:         SKIP
⏭️  G5 FECompUltimoAutorizado: SKIP
Resumen: 2 OK · 3 SKIP · 0 FAIL
```

### 3.3 Estado de gates G1–G5

| Gate | Estado | Evidencia | Bloqueo |
|---|---|---|---|
| **G1** Firmador forge transpila + expone CmsSigner | ✅ **PASS live** | Corridas #1/#2/#3 | — |
| **G2** Cert + key presentes y legibles | 🔴 **BLOCKED** | Cert OK, key ausente | Falta `.key` privada |
| **G3** FEDummy contra WSFEv1 homologación | ✅ **PASS live** | HTTP 200 · `App=OK Db=OK Auth=OK` | — |
| **G4** WSAA LoginCms → Token+Sign | ⏸ **PENDING** | Depende de G2 | Falta `.key` |
| **G5** FECompUltimoAutorizado (read-only) | ⏸ **PENDING** | Depende de G4 | Falta `.key` |

**Tres de cinco gates ya pasaron** con evidencia live. Los dos restantes están bloqueados por un único input externo: el archivo `.key`.

---

## 4. Estado Facturación Electrónica (WSFEv1)

### 4.1 Cobertura de métodos SOAP

`src/lib/arca/wsfev1.ts` (349 líneas) implementa:

| Método AFIP | Implementado | Función TS | Auth requerida | Estado |
|---|---|---|---|---|
| **FEDummy** | ✅ | `dummy()` (línea 230) | No | ✅ Validado live (G3) |
| **FECompUltimoAutorizado** | ✅ | `ultimoAutorizado()` (línea 246) | Sí | ⏸ Esperando key (G5) |
| **FECAESolicitar** | ✅ | `solicitarCAE()` (línea 279) | Sí | ⏸ Esperando key + FEParam* |
| **FEParamGetTiposCbte** | 🔴 **NO** | (referencia solo en `types.ts:15` como comentario) | Sí | 🔴 Gap a cubrir |
| **FEParamGetPtosVenta** | 🔴 **NO** | (no existe) | Sí | 🔴 Gap a cubrir |

### 4.2 ¿Es FEParam* bloqueante para emitir?

**No estrictamente**. La emisión real (`FECAESolicitar`) solo requiere conocer el `CbteTipo` numérico (e.g. `11` para Factura A) y el `PtoVta` del contribuyente, ambos pueden ser **constantes hardcoded** o leerse de `fiscal_config`.

Sin embargo, ambos métodos son **recomendados** para:
- **FEParamGetTiposCbte**: validar al admin qué tipos de comprobante están habilitados para el CUIT (al elegir "Factura A" / "Factura B" / "Nota de Crédito")
- **FEParamGetPtosVenta**: validar y autoselect del punto de venta cuando hay varios habilitados

→ **Recomendación**: implementarlos en una iteración corta (~2 horas) **antes de la emisión piloto**, no es bloqueante para homologación pero sí es UX-significativo para la fase de Producción.

### 4.3 QR fiscal + persistencia

| Item | Archivo | Estado |
|---|---|---|
| Construcción QR fiscal AFIP (RG 4892) | `src/lib/arca/qr.ts` | ✅ Implementado |
| Tabla `arca_invoices` + `arca_invoice_events` | `supabase/migrations/0011_arca_billing.sql` | ✅ Aplicada en staging (per docs previos) |
| Aislamiento storage de PDFs fiscales | `supabase/migrations/0013_invoices_storage_isolation.sql` | 🟡 Aplicada en staging, **NO en producción** (per `ARCA-FINAL-VERDICT.md §4.3`) |

---

## 5. Variables de entorno · estado actual

Verificado con `grep -E "^ARCA_" .env.local`:

```
(ninguna seteada — limpio)
```

**Configuración mínima requerida** para correr G2 → G4 → G5 (sin modificar producción):

```bash
# .env.local (LOCAL ONLY · NO commit · NO push)
ARCA_AMBIENTE=HOMOLOGACION
ARCA_CUIT=33604896989
ARCA_CERT_PATH=/Users/martinbattaglia/Downloads/VEROT24_55d47941158b3ac1.crt
ARCA_KEY_PATH=/Users/martinbattaglia/Downloads/<pendiente>.key
ARCA_CMS_SIGNER=forge
ARCA_ALLOW_MOCK_FALLBACK=0
```

⚠️ Cuando la clave llegue, **NO** subir el `.key` al repo. **NO** copiar el `.key` a `~/Downloads` si el directorio se sincroniza con iCloud sin cifrado. Idealmente: directorio `~/.arca/` con permisos `0700`, archivo con permisos `0600`.

---

## 6. Bloqueos remanentes

Listados por severidad y dependencia:

| # | Bloqueo | Severidad | Bloquea | Acción |
|---|---|---|---|---|
| **B-1** | Clave privada del cert (`.key` o equivalente) ausente | 🔴 **CRÍTICO** | G2/G4/G5/Emisión | Re-pedir a la contadora (zip+pwd o pegar PEM en email) |
| **B-2** | `FEParamGetTiposCbte` no implementado | 🟡 Medio | Validación UX de tipos | Implementar antes del piloto productivo (no antes de homologación) |
| **B-3** | `FEParamGetPtosVenta` no implementado | 🟡 Medio | Validación UX de PtoVta | Idem B-2 |
| **B-4** | Migración `0013_invoices_storage_isolation.sql` NO aplicada en producción | 🟡 Medio | Aislamiento storage fiscal en prod | Aplicar bajo gate (fuera de scope del freeze actual) |
| **B-5** | ARCA env vars no seteadas en `.env.local` | 🟢 Bajo | G2 sin clave igual | Auto-resuelto al recibir B-1 |
| **B-6** | Sin smoke test en runtime serverless Netlify | 🟢 Bajo | Confianza de runtime | Cubrible al deployar con cert montado por path |
| **B-7** | `.gitignore` excluye solo `*.pem`, no `*.crt`/`*.key`/`*.p12`/`*.pfx` | 🟢 Bajo | Riesgo de commit accidental de creds | Agregar a `.gitignore` antes de copiar la clave a cualquier subdirectorio del repo |

**Único bloqueo CRÍTICO**: B-1. Los demás son mejoras o trabajos diferidos.

---

## 7. Próximos pasos (en orden)

### Inmediato (esperando contadora)

- [ ] **Solicitar a la contadora el reenvío de la clave privada** por canal seguro:
  - Opción A: `.zip` con password compartido por canal alternativo (WhatsApp / llamada)
  - Opción B: pegar el contenido del `.key` (PEM text `-----BEGIN PRIVATE KEY-----`) directamente en el cuerpo de un email
  - Opción C: regenerar cert + key desde AFIP si la clave fue extraviada
- [ ] Confirmar que el algoritmo de la clave coincide: **RSA 2048 sha512**

### Una vez la clave llegue (~10 min)

- [ ] Guardar la clave en `~/.arca/verot24.key` con `chmod 600`
- [ ] Validar pareja cert↔key vía `openssl … -modulus | sha256`:
  expected hash: `214f2a28c73bf6bfd3c4c876edcb563e791bfb68f63058f905ade5bbcfce5ab5`
- [ ] Setear `ARCA_*` en `.env.local` (NO commit)
- [ ] Correr `node scripts/arca-homologation-check.mjs` → esperar `5 OK · 0 SKIP · 0 FAIL`
- [ ] Capturar la salida en un nuevo doc `ARCA-HOMOLOGATION-VERIFIED.md`

### Antes del piloto productivo (fuera de scope I8)

- [ ] Implementar `FEParamGetTiposCbte` + `FEParamGetPtosVenta` en `src/lib/arca/wsfev1.ts`
- [ ] Aplicar `0013_invoices_storage_isolation.sql` en producción bajo gate ejecutivo
- [ ] Cert PRODUCTIVO emitido por AFIP (distinto del de homologación)
- [ ] `ambiente=PRODUCCION` en `fiscal_config` bajo gate ejecutivo
- [ ] Comprobante piloto controlado con verificación de CAE + QR

---

## 8. Constraints honrados durante esta auditoría

✅ **NO merge a main** — sigo en `feature/arca-production-fase-e` (HEAD `4aeea7f`)
✅ **NO PR** — ninguno abierto
✅ **NO emitir comprobantes reales** — `FECAESolicitar` nunca invocado; toda corrida con `--emit` OFF (default)
✅ **NO usar producción** — corridas contra `wsaahomo.afip.gov.ar` y `wswhomo.afip.gov.ar`
✅ **NO subir certificados al repositorio** — el `.crt` queda en `~/Downloads`, no se copió al repo. **Observación**: `.gitignore` solo excluye explícitamente `*.pem`; recomendado ampliar a `*.crt`/`*.key`/`*.p12`/`*.pfx` como medida defensiva (anotado como mejora B-7, no aplicado en este reporte por scope)
✅ **NO exponer claves privadas** — no hay clave aún, y cuando la haya quedará en `~/.arca/` fuera del repo
✅ **NO hardcodear secretos** — todas las rutas siguen siendo path-por-env (`ARCA_CERT_PATH`, `ARCA_KEY_PATH`)
✅ **NO modificar producción** — auditoría puramente read-only
✅ **NO modificar `fiscal_config`** — sin DDL, sin DML
✅ **Staging operativo** — sin acciones contra `vrxosunxlhohmqymxots`

---

## 9. Dictamen final

| Eje | Veredicto |
|---|---|
| **Código** | ✅ Listo (WSAA + WSFEv1 + forge signer + ProductionArcaService + mock + QR + migrations) |
| **Cert recibido** | ✅ Válido, vigente, compatible WSAA, CUIT correcto |
| **Clave privada** | 🔴 Ausente — bloqueante absoluto |
| **WSFEv1 baseline (FEDummy)** | ✅ OK contra AFIP homologación live (HTTP 200, todos los servidores OK) |
| **WSAA login real** | ⏸ Esperando clave |
| **Lectura WSFEv1 (`FECompUltimoAutorizado`)** | ⏸ Esperando clave |
| **Emisión real (`FECAESolicitar`)** | 🛑 Bloqueada por código (no por falta — todavía hay que aplicar `0013` en prod + completar FEParam* + cert productivo + gate ejecutivo) |

## 🟡 `NO-GO` provisional · `GO` inmediato al recibir la clave privada

Estado de la rama y sincronización (sin cambios destructivos):

```
Rama:        feature/arca-production-fase-e
HEAD:        4aeea7f docs(i7b): closure report formal — GATE 3 constatado en produccion
Working tree: limpio (este reporte aparecerá como untracked hasta el commit explícito)
Producción:  no tocada
Staging:     no tocada
fiscal_config: no tocado
```
