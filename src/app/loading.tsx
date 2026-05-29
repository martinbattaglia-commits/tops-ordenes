export default function Loading() {
  return (
    <div className="min-h-screen grid place-items-center bg-bg-page">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-end gap-1.5">
          <span className="text-2xl font-black uppercase tracking-tight text-tops-blue-900">
            TOPS
          </span>
          <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-tops-red mb-1">
            Órdenes
          </span>
        </div>
        <div className="w-32 h-1 bg-neutral-100 rounded-full overflow-hidden relative">
          <span
            className="absolute inset-y-0 left-0 w-1/3 bg-tops-red rounded-full"
            style={{ animation: "loading-slide 1.2s ease-in-out infinite" }}
          />
        </div>
      </div>
      <style>{`
        @keyframes loading-slide {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(180%); }
          100% { transform: translateX(380%); }
        }
      `}</style>
    </div>
  );
}
