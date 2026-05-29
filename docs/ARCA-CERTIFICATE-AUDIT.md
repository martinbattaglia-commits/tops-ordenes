# ARCA-CERTIFICATE-AUDIT — FASE F · F1 (Certificados de homologación)

**Fecha:** 2026-05-29
**Rama:** `feature/arca-production-fase-e`
**Roles:** Principal SW Architect · Senior ARCA Integration Eng · Senior Backend Eng · Senior Security Eng · Senior Compliance Eng · Senior Supabase Eng
**Regla rectora:** *"¿Esto acerca a TOPS Nexus a emitir comprobantes fiscales reales de forma segura, auditada y conforme a ARCA?"* — NO ASUMIR · VERIFICAR · NO inventar · NO exponer secretos.

---

## 1. Objetivo

Auditar la existencia, formato, vigencia, alias, clave privada y almacenamiento seguro del **certificado X.509 de homologación ARCA** requerido para el handshake WSAA. Sin exponer secretos.

---

## 2. Procedimiento de verificación (ejecutado 2026-05-29)

Verificación de presencia, **sin imprimir valores**, en todas las fuentes posibles:

| Fuente | Comprobación | Resultado |
|---|---|---|
| Shell env | `ARCA_CERT_PATH`, `ARCA_KEY_PATH`, `ARCA_CUIT`, `ARCA_AMBIENTE` | **(vacíos)** |
| `.env.local` | grep `^ARCA_*` (valores enmascarados) | **sin ninguna clave `ARCA_*`** |
| `.env.example` | plantilla | solo placeholders (`ARCA_CERT_PATH=...`, etc.) |
| Repo (maxdepth 4) | `*.crt *.pem *.key *.p12 *.pfx *.cer` (excl. node_modules) | **ningún archivo** |
| Home | `~/.arca`, `~/certs`, `~/.config/arca`, `~/CODE/certs` | **ninguno existe** |
| `.gitignore` | protección de material sensible | `*.pem` ignorado ✅ |

---

## 3. Hallazgo

### 🔴 NO existe certificado ARCA de homologación en el entorno.

No hay certificado X.509, ni clave privada, ni CUIT configurado, ni archivo de credencial en disco. El material **no está cargado** en el host.

| Atributo auditado | Estado | Nota |
|---|---|---|
| Existencia del certificado | ❌ AUSENTE | No hay archivo ni path configurado. |
| Formato (PEM/DER/P12) | n/a | No auditable sin archivo. |
| Vigencia (notBefore/notAfter) | n/a | No auditable sin archivo. |
| Alias / CN / O | n/a | No auditable sin archivo. |
| Clave privada presente y legible | ❌ AUSENTE | `ARCA_KEY_PATH` vacío. |
| Almacenamiento seguro | ✅ (preparado) | `.gitignore` ignora `*.pem`; arquitectura referencia cert por path en host, nunca en repo/DB. |
| CUIT de homologación | ❌ AUSENTE | `ARCA_CUIT` vacío. |

> **Esto NO es un defecto de software.** Es un **insumo operativo/administrativo faltante**: el certificado debe tramitarse en ARCA (Clave Fiscal) y depositarse en el host. El diseño de seguridad (cert por path, fuera de repo/DB, `*.pem` en `.gitignore`) es **correcto y está listo** para recibirlo.

---

## 4. Evidencia colateral fresca (readiness de infraestructura, 2026-05-29)

`node scripts/arca-homologation-check.mjs --ptovta 1 --cbtetipo 11`:

```
✅ G1 openssl: OK — OpenSSL 3.6.2 7 Apr 2026
⏭️  G2 cert/key: SKIP — ARCA_CERT_PATH/ARCA_KEY_PATH no seteados
✅ G3 FEDummy: OK — HTTP 200 App=OK Db=OK Auth=OK
⏭️  G4 WSAA login: SKIP — requiere G1 + G2
⏭️  G5 FECompUltimoAutorizado: SKIP — requiere G4 + ARCA_CUIT
```

Interpretación:
- **Infraestructura de homologación VIVA:** WSFEv1 homologación (`wswhomo.afip.gov.ar`) responde sano (`FEDummy` → App/Db/Auth = OK).
- **Firma local disponible** (openssl 3.6.2; y además el firmador puro-JS `forge` ya validado en F2).
- **Todo lo demás (G4/G5) bloqueado únicamente por la ausencia del certificado.**

---

## 5. Requisitos para levantar el bloqueo (qué debe proveer el Directorio/IT)

1. **Tramitar el certificado X.509 de HOMOLOGACIÓN** en ARCA (generar CSR → ARCA Clave Fiscal → descargar cert) y habilitarlo para el servicio **`wsfe`** en **homologación**.
2. Depositar **cert + clave privada** en el **host** (NO en repo, NO en DB), con permisos restringidos (`chmod 600`).
3. Configurar en el host (no commitear):
   ```
   ARCA_AMBIENTE=HOMOLOGACION
   ARCA_CERT_PATH=/ruta/segura/homo-cert.pem
   ARCA_KEY_PATH=/ruta/segura/homo-key.pem
   ARCA_CUIT=<CUIT de homologación, sin guiones>
   ARCA_CMS_SIGNER=forge      # firmador puro-JS validado en F2
   ```
4. Re-ejecutar el readiness check: con G2 en OK, G4 (WSAA login) y G5 (FECompUltimoAutorizado) pasan a ejecutarse de verdad.

---

## 6. Veredicto F1

# 🔴 BLOQUEADO — Certificado de homologación AUSENTE

| Resultado esperado por el master prompt | Estado real |
|---|---|
| Certificados homologación auditados | ✅ Auditado → **resultado: ausentes** |
| Existencia / formato / vigencia / alias / clave | ❌ No auditables (no hay material) |
| Almacenamiento seguro | ✅ Diseño correcto, listo para recibir el cert |

**Consecuencia para FASE F:** las fases **F2 (WSAA), F3 (WSFEv1 autenticado), F4 (CAE homologación)** **NO pueden ejecutarse** sin este certificado. No se generan reportes de validación/evidencia de esas fases porque **no ocurrieron** (regla rectora: no inventar, no reportar como aprobado lo no verificado).

**Próximo paso único:** proveer el certificado de homologación (§5). Con eso, la cadena completa es ejecutable en una sola corrida del runner ya existente.

**Evidencia:** auditoría de presencia §2 + readiness check §4 (`scripts/arca-homologation-check.mjs`).
