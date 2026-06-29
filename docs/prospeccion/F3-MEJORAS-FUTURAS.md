# F3 — Mejoras Futuras · Módulo Prospección Inteligente
**Estado:** `BACKLOG — NO IMPLEMENTADO` · **Fecha de creación:** 2026-06-29

Este documento registra ideas y mejoras potenciales para futuras iteraciones del módulo Prospección Inteligente. **Ninguna de estas funcionalidades está implementada.** Este documento es un repositorio de ideas, no un plan de sprint ni un compromiso de entrega.

Para implementar cualquier ítem de esta lista se requiere:
1. Autorización explícita de Dirección (G7).
2. Diseño arquitectónico previo (doc de diseño aprobado).
3. Aplicación del proceso completo: typecheck → lint → tests → build → deploy autorizado.

---

## 1. Enriquecimiento automático de empresas

**Idea:** Integrar un proveedor de enriquecimiento externo (Apollo.io, People Data Labs, ZoomInfo, Clearbit) para rellenar automáticamente los campos de empresa que el CSV de LinkedIn no trae: sitio web verificado, industria normalizada, número de empleados real, tecnologías utilizadas, revenue estimado, financiamiento, presencia en Argentina.

**Valor:** Elevar la calidad del Lead Score sin depender de que el CSV esté completo. Hoy el score depende 100% de los datos del CSV.

**Consideraciones:**
- Costo por API call (créditos): evaluar proveedor y modelo de precios.
- Arquitectura ya preparada: `EnrichmentManager` con adapter por proveedor, fallback, cache.
- El rail Outbox (`prospeccion_events`) está reservado para el pipeline asíncrono.
- Requiere contratar el proveedor antes de comenzar el desarrollo.

---

## 2. Crawling del sitio web de la empresa

**Idea:** Dado el sitio web del prospecto (ya normalizado por UDIE desde el CSV), crawlear la página y extraer señales de fit logístico: menciones de depósitos, logística, importación, distribución, texto sobre operaciones. Complementar con el enriquecimiento del punto 1.

**Valor:** Señales logísticas hoy son inferidas desde el CSV; el crawling daría evidencia primaria directa del sitio de la empresa.

**Consideraciones:**
- Requiere `firecrawl` o similar; arquitectura de scraping ya diseñada en el Blueprint.
- Riesgo: privacidad, robots.txt, rate limiting de sitios.
- Output: texto crudo → normalización → señales booleanas (`has_depositos`, etc.).

---

## 3. Detección automática de industria

**Idea:** Hoy `industry_normalized` se infiere desde el campo de industria raw del CSV con un mapper estático. Una mejora sería usar un modelo de lenguaje para normalizar la industria libre a la taxonomía canónica (ideal/compatible/neutral/incompatible) con mayor precisión y cobertura, especialmente para industrias que el mapper estático no reconoce.

**Valor:** Reducir la cantidad de prospectos con `industry_normalized = 'neutral'` por falta de match.

**Consideraciones:**
- API call a LLM por prospecto: costo + latencia.
- Alternativa: ampliar el mapper estático con más entradas (más barato, menos preciso).

---

## 4. Análisis mediante IA del sitio web

**Idea:** Combinar el crawling del punto 2 con un modelo de lenguaje (OpenAI/Claude) para analizar el sitio web de la empresa y extraer: industria real, tipo de negocio, señales de crecimiento, presencia logística, fit con TOPS, resumen ejecutivo de la empresa.

**Valor:** Enriquecimiento cualitativo que el CSV y el mapper estático no pueden dar. Genera una explicación narrativa del fit de cada empresa.

**Consideraciones:**
- `AIProviderManager` ya diseñado en Blueprint; solo requiere implementación.
- Costo por token: evaluar qué modelo y cuántos tokens por análisis.
- Output: campos normalizados + `explanation` extendida.

---

## 5. Análisis de tecnologías utilizadas

**Idea:** Usar BuiltWith, Wappalyzer API, o crawling propio para detectar el stack tecnológico de la empresa prospecto. Una empresa con Shopify + fulfillment propio + WMS legacy es más propensa a tercerizar logística que una empresa nativa digital sin operaciones físicas.

**Valor:** Señal adicional de fit para el score, especialmente para e-commerce y retail.

**Consideraciones:**
- BuiltWith/Wappalyzer tienen APIs de pago.
- La señal es proxy: "usa WMS legacy" ≠ "va a tercerizar". Ponderar con cuidado.

---

## 6. Recomendación comercial personalizada

**Idea:** Después del score, generar automáticamente una recomendación de abordaje comercial personalizada para cada prospecto: qué servicio TOPS ofrecerles primero, qué objeción anticipar, qué caso de éxito similar mostrar, cuál es el ángulo de entrada óptimo.

**Valor:** El comercial llega a la reunión con un script de conversación basado en datos del prospecto, no en intuición.

**Consideraciones:**
- Requiere catálogo de servicios TOPS en el prompt.
- Requiere casos de éxito en base de conocimiento (Nexus no los tiene aún).
- Output: texto libre → persistir en `prospeccion_prospects` o tabla nueva.

---

## 7. Comparación contra clientes actuales

**Idea:** Dado el perfil de un prospecto, compararlo contra el perfil de los clientes actuales de TOPS (en Nexus) para identificar similitudes: industria, tamaño, cargo del contacto, tipo de operación logística. Un prospecto "parecido a un cliente exitoso" debería recibir un boost en el score.

