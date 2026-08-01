/// <reference types="vitest" />
/// <reference types="vite/client" />
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        alias: {
            // URL is a Node build-time API here, not a browser compatibility requirement.
            // eslint-disable-next-line compat/compat
            apps: fileURLToPath(new URL('./src/apps', import.meta.url)),
            // URL is a Node build-time API here, not a browser compatibility requirement.
            // eslint-disable-next-line compat/compat
            components: fileURLToPath(new URL('./src/components', import.meta.url)),
            // eslint-disable-next-line compat/compat
            constants: fileURLToPath(new URL('./src/constants', import.meta.url)),
            // eslint-disable-next-line compat/compat
            lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
            // eslint-disable-next-line compat/compat
            ptv: fileURLToPath(new URL('./src/ptv', import.meta.url)),
            // eslint-disable-next-line compat/compat
            RootAppRouter: fileURLToPath(new URL('./src/RootAppRouter.tsx', import.meta.url)),
            // eslint-disable-next-line compat/compat
            scripts: fileURLToPath(new URL('./src/scripts', import.meta.url)),
            // eslint-disable-next-line compat/compat
            types: fileURLToPath(new URL('./src/types', import.meta.url)),
            // eslint-disable-next-line compat/compat
            utils: fileURLToPath(new URL('./src/utils', import.meta.url))
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
