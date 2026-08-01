import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import defaultConfig from '../config.json';
import type { WebConfig } from '../types/webConfig';

// eslint-disable-next-line @typescript-eslint/naming-convention
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const webConfigMocks = vi.hoisted(() => ({
    getWebConfig: vi.fn(),
    subscribeWebConfig: vi.fn()
}));

vi.mock('../scripts/settings/webSettings', () => webConfigMocks);

import { WebConfigProvider, useWebConfig } from './useWebConfig';

function ConfigProbe() {
    const config = useWebConfig();

    return <output data-multiserver={String(config.multiserver)} />;
}

describe('WebConfigProvider', () => {
    let container: HTMLDivElement;
    let root: Root | null;
    let subscribedListener: ((config: WebConfig) => void) | undefined;
    const unsubscribe = vi.fn();

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        subscribedListener = undefined;
        unsubscribe.mockReset();
        webConfigMocks.getWebConfig.mockReset();
        webConfigMocks.subscribeWebConfig.mockReset();
        webConfigMocks.getWebConfig.mockResolvedValue(defaultConfig);
        webConfigMocks.subscribeWebConfig.mockImplementation(listener => {
            subscribedListener = listener;
            return unsubscribe;
        });
    });

    afterEach(() => {
        if (root) act(() => root?.unmount());
        container.remove();
        vi.restoreAllMocks();
    });

    it('adopts a recovered config after its initial reader received bundled defaults', async () => {
        await act(async () => {
            root?.render(
                <WebConfigProvider>
                    <ConfigProbe />
                </WebConfigProvider>
            );
            await Promise.resolve();
        });

        expect(container.querySelector('output')?.dataset.multiserver)
            .toBe(String(defaultConfig.multiserver));
        expect(webConfigMocks.getWebConfig).toHaveBeenCalledOnce();
        expect(webConfigMocks.subscribeWebConfig).toHaveBeenCalledOnce();

        const recoveredConfig: WebConfig = {
            ...defaultConfig,
            multiserver: !defaultConfig.multiserver
        };

        await act(async () => {
            subscribedListener?.(recoveredConfig);
            await Promise.resolve();
        });

        expect(container.querySelector('output')?.dataset.multiserver)
            .toBe(String(recoveredConfig.multiserver));

        act(() => root?.unmount());
        root = null;
        expect(unsubscribe).toHaveBeenCalledOnce();
    });
});
