"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import {
  APPROVED_UTILITY_TEMPLATES,
  renderTemplateText,
  type UtilityTemplate,
} from "@/lib/whatsapp/templates";

export function WaTemplateSelector({
  onSelectTemplate,
  onCancel,
  currentDraft,
}: {
  onSelectTemplate: (templateText: string, templateId: string) => void;
  onCancel?: () => void;
  currentDraft?: string;
}) {
  const [selectedId, setSelectedId] = useState<string>(APPROVED_UTILITY_TEMPLATES[0].id);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const currentTemplate = APPROVED_UTILITY_TEMPLATES.find((t) => t.id === selectedId) ?? APPROVED_UTILITY_TEMPLATES[0];

  function handleParamChange(paramName: string, value: string) {
    setParamValues((prev) => ({ ...prev, [paramName]: value }));
  }

  const renderedText = renderTemplateText(currentTemplate, paramValues);

  function handleSend() {
    onSelectTemplate(renderedText, currentTemplate.id);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-stroke-soft bg-bg-surface p-4 text-xs shadow-lg">
      <div className="flex items-center justify-between border-b border-stroke-soft pb-2">
        <div className="flex items-center gap-2">
          <Icon name="whatsapp" size={16} className="text-green-500" />
          <h3 className="font-bold text-fg-primary text-sm">Seleccionar Plantilla Utility (Meta)</h3>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-fg-muted hover:text-fg-primary">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      {currentDraft && (
        <div className="rounded bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
          <strong>Borrador conservado:</strong> &ldquo;{currentDraft}&rdquo;
        </div>
      )}

      {/* Template Selector dropdown */}
      <div className="flex flex-col gap-1">
        <label className="font-semibold text-fg-secondary">Plantillas Aprobadas:</label>
        <select
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setParamValues({});
          }}
          className="rounded border border-stroke-soft bg-bg-page p-2 font-medium text-fg-primary outline-none focus:border-tops-red"
        >
          {APPROVED_UTILITY_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} ({t.name})
            </option>
          ))}
        </select>
      </div>

      {/* Parameter inputs */}
      {currentTemplate.params.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="font-semibold text-fg-secondary">Parámetros de la plantilla:</label>
          {currentTemplate.params.map((p) => (
            <div key={p.name} className="flex flex-col gap-0.5">
              <span className="text-[11px] text-fg-muted">{p.label}:</span>
              <input
                type="text"
                value={paramValues[p.name] ?? ""}
                onChange={(e) => handleParamChange(p.name, e.target.value)}
                placeholder={p.placeholder}
                className="rounded border border-stroke-soft bg-bg-page px-2.5 py-1.5 text-xs text-fg-primary outline-none focus:border-tops-red"
              />
            </div>
          ))}
        </div>
      )}

      {/* Preview */}
      <div className="flex flex-col gap-1 rounded bg-bg-surface-alt p-2.5">
        <span className="text-[10px] font-bold uppercase text-fg-muted">Vista previa del mensaje:</span>
        <p className="text-xs text-fg-primary whitespace-pre-wrap font-sans">{renderedText}</p>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
            Cancelar
          </button>
        )}
        <button type="button" onClick={handleSend} className="btn btn-nexus btn-sm font-semibold">
          <Icon name="send" size={13} /> Enviar Plantilla
        </button>
      </div>
    </div>
  );
}
