/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Proxy AI-server calls in dev so the browser talks to one origin.
    return [
      {
        source: "/backend/:path*",
        destination: `${process.env.BACKEND_URL ?? "http://localhost:8000"}/:path*`,
      },
    ];
  },
};
export default nextConfig;
