import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Exclude Vite app folder from Next.js compilation
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
}

export default nextConfig
