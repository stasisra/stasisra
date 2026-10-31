/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
    "better-sqlite3",
    "pdfkit",
  ],
  experimental: { cpus: 2 },
  outputFileTracingIncludes: { "/api/tasks/export.pdf": ["./assets/fonts/*"] },
};
export default nextConfig;
