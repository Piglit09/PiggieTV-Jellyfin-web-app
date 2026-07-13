/// <reference types="vitest" />
/// <reference types="vite/client" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        alias: {
            lib: fileURLToPath(new URL('./src/lib', import.meta.url))
        }
    },
    test: {
        coverage: {
            include: [ 'src' ]
        },
        environment: 'jsdom',
        restoreMocks: true
    }
});
