import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import fs from "fs";

// service.html (страница бэкапов) лежит в корне проекта и раздаётся сервером,
// но nginx отдаёт статику из dist/ — копируем её туда при каждой сборке.
const copyServicePage = {
  name: "copy-service-page",
  closeBundle() {
    const src = new URL("./service.html", import.meta.url).pathname;
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, new URL("./dist/service.html", import.meta.url).pathname);
    }
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), copyServicePage],
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    hmr: {
      port: 3000,
    },
  },
});
