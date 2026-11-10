import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents queda desactivado a propósito: el sitio y el panel de cada estudio
  // dependen del host, la base y la sesión en cada request, y así un estudio inexistente
  // devuelve 404 real y las redirecciones de login son HTTP (307), no del navegador.
  // Ojo: Next anuncia que en la próxima versión mayor esta opción deja de existir.
  experimental: {
    // Logos de hasta 1 MB + el overhead del formulario multipart.
    serverActions: { bodySizeLimit: "2mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
