import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import type { NativeHomeLayoutPreferences } from './services/homePreferenceService';

import './homeCustomizationDialog.scss';

export type NativeHomeCustomizationRow = Readonly<{
    id: string;
    title: string;
}>;

type HomeCustomizationDialogProps = Readonly<{
    canUndoFeedback: boolean;
    feedbackCount: number;
    isSaving: boolean;
    onClose: () => void;
    onLayoutChange: (layout: NativeHomeLayoutPreferences) => void;
    onResetFeedback: () => void;
    onResetLayout: () => void;
    onRetrySave: () => void;
    onUndoFeedback: () => void;
    rows: readonly NativeHomeCustomizationRow[];
    saveError: string;
    settings: NativeHomeLayoutPreferences;
}>;

function uniqueRows(rows: readonly NativeHomeCustomizationRow[]) {
    const seen = new Set<string>();

    return rows.filter(row => {
        if (!row.id || seen.has(row.id)) return false;

        seen.add(row.id);
        return true;
    });
}

export function orderNativeHomeCustomizationRows(
    rows: readonly NativeHomeCustomizationRow[],
    rowOrder: readonly string[]
) {
    const sourceRows = uniqueRows(rows);
    const rowsById = new Map(sourceRows.map(row => [row.id, row]));

    return [
        ...rowOrder.map(rowId => rowsById.get(rowId)).filter(
            (row): row is NativeHomeCustomizationRow => Boolean(row)
        ),
        ...sourceRows.filter(row => !rowOrder.includes(row.id))
    ];
}

export function moveNativeHomeCustomizationRow(
    rows: readonly NativeHomeCustomizationRow[],
    rowId: string,
    direction: 'down' | 'up'
) {
    const orderedRows = [...rows];
    const currentIndex = orderedRows.findIndex(row => row.id === rowId);

    if (currentIndex < 0) return orderedRows;

    const nextIndex = direction === 'up' ?
        Math.max(0, currentIndex - 1) :
        Math.min(orderedRows.length - 1, currentIndex + 1);

    if (nextIndex === currentIndex) return orderedRows;

    const [row] = orderedRows.splice(currentIndex, 1);

    orderedRows.splice(nextIndex, 0, row);
    return orderedRows;
}

function getFocusableElements(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), '
        + 'textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.hidden);
}

function getFeedbackSummary(feedbackCount: number) {
    if (!feedbackCount) {
        return 'No dismissed recommendations are stored for this profile.';
    }

    const itemLabel = feedbackCount === 1 ? 'item' : 'items';

    return `${feedbackCount} ${itemLabel} currently shape Home.`;
}

