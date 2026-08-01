import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HomeCustomizationDialog from './HomeCustomizationDialog';
import type { NativeHomeLayoutPreferences } from './services/homePreferenceService';

function setReactActEnvironment(value: boolean) {
    const environment = globalThis as typeof globalThis & Record<string, unknown>;

    environment['IS_REACT_ACT_ENVIRONMENT'] = value;
}

const rows = [
    {
        id: 'continue-watching',
        title: 'Continue Watching'
    },
    {
        id: 'recommended',
        title: 'Recommended For You'
    }
] as const;

function createSettings(
    overrides: Partial<NativeHomeLayoutPreferences> = {}
): NativeHomeLayoutPreferences {
    return {
        adaptiveRows: true,
        autoReorder: true,
        crossMediaRecommendations: true,
        density: 'comfortable',
        experimentalRecommendations: true,
        heroEnabled: true,
        layoutMode: 'balanced',
        moodRecommendations: true,
        pinnedRows: [],
        recentlyReleasedRows: true,
        rowOrder: [],
        rowVisibility: {},
        seasonalRows: true,
        ...overrides
    };
}

describe('HomeCustomizationDialog', () => {
    let container: HTMLDivElement;
    let root: Root;
    let onClose: ReturnType<typeof vi.fn>;
    let onLayoutChange: ReturnType<typeof vi.fn>;
    let onResetFeedback: ReturnType<typeof vi.fn>;
    let onResetLayout: ReturnType<typeof vi.fn>;
    let onRetrySave: ReturnType<typeof vi.fn>;
    let onUndoFeedback: ReturnType<typeof vi.fn>;

    const renderDialog = ({
        canUndoFeedback = true,
        feedbackCount = 2,
        isSaving = false,
        saveError = '',
        settings = createSettings()
    }: {
        canUndoFeedback?: boolean;
        feedbackCount?: number;
        isSaving?: boolean;
        saveError?: string;
        settings?: NativeHomeLayoutPreferences;
    } = {}) => {
        act(() => root.render(
            <HomeCustomizationDialog
                canUndoFeedback={canUndoFeedback}
                feedbackCount={feedbackCount}
                isSaving={isSaving}
                onClose={onClose}
                onLayoutChange={onLayoutChange}
                onResetFeedback={onResetFeedback}
                onResetLayout={onResetLayout}
                onRetrySave={onRetrySave}
                onUndoFeedback={onUndoFeedback}
                rows={rows}
                saveError={saveError}
                settings={settings}
            />
        ));
    };

    beforeEach(() => {
        setReactActEnvironment(true);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        onClose = vi.fn();
        onLayoutChange = vi.fn();
        onResetFeedback = vi.fn();
        onResetLayout = vi.fn();
        onRetrySave = vi.fn();
        onUndoFeedback = vi.fn();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        setReactActEnvironment(false);
    });

    it('focuses the close button when the dialog opens', () => {
        renderDialog();

        const dialog = container.querySelector<HTMLDialogElement>('dialog');
        const closeButton = container.querySelector<HTMLButtonElement>(
            '[aria-label="Close Home customization"]'
        );

        expect(dialog?.getAttribute('aria-modal')).toBe('true');
        expect(document.activeElement).toBe(closeButton);
    });

    it('closes on Escape from anywhere inside the dialog', () => {
        renderDialog();

        const densityInput = container.querySelector<HTMLInputElement>(
            'input[value="compact"]'
        )!;

        densityInput.focus();
        act(() => {
            densityInput.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Escape'
            }));
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('traps forward and reverse Tab navigation at the dialog boundaries', () => {
        renderDialog();

        const closeButton = container.querySelector<HTMLButtonElement>(
            '[aria-label="Close Home customization"]'
        )!;
        const doneButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
            .find(button => button.textContent === 'Done')!;

        doneButton.focus();
        act(() => {
            doneButton.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Tab'
            }));
        });
        expect(document.activeElement).toBe(closeButton);

        act(() => {
            closeButton.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Tab',
                shiftKey: true
            }));
        });
        expect(document.activeElement).toBe(doneButton);
    });

    it('applies hero, density, row visibility, and row order changes immediately', () => {
        const settings = createSettings();

        renderDialog({ settings });

        const heroToggle = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
            .find(input => input.parentElement?.textContent?.includes('Featured hero'))!;
        const compactDensity = container.querySelector<HTMLInputElement>(
            'input[value="compact"]'
        )!;
        const continueWatchingToggle = container.querySelector<HTMLInputElement>(
            'input[data-row-id="continue-watching"]'
        )!;
        const moveRecommendedUp = container.querySelector<HTMLButtonElement>(
            '[aria-label="Move Recommended For You up"]'
        )!;

        act(() => heroToggle.click());
        expect(onLayoutChange).toHaveBeenLastCalledWith({
            ...settings,
            heroEnabled: false
        });

        act(() => compactDensity.click());
        expect(onLayoutChange).toHaveBeenLastCalledWith({
            ...settings,
            density: 'compact'
        });

        act(() => continueWatchingToggle.click());
        expect(onLayoutChange).toHaveBeenLastCalledWith({
            ...settings,
            rowVisibility: {
                'continue-watching': false
            }
        });

        act(() => moveRecommendedUp.click());
        expect(onLayoutChange).toHaveBeenLastCalledWith({
            ...settings,
            rowOrder: [
                'recommended',
                'continue-watching'
            ]
        });
        expect(onLayoutChange).toHaveBeenCalledTimes(4);
    });

    it('announces saving, saved, and retryable error states without overlapping them', () => {
        renderDialog({
            isSaving: true,
            saveError: 'The profile could not be saved.'
        });

        const getStatus = () => container.querySelector<HTMLElement>('[role="status"]')!;

        expect(getStatus().getAttribute('aria-live')).toBe('polite');
        expect(getStatus().getAttribute('aria-atomic')).toBe('true');
        expect(getStatus().textContent).toBe('Saving changes…');
        expect(getStatus().querySelector('button')).toBeNull();

        renderDialog();
        expect(getStatus().textContent).toBe('Changes saved to this profile.');

        renderDialog({
            saveError: 'The profile could not be saved.'
        });

        const retryButton = [...getStatus().querySelectorAll<HTMLButtonElement>('button')]
            .find(button => button.textContent === 'Try again')!;

        expect(getStatus().textContent).toContain('The profile could not be saved.');
        act(() => retryButton.click());
        expect(onRetrySave).toHaveBeenCalledTimes(1);
    });
});
