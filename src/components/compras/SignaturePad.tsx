"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { Icon } from "@/components/Icon";

/**
 * Canvas de firma DPR-aware con soporte mouse + touch + stylus.
 *
 * Comportamiento iOS Safari:
 *  - `touchAction: 'none'` desactiva el scroll/zoom al firmar.
 *  - Eventos passive:false con preventDefault dentro.
 *  - Reset del backing store al cambiar DPR/orientation.
 *  - Trazo `lineWidth: 2.4` `lineCap:round` `strokeStyle: #050555` (azul brand).
 */

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toDataURL: () => string;
  toHash: () => Promise<string>;
}

interface Props {
  hint?: string;
  onChange?: (hasInk: boolean) => void;
  className?: string;
  /** Px de alto del canvas. */
  height?: number;
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { hint = "X — JOSÉ LUIS BATTAGLIA", onChange, className, height = 200 },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const hasInkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#050555";
  }, []);

  // setup + on resize/orientation
  useEffect(() => {
    setup();
    const onResize = () => {
      // backup current as image, resize, re-paint
      const canvas = canvasRef.current;
      if (!canvas) return;
      const data = hasInkRef.current ? canvas.toDataURL("image/png") : null;
      setup();
      if (data) {
        const img = new Image();
        img.onload = () => {
          const c = canvasRef.current;
          if (!c) return;
          const ctx = c.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, c.getBoundingClientRect().width, c.getBoundingClientRect().height);
        };
        img.src = data;
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [setup]);

  const getPt = (e: PointerEvent | MouseEvent | Touch): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startStroke = (x: number, y: number) => {
    drawingRef.current = true;
    lastPtRef.current = { x, y };
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const drawTo = (x: number, y: number) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const last = lastPtRef.current;
    if (last) {
      const mx = (last.x + x) / 2;
      const my = (last.y + y) / 2;
      ctx.quadraticCurveTo(last.x, last.y, mx, my);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx, my);
    }
    lastPtRef.current = { x, y };
    if (!hasInkRef.current) {
      hasInkRef.current = true;
      setHasInk(true);
      onChange?.(true);
    }
  };

  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPtRef.current = null;
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.closePath();
  };

  // Pointer events (cubren mouse, touch, stylus en navegadores modernos)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const { x, y } = getPt(e);
      startStroke(x, y);
    };
    const onMove = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      const { x, y } = getPt(e);
      drawTo(x, y);
    };
    const onUp = (e: PointerEvent) => {
      e.preventDefault();
      endStroke();
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {}
    };

    canvas.addEventListener("pointerdown", onDown, { passive: false });
    canvas.addEventListener("pointermove", onMove, { passive: false });
    canvas.addEventListener("pointerup", onUp, { passive: false });
    canvas.addEventListener("pointercancel", onUp, { passive: false });
    canvas.addEventListener("pointerleave", onUp, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        hasInkRef.current = false;
        setHasInk(false);
        onChange?.(false);
      },
      isEmpty: () => !hasInkRef.current,
      toDataURL: () => {
        const canvas = canvasRef.current;
        return canvas ? canvas.toDataURL("image/png") : "";
      },
      toHash: async () => {
        const canvas = canvasRef.current;
        if (!canvas) return "";
        const data = canvas.toDataURL("image/png");
        const buf = new TextEncoder().encode(data);
        if (crypto?.subtle) {
          const d = await crypto.subtle.digest("SHA-256", buf);
          return Array.from(new Uint8Array(d))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        }
        return "";
      },
    }),
    [onChange]
  );

  return (
    <div className={className}>
      <div
        className="relative rounded-lg border-2 border-dashed border-stroke-strong bg-white"
        style={{ height }}
      >
        <span className="absolute top-2 left-3 text-[10px] font-bold tracking-[0.16em] uppercase text-fg-muted">
          {hint}
        </span>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full rounded-lg cursor-crosshair"
          style={{ touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}
        />
        {!hasInk && (
          <div className="absolute inset-0 grid place-items-center text-fg-muted pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-xs">
              <Icon name="pen" size={26} />
              <span>Tocá y firmá con el dedo o stylus</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
