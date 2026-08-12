import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "ort.webgpu.bundle.min.mjs": path.resolve(process.cwd(), "node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs"),
      "ort.bundle.min.mjs": path.resolve(process.cwd(), "node_modules/onnxruntime-web/dist/ort.bundle.min.mjs"),
      "ort-wasm-simd-threaded.jsep.wasm": path.resolve(process.cwd(), "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm"),
    };
    config.module.rules.push({
      test: /ort-wasm-simd-threaded\.jsep\.wasm$/,
      type: "asset/resource",
    });
    return config;
  },
};

export default nextConfig;
