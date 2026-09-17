import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useAdminConfigurationForm } from './useAdminConfigurationForm';

// eslint-disable-next-line @typescript-eslint/naming-convention
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface TestSettings {
    persisted: string;
    transient: string;
}

type FormState = ReturnType<typeof useAdminConfigurationForm<TestSettings>>;

const equalPersistedSettings = (left: TestSettings, right: TestSettings) => (
    left.persisted === right.persisted
);

let currentState: FormState | undefined;

function FormHarness({ source }: Readonly<{ source: TestSettings | null }>) {
    currentState = useAdminConfigurationForm(source, equalPersistedSettings);

    return null;
}

describe('useAdminConfigurationForm', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        currentState = undefined;
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        currentState = undefined;
    });

    it('adopts the initial baseline and can reset a local edit', async () => {
        const source = { persisted: 'initial', transient: 'source-a' };

        await act(async () => root.render(<FormHarness source={source} />));

        expect(currentState?.form).toEqual(source);
        expect(currentState?.confirmed).toEqual(source);
        expect(currentState?.dirty).toBe(false);

        act(() => currentState?.update('persisted', 'draft'));

        expect(currentState?.form?.persisted).toBe('draft');
        expect(currentState?.dirty).toBe(true);

        act(() => currentState?.reset());

        expect(currentState?.form).toEqual(source);
        expect(currentState?.confirmed).toEqual(source);
        expect(currentState?.dirty).toBe(false);
        expect(currentState?.serverChanged).toBe(false);
    });

    it('does not conflict when a recreated source is semantically equal to the confirmed baseline', async () => {
        await act(async () => root.render(
            <FormHarness source={{ persisted: 'initial', transient: 'source-a' }} />
        ));
        act(() => currentState?.update('persisted', 'draft'));

        await act(async () => root.render(
            <FormHarness source={{ persisted: 'initial', transient: 'source-b' }} />
        ));

        expect(currentState?.form?.persisted).toBe('draft');
        expect(currentState?.dirty).toBe(true);
        expect(currentState?.serverChanged).toBe(false);
    });

    it('adopts a self-save cache publication that is semantically equal to the current draft', async () => {
        await act(async () => root.render(
            <FormHarness source={{ persisted: 'initial', transient: 'source-a' }} />
        ));
        act(() => currentState?.update('persisted', 'saved'));

        const published = { persisted: 'saved', transient: 'server-normalized' };
        await act(async () => root.render(<FormHarness source={published} />));

        expect(currentState?.form).toEqual(published);
        expect(currentState?.confirmed).toEqual(published);
        expect(currentState?.dirty).toBe(false);
        expect(currentState?.serverChanged).toBe(false);
    });

    it('flags a genuine server change while preserving the local draft', async () => {
        await act(async () => root.render(
            <FormHarness source={{ persisted: 'initial', transient: 'source-a' }} />
        ));
        act(() => currentState?.update('persisted', 'draft'));

        await act(async () => root.render(
            <FormHarness source={{ persisted: 'external', transient: 'source-b' }} />
        ));

        expect(currentState?.form?.persisted).toBe('draft');
        expect(currentState?.confirmed?.persisted).toBe('initial');
        expect(currentState?.dirty).toBe(true);
        expect(currentState?.serverChanged).toBe(true);

        await act(async () => root.render(
            <FormHarness source={{ persisted: 'initial', transient: 'source-c' }} />
        ));

        expect(currentState?.dirty).toBe(true);
        expect(currentState?.serverChanged).toBe(false);
    });

    it('adopts an explicit successful-save baseline', async () => {
        await act(async () => root.render(
            <FormHarness source={{ persisted: 'initial', transient: 'source-a' }} />
        ));
        act(() => currentState?.update('persisted', 'draft'));

        const saved = { persisted: 'saved', transient: 'verified' };
        await act(async () => {
            currentState?.adopt(saved);
            root.render(<FormHarness source={saved} />);
        });

        expect(currentState?.form).toEqual(saved);
        expect(currentState?.confirmed).toEqual(saved);
        expect(currentState?.dirty).toBe(false);
        expect(currentState?.serverChanged).toBe(false);
    });

    it('does not carry dirty or conflict state across remounted settings pages', async () => {
        await act(async () => root.render(
            <FormHarness
                key='page-a'
                source={{ persisted: 'page-a', transient: 'source-a' }}
            />
        ));
        act(() => currentState?.update('persisted', 'page-a-draft'));
        await act(async () => root.render(
            <FormHarness
                key='page-a'
                source={{ persisted: 'page-a-external', transient: 'source-b' }}
            />
        ));
        expect(currentState?.serverChanged).toBe(true);

        const pageB = { persisted: 'page-b', transient: 'source-c' };
        await act(async () => root.render(
            <FormHarness key='page-b' source={pageB} />
        ));

        expect(currentState?.form).toEqual(pageB);
        expect(currentState?.confirmed).toEqual(pageB);
        expect(currentState?.dirty).toBe(false);
        expect(currentState?.serverChanged).toBe(false);
    });
});
