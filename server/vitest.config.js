import { defineConfig, configDefaults } from 'vitest/config';
export default defineConfig({ test: {
  setupFiles: ['./tests/setup.js'],
  exclude: [...configDefaults.exclude, 'backups/**']
} });
