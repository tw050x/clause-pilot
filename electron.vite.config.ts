import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()],
    // SuperDoc starts its document engine in a worker it finds next to its own files. Pre-bundled
    // for the dev server, those files move and the worker can't be found: serve them as they are.
    optimizeDeps: { exclude: ['superdoc', '@superdoc/docx-engine'] }
  }
})
