/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Proxy AI-server calls in dev so the browser talks to one origin.
    // Note the hard limit: this proxy returns 500 at exactly 30s for any
    // upstream slower than that, measured. Curriculum generation runs for
    // minutes, so lib/api/generation.ts deliberately bypasses this rewrite
    // via NEXT_PUBLIC_BACKEND_ORIGIN. Keep long running calls off it.
    return [
      {
        source: "/backend/:path*",
        destination: `${process.env.BACKEND_URL ?? "http://localhost:8000"}/:path*`,
      },
    ];
  },
};
export default nextConfig;
