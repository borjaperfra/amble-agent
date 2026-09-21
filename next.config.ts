import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Un servidor que se copia solo.
   *
   * `standalone` deja en `.next/standalone` el servidor con sus dependencias
   * ya trazadas, que es lo que permite que la imagen de Docker no lleve
   * `node_modules` entero dentro. Sin esto la imagen pasa de ~200MB a más de
   * un giga y cada despliegue se nota.
   */
  output: "standalone",
};

export default nextConfig;
