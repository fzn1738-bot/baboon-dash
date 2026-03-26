import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react()],
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/v5': {
          target: 'https://api.bybit.com',
          changeOrigin: true,
          secure: false,
        }
      }
    },
    preview: {
      port: 3000,
      host: true,
      proxy: {
        '/v5': {
          target: 'https://api.bybit.com',
          changeOrigin: true,
          secure: false,
        }
      }
    },
    define: {
      // Safely expose only the API_KEY. 
      // In Docker build, this comes from the ARG/ENV.
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY || env.API_KEY)
    }
  }
})