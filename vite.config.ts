import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');

  const proxyConfig = {
    '/api': {
      target: 'https://api.bybit.com',
      changeOrigin: true,
      secure: false,
      rewrite: (path) => path.replace(/^\/api/, ''),
    }
  };

  return {
    plugins: [react()],
    server: {
      port: 8085,
      host: true,
      proxy: proxyConfig
    },
    preview: {
      port: 8085,
      host: true,
      proxy: proxyConfig
    },
    define: {
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY || env.API_KEY)
    }
  }
})