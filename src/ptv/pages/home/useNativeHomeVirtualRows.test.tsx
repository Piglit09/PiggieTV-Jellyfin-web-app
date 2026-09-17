import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => null,
        getApiClient: () => null
    }
}));

vi.mock('../../api', () => ({
    getCurrentPtvApiClient: () => null,
    getPtvCurrentUser: vi.fn(async () => null),
    getPtvItems: vi.fn(async () => ({ Items: [], TotalRecordCount: 0 })),
    getPtvRecentlyAdded: vi.fn(async () => []),
    getPtvResumeItems: vi.fn(async () => []),
    isPtvAdminUser: () => false
}));

import { useNativeHomeVirtualRows, type NativeHomeRow } from './hooks';

const rows = [{
    id: 'row-a',
    items: [],
    kind: 'items',
    source: 'recently-added',
    subtitle: '',
    title: 'Row A'
}] satisfies NativeHomeRow[];

const reactActEnvironment = globalThis as typeof globalThis & {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

class TestIntersectionObserver {
    static readonly instances: TestIntersectionObserver[] = [];

    readonly disconnect = vi.fn();
    readonly observe = vi.fn();
    readonly unobserve = vi.fn();

    constructor() {
        TestIntersectionObserver.instances.push(this);
    }
}

describe('useNativeHomeVirtualRows lifecycle', () => {
    let container: HTMLDivElement;
    let root: Root;
    const capturedRefs: Array<(node: HTMLElement | null) => void> = [];

    function Harness({ marker }: Readonly<{ marker: string }>) {
        const { registerRowRef } = useNativeHomeVirtualRows(rows);
        const rowRef = registerRowRef('row-a');

        capturedRefs.push(rowRef);

        return <div data-marker={marker} ref={rowRef} />;
    }

    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        TestIntersectionObserver.instances.length = 0;
        capturedRefs.length = 0;
        vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 73));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
        vi.unstubAllGlobals();
    });

    it('keeps row ref callbacks stable and disposes observer work on unmount', async () => {
        await act(async () => root.render(<Harness marker='first' />));

        const observer = TestIntersectionObserver.instances[0];
        const firstRef = capturedRefs[0];
        const observeCount = observer.observe.mock.calls.length;
        const unobserveCount = observer.unobserve.mock.calls.length;

        await act(async () => root.render(<Harness marker='second' />));

        expect(TestIntersectionObserver.instances).toHaveLength(1);
        expect(capturedRefs.at(-1)).toBe(firstRef);
        expect(observer.observe).toHaveBeenCalledTimes(observeCount);
        expect(observer.unobserve).toHaveBeenCalledTimes(unobserveCount);

        act(() => root.unmount());

        expect(TestIntersectionObserver.instances.every(instance => (
            instance.disconnect.mock.calls.length === 1
        ))).toBe(true);
        expect(cancelAnimationFrame).toHaveBeenCalledWith(73);

        root = createRoot(container);
    });
});
