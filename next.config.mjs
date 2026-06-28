import { getBuildVersion } from "./scripts/version-info.mjs";

// Trazabilidad de despliegue: se computa una sola vez al cargar la config y se
// inyecta en el bundle como NEXT_PUBLIC_*. Ver scripts/version-info.mjs.
const BUILD = getBuildVersion();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Inyección automática de versión en cada build (local, Netlify CLI o git).
  env: {
    NEXT_PUBLIC_COMMIT_SHA: BUILD.commitSha,
    NEXT_PUBLIC_BRANCH: BUILD.branch,
    NEXT_PUBLIC_BUILD_DATE: BUILD.buildDate,
    NEXT_PUBLIC_BUILD_ID: BUILD.buildId,
    NEXT_PUBLIC_DEPLOY_CONTEXT: BUILD.environment,
  },
  // buildId determinístico = SHA corto → el buildId servido en /_next/static/
  // queda atado al commit (trazable también desde el artefacto publicado).
  generateBuildId: () => BUILD.buildId,
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  experimental: {
    optimizePackageImports: ["@supabase/supabase-js"],
    // pdf-parse / pdfjs-dist no soportan el bundling de webpack (RSC): su
    // carga lanza "Object.defineProperty called on non-object". Marcarlo como
    // paquete externo hace que Node lo requiera de forma nativa en runtime.
    // @napi-rs/canvas: binario nativo (.node) usado para rasterizar PDFs
    // escaneados a imagen (camino OCR pdf_image). Debe requerirse nativo, no
    // bundlearse.
    serverComponentsExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
    // El file-tracing de Next no siempre detecta el .node prebuilt de canvas
    // (se resuelve dinámico). Lo incluimos explícito en la función OCR para que
    // viaje en el zip de la Netlify Function.
    outputFileTracingIncludes: {
      "/api/documental/ocr": ["./node_modules/@napi-rs/canvas/**"],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN (no DENY) para permitir embeber herramientas internas
          // same-origin vía <iframe> (ej. /tools/cotizador en /comercial/herramientas).
          // Sigue bloqueando que cualquier sitio externo enmarque la app (anti-clickjacking).
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
