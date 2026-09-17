import { describe, expect, it, vi } from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    // Model the partially initialized barrel export that exists while
    // ServerConnections is still evaluating its circular dependency graph.
    ServerConnections: undefined
}));

describe('Plugin API bootstrap module evaluation', () => {
    it('does not read ServerConnections while the Plugin API module is evaluating', async () => {
        await expect(import('./pluginApi')).resolves.toBeDefined();
    });
});
