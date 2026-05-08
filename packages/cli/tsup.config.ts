import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/bin/flyway.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  minify: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
})
