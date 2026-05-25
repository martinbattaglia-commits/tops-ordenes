"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import type { Order } from "@/lib/types";

export function OrderActions({ order, publicUrl }: { order: Order; publicUrl: string }) {
  const [shareOpen, setShareOpen] = useState(false);

  const onWhatsapp = () => {
    const text = encodeURIComponent(
      `Comprobante TOPS Órdenes — ${order.public_id}\nCliente: ${order.client?.razon ?? ""}\n${publicUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const onMail = () => {
    const to = order.client?.email ?? "";
    const subject = encodeURIComponent(`Comprobante TOPS — ${order.public_id}`);
    const body = encodeURIComponent(
      `Le adjuntamos el comprobante de servicio ${order.public_id}.\n\nVer online: ${publicUrl}\n\n— Logística TOPS (Verotin S.A.)`
    );
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      alert("Link copiado al portapapeles");
    } catch {
      alert(publicUrl);
    }
  };

  const onNativeShare = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share({
          title: `TOPS Órdenes — ${order.public_id}`,
          text: `Comprobante de servicio para ${order.client?.razon ?? ""}`,
          url: publicUrl,
        });
        return;
      } catch {
        // user cancelled
      }
    }
    setShareOpen(true);
  };

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <a
        href={`/api/orders/${order.public_id}/pdf`}
        target="_blank"
        className="btn btn-ghost btn-sm"
      >
        <Icon name="download" size={13} />
        <span className="hidden sm:inline">PDF</span>
      </a>
      <button onClick={onWhatsapp} className="btn btn-ghost btn-sm" title="WhatsApp">
        <Icon name="whatsapp" size={13} />
        <span className="hidden sm:inline">WhatsApp</span>
      </button>
      <button onClick={onMail} className="btn btn-ghost btn-sm" title="Mail">
        <Icon name="send" size={13} />
        <span className="hidden sm:inline">Reenviar</span>
      </button>
      <button onClick={onNativeShare} className="btn btn-ghost btn-sm">
        <Icon name="share" size={13} />
        <span className="hidden sm:inline">Compartir</span>
      </button>
      <button onClick={onCopy} className="btn btn-ghost btn-sm" title="Copiar link">
        <Icon name="copy" size={13} />
      </button>

      {shareOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/40"
          onClick={() => setShareOpen(false)}
        >
          <div
            className="bg-white rounded-t-xl sm:rounded-lg w-full sm:max-w-sm p-5 m-0 sm:m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-bold mb-3">Compartir comprobante</div>
            <button className="btn btn-ghost w-full justify-start mb-2" onClick={onWhatsapp}>
              <Icon name="whatsapp" size={14} /> WhatsApp
            </button>
            <button className="btn btn-ghost w-full justify-start mb-2" onClick={onMail}>
              <Icon name="mail" size={14} /> Email
            </button>
            <button className="btn btn-ghost w-full justify-start mb-2" onClick={onCopy}>
              <Icon name="copy" size={14} /> Copiar link
            </button>
            <button
              className="btn btn-primary w-full justify-center"
              onClick={() => setShareOpen(false)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
