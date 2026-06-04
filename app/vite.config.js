import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build output goes into backend/pb_public/admin so PocketBase serves the
// management app at /admin/ - the ROOT of pb_public belongs to the public
// bilingual booking site (backend/pb_public/index.html, kept in git, never
// touched by this build because emptyOutDir only clears the admin/ subdir).
export default defineConfig({
  plugins: [react()],
  base: "/admin/",
  build: {
    outDir: "../backend/pb_public/admin",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8090",
    },
  },
});
