import { defineConfig, devices } from '@playwright/test';

const sharedUse = {
    baseURL: 'http://127.0.0.1:4177',
    screenshot: 'only-on-failure' as const,
    trace: 'retain-on-failure' as const
};

export default defineConfig({
    expect: {
        timeout: 5_000
    },
    forbidOnly: Boolean(process.env.CI),
    fullyParallel: true,
    outputDir: 'test-results/playwright-cross-browser',
    projects: [
        {
            name: 'chrome',
            use: {
                ...devices['Desktop Chrome'],
                ...sharedUse
            }
        },
        {
            name: 'edge',
            use: {
                ...devices['Desktop Edge'],
                ...sharedUse,
                channel: 'msedge'
            }
        },
        {
            name: 'firefox',
            use: {
                ...devices['Desktop Firefox'],
                ...sharedUse
            }
        }
    ],
    reporter: process.env.CI ? 'github' : 'list',
    retries: process.env.CI ? 1 : 0,
    testDir: './e2e/tests',
    timeout: 20_000,
    webServer: process.env.PTV_LIVE_DEV_URL ? undefined : {
        command: 'node e2e/server.mjs',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        url: 'http://127.0.0.1:4177'
    },
    workers: process.env.CI ? 2 : 4
});
