import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  // IMP-B13: tsc по всему проекту чистый (download/, examples/, skills/, tool-results/
  // исключены в tsconfig.json; formatDetection в layout.tsx перенесён в metadata — 20-FE4),
  // поэтому сборка снова проверяет типы.
  reactStrictMode: false,
};

export default nextConfig;
