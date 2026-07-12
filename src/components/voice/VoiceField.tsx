"use client";

import {
  cloneElement,
  isValidElement,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
} from "react";
import { insertAtCursor } from "@/lib/voice/dom";
import { useVoiceSession } from "./useVoiceSession";
import { VoiceMicButton } from "./VoiceMicButton";

type Editable = HTMLInputElement | HTMLTextAreaElement;

export interface VoiceFieldProps {
  /** Un único <input> o <textarea>. */
  children: ReactElement;
  /** Clases del contenedor. Ej: "flex-1 min-w-0" dentro de un flex. */
  className?: string;
}

function mergeRefs(...refs: Array<Ref<Editable> | undefined>) {
  return (node: Editable | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object") {
        (ref as { current: Editable | null }).current = node;
      }
    }
  };
}

export function VoiceField({ children, className = "" }: VoiceFieldProps) {
  const elRef = useRef<Editable | null>(null);

  const voice = useVoiceSession({
    onFinal: (text) => {
      const el = elRef.current;
      if (el) insertAtCursor(el, text);
    },
  });

  if (!isValidElement(children)) return children;
  // Navegador incompatible o flag apagado: campo normal, sin micrófono roto.
  if (!voice.enabled) return children;

  const child = children as ReactElement<{
    className?: string;
    // `ref` vive en este TIPO solo para que cloneElement acepte la config
    // (su parámetro es Partial<P> y debe incluirlo). El VALOR real se lee
    // del elemento, no de props — en React 18 `ref` no viaja dentro de props.
    ref?: Ref<Editable>;
    onKeyDown?: (ev: KeyboardEvent<Editable>) => void;
    onBlur?: (ev: FocusEvent<Editable>) => void;
  }>;

  const isTextarea = child.type === "textarea";

  // En React 18 `ref` NO viaja dentro de props: vive en el elemento.
  // Leerlo de child.props devolvería undefined y se perdería el ref del consumidor.
  const childRef = (child as unknown as { ref?: Ref<Editable> }).ref;

  const enhanced = cloneElement(child, {
    ref: mergeRefs(childRef, elRef),
    className: `${child.props.className ?? ""} pr-10`.trim(),
    onKeyDown: (ev: KeyboardEvent<Editable>) => {
      // Escape = Cancelar. Siempre. En toda la plataforma. Ver spec §6.1.
      if (ev.key === "Escape" && voice.state === "listening") {
        ev.preventDefault();
        ev.stopPropagation();
        voice.cancel();
        return;
      }
      child.props.onKeyDown?.(ev);
    },
    onBlur: (ev: FocusEvent<Editable>) => {
      // Perder el foco FINALIZA: conserva el texto. No es una cancelación.
      if (voice.state === "listening") void voice.stop();
      child.props.onBlur?.(ev);
    },
  });

  return (
    <div className={`relative ${className}`}>
      {enhanced}
      <div
        className={`absolute right-1.5 ${isTextarea ? "top-1.5" : "top-1/2 -translate-y-1/2"}`}
      >
        <VoiceMicButton
          state={voice.state}
          level={voice.level}
          error={voice.error}
          meterActive={voice.meterActive}
          onStart={() => void voice.start()}
          onStop={() => void voice.stop()}
        />
      </div>

      {voice.state === "listening" && voice.partial && (
        <p className="mt-1 truncate text-[11px] italic text-fg-muted" aria-hidden>
          {voice.partial}
        </p>
      )}
      {voice.state === "error" && voice.error && (
        <p className="mt-1 text-[11px] text-tops-red" role="status">
          {voice.error}
        </p>
      )}
    </div>
  );
}