export default function HomeCustomizationDialog({
    canUndoFeedback,
    feedbackCount,
    isSaving,
    onClose,
    onLayoutChange,
    onResetFeedback,
    onResetLayout,
    onRetrySave,
    onUndoFeedback,
    rows,
    saveError,
    settings
}: HomeCustomizationDialogProps) {
    const dialogRef = useRef<HTMLDialogElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const orderedRows = useMemo(
        () => orderNativeHomeCustomizationRows(rows, settings.rowOrder),
        [rows, settings.rowOrder]
    );

    useEffect(() => {
        closeButtonRef.current?.focus();
    }, []);

    const handleDialogKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }

        if (event.key !== 'Tab' || !dialogRef.current) return;

        const focusable = getFocusableElements(dialogRef.current);
        const first = focusable[0];
        const last = focusable.at(-1);

        if (!first || !last) return;

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }, [onClose]);
    const updateBoolean = useCallback((
        key: keyof NativeHomeLayoutPreferences,
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        onLayoutChange({
            ...settings,
            [key]: event.currentTarget.checked
        });
    }, [onLayoutChange, settings]);
    const handleHeroEnabledChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        updateBoolean('heroEnabled', event);
    }, [updateBoolean]);
    const handlePersonalizedRowsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        updateBoolean('experimentalRecommendations', event);
    }, [updateBoolean]);
    const handleAdaptiveRowsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        updateBoolean('adaptiveRows', event);
    }, [updateBoolean]);
    const handleDensityChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const density = event.currentTarget.value;

        if (density !== 'compact' && density !== 'comfortable') return;

        onLayoutChange({
            ...settings,
            density
        });
    }, [onLayoutChange, settings]);
    const handleRowVisibilityChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const rowId = event.currentTarget.dataset.rowId || '';

        if (!rowId) return;

        onLayoutChange({
            ...settings,
            rowVisibility: {
                ...settings.rowVisibility,
                [rowId]: event.currentTarget.checked
            }
        });
    }, [onLayoutChange, settings]);
    const moveRow = useCallback((rowId: string, direction: 'down' | 'up') => {
        const nextRows = moveNativeHomeCustomizationRow(orderedRows, rowId, direction);

        onLayoutChange({
            ...settings,
            rowOrder: nextRows.map(row => row.id)
        });
    }, [onLayoutChange, orderedRows, settings]);
    const handleMoveRowClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        const rowId = event.currentTarget.dataset.rowId || '';
        const direction = event.currentTarget.dataset.direction;

        if (!rowId || (direction !== 'up' && direction !== 'down')) return;

        moveRow(rowId, direction);
    }, [moveRow]);

    return (
        <div
            className='ptv-home-customize-backdrop'
            data-ptv-home-customize-backdrop
        >
            <dialog
                ref={dialogRef}
                open
                aria-describedby='ptv-home-customize-description'
                aria-labelledby='ptv-home-customize-title'
                aria-modal='true'
                className='ptv-home-customize-dialog'
                onKeyDown={handleDialogKeyDown}
            >
                <header>
                    <div>
                        <span>Personalize PiggieTV</span>
                        <h2 id='ptv-home-customize-title'>Customize Home</h2>
                        <p id='ptv-home-customize-description'>
                            Changes apply immediately and stay with this server profile.
                        </p>
                    </div>
                    <button
                        ref={closeButtonRef}
                        aria-label='Close Home customization'
                        className='ptv-home-customize-close'
                        onClick={onClose}
                        type='button'
                    >
                        ×
                    </button>
                </header>

                <div className='ptv-home-customize-content'>
                    <fieldset>
                        <legend>Experience</legend>
                        <label
                            aria-label='Show featured hero'
                            className='ptv-home-customize-toggle'
                            htmlFor='ptv-home-hero-enabled'
                        >
                            <input
                                id='ptv-home-hero-enabled'
                                checked={settings.heroEnabled}
                                onChange={handleHeroEnabledChange}
                                type='checkbox'
                            />
                            <span className='ptv-home-customize-toggle-copy'>
                                <strong>Featured hero</strong>
                                <small>Show a rotating, relevant title above your shelves.</small>
                            </span>
                        </label>
                        <label
                            aria-label='Show personalized rows'
                            className='ptv-home-customize-toggle'
                            htmlFor='ptv-home-personalized-rows-enabled'
                        >
                            <input
                                id='ptv-home-personalized-rows-enabled'
                                checked={settings.experimentalRecommendations}
                                onChange={handlePersonalizedRowsChange}
                                type='checkbox'
                            />
                            <span className='ptv-home-customize-toggle-copy'>
                                <strong>Personalized rows</strong>
                                <small>Add recommendations after continuation content is ready.</small>
                            </span>
                        </label>
                        <label
                            aria-label='Use adaptive row ordering'
                            className='ptv-home-customize-toggle'
                            htmlFor='ptv-home-adaptive-rows-enabled'
                        >
                            <input
                                id='ptv-home-adaptive-rows-enabled'
                                checked={settings.adaptiveRows}
                                onChange={handleAdaptiveRowsChange}
                                type='checkbox'
                            />
                            <span className='ptv-home-customize-toggle-copy'>
                                <strong>Adaptive ordering</strong>
                                <small>Prioritize useful shelves while keeping your manual order stable.</small>
                            </span>
                        </label>
                    </fieldset>

                    <fieldset>
                        <legend>Shelf density</legend>
                        <div className='ptv-home-customize-density'>
                            <label htmlFor='ptv-home-density-comfortable'>
                                <input
                                    id='ptv-home-density-comfortable'
                                    checked={settings.density === 'comfortable'}
                                    name='ptv-home-density'
                                    onChange={handleDensityChange}
                                    type='radio'
                                    value='comfortable'
                                />
                                <span>Comfortable</span>
                            </label>
                            <label htmlFor='ptv-home-density-compact'>
                                <input
                                    id='ptv-home-density-compact'
                                    checked={settings.density === 'compact'}
                                    name='ptv-home-density'
                                    onChange={handleDensityChange}
                                    type='radio'
                                    value='compact'
                                />
                                <span>Compact</span>
                            </label>
                        </div>
                    </fieldset>

                    <fieldset>
                        <legend>Rows</legend>
                        <p>Choose what appears and arrange the order used on this profile.</p>
                        <ol className='ptv-home-customize-rows'>
                            {orderedRows.map((row, index) => (
                                <li key={row.id}>
                                    <label htmlFor={`ptv-home-row-visibility-${index}`}>
                                        <input
                                            id={`ptv-home-row-visibility-${index}`}
                                            checked={settings.rowVisibility[row.id] !== false}
                                            data-row-id={row.id}
                                            onChange={handleRowVisibilityChange}
                                            type='checkbox'
                                        />
                                        <span className='ptv-home-customize-row-title'>{row.title}</span>
                                    </label>
                                    <div>
                                        <button
                                            aria-label={`Move ${row.title} up`}
                                            data-direction='up'
                                            data-row-id={row.id}
                                            disabled={index === 0}
                                            onClick={handleMoveRowClick}
                                            type='button'
                                        >
                                            ↑
                                        </button>
                                        <button
                                            aria-label={`Move ${row.title} down`}
                                            data-direction='down'
                                            data-row-id={row.id}
                                            disabled={index === orderedRows.length - 1}
                                            onClick={handleMoveRowClick}
                                            type='button'
                                        >
                                            ↓
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </fieldset>

                    <fieldset>
                        <legend>Recommendation feedback</legend>
                        <p>{getFeedbackSummary(feedbackCount)}</p>
                        <div className='ptv-home-customize-inline-actions'>
                            <button disabled={!canUndoFeedback} onClick={onUndoFeedback} type='button'>
                                Undo last
                            </button>
                            <button disabled={!feedbackCount} onClick={onResetFeedback} type='button'>
                                Reset feedback
                            </button>
                        </div>
                    </fieldset>
                </div>

                <footer>
                    <div aria-atomic='true' aria-live='polite' role='status'>
                        {isSaving ? 'Saving changes…' : null}
                        {!isSaving && saveError ? (
                            <>
                                <span>{saveError}</span>
                                <button onClick={onRetrySave} type='button'>Try again</button>
                            </>
                        ) : null}
                        {!isSaving && !saveError ? 'Changes saved to this profile.' : null}
                    </div>
                    <button onClick={onResetLayout} type='button'>Restore defaults</button>
                    <button className='ptv-home-customize-done' onClick={onClose} type='button'>Done</button>
                </footer>
            </dialog>
        </div>
    );
}
