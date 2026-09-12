import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'disk-usage-worker': resolve('src/main/disk-usage/worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'disk-usage': resolve('src/preload/disk-usage.ts'),
          vnc: resolve('src/preload/vnc.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    // noVNC uses top-level await, which the Electron renderer supports.
    optimizeDeps: {
      esbuildOptions: {
        target: 'es2022'
      }
    },
    build: {
      target: 'es2022',
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          diskUsage: resolve('src/renderer/disk-usage.html'),
          vnc: resolve('src/renderer/vnc.html')
        }
      }
    }
  }
})