**Valor:** El ICP deja de ser estático (reglas hardcodeadas) y pasa a reflejar el perfil real de los clientes que TOPS tiene.

**Consideraciones:**
- Requiere acceso a datos de clientes en Nexus + extracción de su perfil.
- Privacy: los datos de clientes son confidenciales; el modelo de comparación no debe exponer datos individuales.
- Sesgos: si la base de clientes es pequeña o no diversa, el modelo puede sobre-especializar.

---

## 8. Aprendizaje del motor de scoring

**Idea:** El Feedback Loop diseñado en el Blueprint: cuando un prospecto que fue aprobado por el motor se convierte en cliente (o no), ese resultado alimenta el modelo de scoring para que en el futuro clasifique mejor. Requiere registrar `ganado/perdido`, motivo, margen, tiempo de conversión.

**Valor:** El motor mejora con el tiempo sin intervención manual. Los factores de peso se ajustan automáticamente.

**Consideraciones:**
- Requiere datos de cierre de ventas (no existe aún en Nexus).
- Mínimo de datos necesario para estadística significativa: ~50-100 prospectos con resultado conocido.
- Riesgo de overfitting si la muestra es pequeña.
- Alternativa: ajuste manual de pesos por el equipo comercial.

---

## 9. Métricas de precisión de la IA / del motor

**Idea:** Dashboard de performance del motor de scoring: precisión (¿cuántos prospectos clasificados como "importar" se convirtieron en clientes?), recall, F1-score, drift del modelo, comparación versión anterior vs actual.

**Valor:** Permite saber si el motor está clasificando bien y cuándo es momento de reentrenarlo/ajustarlo.

**Consideraciones:**
- Requiere el Feedback Loop del punto 8 implementado primero.
- El Dashboard de F2 muestra distribución; las métricas de precisión son una capa encima con datos históricos de conversión.

---

## 10. Override analytics

**Idea:** Registrar y visualizar cuándo un usuario aprueba manualmente un prospecto que el motor recomendó descartar, o rechaza uno que recomendó importar. Con el tiempo, analizar los patrones: ¿el equipo comercial siempre aprueba prospectos de cierta industria que el motor descarta? → señal para ajustar el ICP.

**Valor:** Los overrides manuales son el feedback más valioso del sistema; capturarlos y analizarlos mejora el motor.

**Consideraciones:**
- **F2.1 (próxima iteración):** indicador visual de override ya diseñado (`🤖 IA recomendó descartar / 👤 Aprobado manualmente`).
- El analytics completo requiere historial de overrides + dashboard de patrones.
- Privacidad: los patrones de decisión de cada usuario son datos sensibles.

---

## 11. Notificaciones y alertas

**Idea:** Notificar al equipo comercial cuando un lote de prospectos fue calificado y hay prospectos 🟢 esperando aprobación. Notificar al manager cuando un operador rechaza un prospecto que el motor clasificó como excelente.

**Valor:** Reducir el tiempo entre importación y aprobación; los prospectos calientes no quedan esperando días.

**Consideraciones:**
- Canal: email (Resend, ya en Nexus) o WhatsApp (Whappii, ya en Nexus) o notificación in-app.
- Requiere sistema de notificaciones genérico en Nexus (no existe aún).

---

## 12. Exportación bidireccional Clientify ↔ Nexus

**Idea:** Hoy la exportación es solo outbound (Nexus → Clientify). La mejora bidireccional sincronizaría cambios en Clientify de vuelta a Nexus: si el contacto fue actualizado en el CRM, Nexus refleja los cambios; si pasó de Lead a Oportunidad, el status del prospecto avanza.

**Valor:** Nexus y Clientify no divergen con el tiempo; el histórico del prospecto es completo en Nexus.

**Consideraciones:**
- Requiere webhook de Clientify (API de Clientify tiene webhooks).
- Complejidad de conflict resolution: ¿quién gana si ambos lados cambiaron?
- `CRMSyncEngine` bidireccional ya diseñado en Blueprint; solo requiere implementación.

---

## 13. Soporte de múltiples CRMs

**Idea:** Hoy el adapter de exportación es Clientify. Agregar adapters para HubSpot, Salesforce, Pipedrive, Zoho.

**Valor:** Si TOPS cambia de CRM o usa múltiples, el módulo no requiere reescritura.

**Consideraciones:**
- La arquitectura hexagonal ya está preparada: `CRMSyncPort` con implementaciones por CRM.
- `crm_provider` en `prospeccion_crm_refs` ya acepta cualquier string.
- Prioridad: solo si existe necesidad concreta de usar otro CRM.

---

## 14. Enriquecimiento por LinkedIn API oficial

**Idea:** En lugar de depender del CSV exportado manualmente por el usuario, usar la LinkedIn Marketing API o Sales Navigator API para enriquecer prospectos automáticamente sin intervención manual.

**Valor:** Eliminar la fricción del paso "exportar CSV de LinkedIn y subirlo a Nexus".

**Consideraciones:**
- LinkedIn tiene política estricta contra scraping; la API oficial requiere partner agreement.
- Costo: créditos de Sales Navigator API son significativos.
- Complejidad de autenticación OAuth con LinkedIn.
- Riesgo regulatorio: uso de datos de LinkedIn sin consentimiento explícito.

---

*Backlog de mejoras futuras — solo documentación, sin implementación · 2026-06-29 · TOPS NEXUS ERP*
