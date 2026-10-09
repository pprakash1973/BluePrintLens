import type { NextConfig } from "next";
import path from "node:path";

// Keep local data next to the app regardless of the process working directory.
process.env.PGLITE_DIR ??= path.join(__dirname, ".data", "pglite");
process.env.LOCAL_STORAGE_DIR ??= path.join(__dirname, ".data", "files");

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pdf-lib", "unpdf", "mammoth", "exceljs", "pptxgenjs"],
  async headers() {
    // Allow embedding as a Microsoft Teams / SharePoint tab (FR-26).
    const ancestors =
      "frame-ancestors 'self' https://teams.microsoft.com https://*.teams.microsoft.com https://*.sharepoint.com https://*.office.com https://*.microsoft365.com";
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: ancestors }] }];
  },
};

export default nextConfig;
