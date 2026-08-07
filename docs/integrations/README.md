# Integraciones de Nexus ERP

`[PROPUESTA]` Clasificacion: NO NORMATIVO — indice operativo.

## 1. Objeto

`[PROPUESTA]` Este directorio documenta las integraciones externas de Nexus ERP, sus
credenciales logicas y sus consumidores. Su finalidad es que exista un inventario unico,
verificable y trazable, en reemplazo del conocimiento distribuido en codigo, workflows y
plataformas de terceros.

`[PROPUESTA]` No constituye autoridad normativa. No autoriza acciones.

## 2. Relacion con el gobierno canonico

`[EVIDENCIA-CODIGO]` El corpus canonico de gobierno del ecosistema Nexus vive fuera de este
repositorio. El archivo `AGENTS.md` de la raiz lo localiza, autentica su identidad y le
transfiere el control; el Entry Point canonico es la unica autoridad que determina fase,
validaciones, vocabulario y autorizacion.

`[PROPUESTA]` Este directorio esta subordinado a ese corpus: ninguno de sus documentos lo
modifica, resume, reinterpreta ni sustituye.

`[PROPUESTA]` Este README no reproduce las instrucciones de `AGENTS.md` ni del Bootstrap
canonico, para que no exista una segunda version que pueda divergir del original.

`[EVIDENCIA-CODIGO]` `AGENTS.md` declara expresamente que `docs/AI/`, `NEXUS GUIDELINES/`,
`.agents/`, los Workflow Maps y cualquier copia o export del corpus no son el canon.

`[PROPUESTA]` Ninguna de esas rutas debe resolverse como autoridad desde este directorio.

## 3. Contenido

Indice estructural del directorio.

`[PROPUESTA]` Indice de los documentos que integran este directorio.
| Documento | Proposito |
|---|---|
| `INVENTORY.md` | Inventario de integraciones, credenciales logicas y consumidores |
| `../architecture/decisions/integration-manager/ADR-NIM-001-secret-custody-model.md` | Modelo de custodia de secretos |
| `../architecture/decisions/integration-manager/ADR-NIM-002-real-verification-status.md` | Estado operativo basado en verificacion real |

## 4. Reglas de evidencia

`[PROPUESTA]` Toda afirmacion material lleva exactamente una etiqueta textual de naturaleza
primaria, en grafia unica y sin tildes. Se entiende por afirmacion material toda oracion que
afirme un hecho, estado, capacidad, limitacion, conteo, dependencia, arquitectura presente o
comportamiento operativo. Los titulos, indices, encabezados estructurales y definiciones
nominales no requieren etiqueta.

Definiciones nominales de las seis etiquetas:

    [EVIDENCIA-CODIGO]      verificable en el repositorio, con archivo:linea, leido
                            desde el SHA declarado en el encabezado del inventario
    [EVIDENCIA-PLATAFORMA]  verificable en un servicio externo, con la consulta y su fecha
    [EVIDENCIA-HISTORICA]   proviene de un expediente cerrado o de una resolucion de
                            Direccion, identificada
    [INFERENCIA]            deduccion razonada; no es evidencia
    [PROPUESTA]             diseno, regla o criterio no implementado
    [NO VERIFICABLE]        no puede establecerse con el instrumental autorizado

`[PROPUESTA]` Los simbolos visuales pueden acompanar la etiqueta; nunca sustituirla.

`[PROPUESTA]` Un parrafo que mezcle naturalezas distintas debe partirse: no se admite una unica
etiqueta que cubra hechos e inferencias a la vez.

`[PROPUESTA]` La ausencia de evidencia no se completa con inferencia. Una inferencia no se
presenta como evidencia.

`[PROPUESTA]` Las referencias `archivo:linea` se validan leyendo el blob desde el SHA declarado.
No se admiten lineas tomadas de otra rama, del arbol de trabajo, de copias historicas, de
informes anteriores ni de memoria.

`[PROPUESTA]` Ninguna ruta se declara inexistente o rota sin comprobarlo en el arbol del SHA
declarado.

## 5. Reglas de no exposicion

`[PROPUESTA]` Queda prohibido incluir en este directorio:
- valores de secretos, completos o parciales;
- ultimos caracteres, longitudes utilizables o cualquier fingerprint derivado del valor;
- tokens;
- URLs firmadas;
- URLs completas de webhooks;
- identificadores que funcionen como credencial de acceso, incluidos los identificadores
  unicos de webhooks de plataformas de automatizacion;
- volcados de configuracion de modulos, blueprints o payloads;
- datos personales.

`[PROPUESTA]` Se admiten identificadores numericos internos que no habilitan acceso por si
mismos, como el identificador de un escenario o de una integracion. Se admiten los
identificadores de objeto de Git —commit y tree— exigidos para fijar la base de evidencia.

## 6. Vocabulario de estado

`[PROPUESTA]` Establecido por `ADR-NIM-002`. Su uso es obligatorio en este directorio.

Definiciones nominales:

    NO CONFIGURADA               no hay credencial ni implementacion
    IMPLEMENTACION PRESENTE      existe el codigo, la ruta o el workflow
    CONFIGURACION NO VERIFICADA  no se pudo consultar el secret store
    ULTIMA EJECUCION EXITOSA     hay evidencia de plataforma, con fecha
    HEALTH CHECK EXITOSO         hay verificacion autenticada vigente, con fecha
    OPERATIVA                    health check exitoso dentro del umbral
    NO VERIFICADA                no se ejecuto comprobacion alguna

`[PROPUESTA]` La palabra «operativa» exige health check exitoso vigente. La existencia de un
workflow, una variable de entorno, una ruta, un provider o una configuracion no habilita ese
vocabulario.

## 7. Expedientes relacionados

`[PROPUESTA]` Registro de expedientes vinculados.
| Expediente | Objeto | Estado |
|---|---|---|
| NEXUS-INT-MGR-001 | Nexus Integration Manager | Fase 0 documental |
| NEXUS-INT-MGR-001-F0B | Higiene y catalogo de `.env.example` | Diferido |
| MAKE-HYGIENE-001 | Webhooks huerfanos y autenticacion en Make | Sugerido |

`[EVIDENCIA-CODIGO]` El expediente GOV-ADAPTER-001 integro el localizador canonico en este
repositorio. Su cierre es reproducible desde Git: el commit `eff3274b` —«chore(governance): add
canonical governance entrypoint»— quedo integrado por el merge `64a9f9fb`, que es la base de
evidencia declarada, y `AGENTS.md` existe alli como blob `be019ce2`.
