import { fileURLToPath } from "node:url";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import icon from "astro-icon";
import { loadEnv } from "vite";

const fileEnv = loadEnv(process.env.NODE_ENV ?? "production", process.cwd(), "");
const siteUrl =
  process.env.SITE_URL ||
  fileEnv.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://zju-open-source.vercel.app");

export default defineConfig({
  site: siteUrl,
  output: "static",
  integrations: [
    icon({
      include: {
        lucide: ["*"],
      },
    }),
    sitemap({
      filter: (page) => !page.endsWith("/404/"),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
});
