import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['test/**/*.test.ts'], env: { LOG_LEVEL: 'silent', TZ_DISPLAY: 'America/Sao_Paulo' } } });
