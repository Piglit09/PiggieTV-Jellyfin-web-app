/// <reference types="vitest" />
/// <reference types="vite/client" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        alias: {
            // URL is a Node build-time API here, not a browser compatibility requirement.
            // eslint-disable-next-line compat/compat
            lib: fileURLToPath(new URL('./src/lib', import.meta.url))
        }
    },
    test: {
        coverage: {
            include: [ 'src' ]
        },
        environment: 'jsdom',
        include: [ 'src/**/*.{test,spec}.{js,jsx,ts,tsx}' ],
        restoreMocks: true
    }
});
