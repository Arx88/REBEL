import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.watchOptions = {
      ignored: ['**/app/src/**', '**/multi-agent-orchestrator/**', '**/node_modules/**'],
    }
    return config
  },
}

export default nextConfig
