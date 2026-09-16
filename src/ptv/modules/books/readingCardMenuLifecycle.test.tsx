/* eslint-disable react/jsx-no-bind */
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReadingCardMenu, ReadingCardMenuOwner } from './readingCardMenuLifecycle';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

type ReadingKind = 'Book' | 'Comic' | 'Manga';

type MenuFixtureProps = Readonly<{
    contentVersion?: unknown;
    kinds?: readonly ReadingKind[];
    onAction?: (kind: ReadingKind, menuWasOpen: boolean) => void;
    onLink?: (kind: ReadingKind, menuWasOpen: boolean) => void;
    routeKey?: string;
    showMenus?: boolean;
}>;

const DEFAULT_KINDS: readonly ReadingKind[] = [ 'Book', 'Comic', 'Manga' ];

function getMenuEntries(kinds: readonly ReadingKind[]) {
    const counts: Partial<Record<ReadingKind, number>> = {};

    return kinds.map(kind => {
        const occurrence = (counts[kind] || 0) + 1;

        counts[kind] = occurrence;
        return {
            id: `${kind}-${occurrence}`,
            kind
        };
    });
}

function MenuFixture({
    contentVersion = 1,
    kinds = DEFAULT_KINDS,
    onAction = () => undefined,
    onLink = () => undefined,
    routeKey = 'reading:library',
    showMenus = true
}: MenuFixtureProps) {
    const [ modalKind, setModalKind ] = useState<ReadingKind | null>(null);

    return (
        <ReadingCardMenuOwner contentVersion={contentVersion} routeKey={routeKey}>
            <button type='button' data-testid='outside'>Outside</button>
            {showMenus ? getMenuEntries(kinds).map(({ id, kind }) => (
                <article key={id} data-kind={kind}>
                    <ReadingCardMenu
                        label={`More actions for ${id}`}
                        trigger={<span aria-hidden='true'>More</span>}
                    >
                        <a
                            href={`#/${kind.toLowerCase()}`}
                            role='menuitem'
                            onClick={event => {
                                event.preventDefault();
                                const menu = event.currentTarget.closest('details');

                                onLink(kind, Boolean(menu?.open));
                            }}
                        >
                            Open
                        </a>
                        <button
                            type='button'
                            role='menuitem'
                            onClick={event => {
                                const menu = event.currentTarget.closest('details');

                                onAction(kind, Boolean(menu?.open));
                                setModalKind(kind);
                            }}
                        >
                            Identify
                        </button>
                    </ReadingCardMenu>
                </article>
            )) : null}
            {modalKind ? (
                <div role='dialog' aria-label={`Identify ${modalKind}`}>
                    <button type='button' onClick={() => setModalKind(null)}>Close dialog</button>
                </div>
            ) : null}
        </ReadingCardMenuOwner>
    );
}

function getArticle(container: HTMLElement, kind: ReadingKind, index = 0) {
    return Array.from(container.querySelectorAll<HTMLElement>(`[data-kind="${kind}"]`))[index]!;
}

function getDetails(container: HTMLElement, kind: ReadingKind, index = 0) {
    return getArticle(container, kind, index).querySelector<HTMLDetailsElement>('details')!;
}

function getSummary(container: HTMLElement, kind: ReadingKind, index = 0) {
    return getArticle(container, kind, index).querySelector<HTMLElement>('summary')!;
}

async function click(element: HTMLElement) {
    await act(async () => element.click());
}

describe('Reading card menu lifecycle', () => {
    let container: HTMLDivElement;
    let root: Root;

    const render = async (props: MenuFixtureProps = {}) => {
        await act(async () => root.render(<MenuFixture {...props} />));
    };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
    });

    it.each(DEFAULT_KINDS)('closes the %s menu before an action opens its dialog', async kind => {
        const onAction = vi.fn();

        await render({ kinds: [ kind ], onAction });
        const details = getDetails(container, kind);
        const summary = getSummary(container, kind);

        await click(summary);

        expect(details.open).toBe(true);
        expect(summary.getAttribute('aria-expanded')).toBe('true');
        expect(details.querySelector('[role="menu"]')).not.toBeNull();
        expect(document.activeElement?.getAttribute('role')).toBe('menuitem');

        await click(details.querySelector<HTMLButtonElement>('[role="menuitem"]:last-child')!);

        expect(onAction).toHaveBeenCalledWith(kind, false);
        expect(details.open).toBe(false);
        expect(summary.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(summary);
        expect(container.querySelector(`[role="dialog"][aria-label="Identify ${kind}"]`)).not.toBeNull();

        await click(container.querySelector<HTMLButtonElement>('[role="dialog"] button')!);

        expect(details.open).toBe(false);
    });

    it('closes links synchronously before their navigation handler', async () => {
        const onLink = vi.fn();

        await render({ kinds: [ 'Book' ], onLink });
        const details = getDetails(container, 'Book');

        await click(getSummary(container, 'Book'));
        await click(details.querySelector<HTMLAnchorElement>('[role="menuitem"]')!);

        expect(onLink).toHaveBeenCalledWith('Book', false);
        expect(details.open).toBe(false);
    });

    it('dismisses on outside pointer interaction without stealing outside focus', async () => {
        await render({ kinds: [ 'Book' ] });
        const details = getDetails(container, 'Book');
        const outside = container.querySelector<HTMLButtonElement>('[data-testid="outside"]')!;

        await click(getSummary(container, 'Book'));
        await act(async () => {
            outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
            outside.focus();
        });

        expect(details.open).toBe(false);
        expect(document.activeElement).toBe(outside);
    });

    it('dismisses on Escape and restores focus to the originating trigger', async () => {
        await render({ kinds: [ 'Book' ] });
        const details = getDetails(container, 'Book');
        const summary = getSummary(container, 'Book');

        await click(summary);
        await act(async () => {
            document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                key: 'Escape'
            }));
        });

        expect(details.open).toBe(false);
        expect(document.activeElement).toBe(summary);
    });

    it('allows only one card instance to own an open menu, even with duplicate labels', async () => {
        await render({ kinds: [ 'Book', 'Book' ] });
        const first = getDetails(container, 'Book', 0);
        const second = getDetails(container, 'Book', 1);
        const firstTriggerId = getSummary(container, 'Book', 0).id;
        const secondTriggerId = getSummary(container, 'Book', 1).id;

        expect(firstTriggerId).not.toBe(secondTriggerId);

        await click(getSummary(container, 'Book', 0));
        expect(first.open).toBe(true);

        await click(getSummary(container, 'Book', 1));

        expect(first.open).toBe(false);
        expect(second.open).toBe(true);
        expect(container.querySelectorAll('details[open]')).toHaveLength(1);
    });

    it('retires an open menu on route changes and same-card authoritative refetches', async () => {
        await render({ contentVersion: 1, kinds: [ 'Book' ], routeKey: 'books:library' });
        const details = getDetails(container, 'Book');

        await click(getSummary(container, 'Book'));
        expect(details.open).toBe(true);

        await render({ contentVersion: 1, kinds: [ 'Book' ], routeKey: 'comics:library' });
        expect(getDetails(container, 'Book').open).toBe(false);

        await click(getSummary(container, 'Book'));
        await render({ contentVersion: 2, kinds: [ 'Book' ], routeKey: 'comics:library' });

        expect(getDetails(container, 'Book').open).toBe(false);
        expect(document.activeElement).toBe(getSummary(container, 'Book'));
    });

    it('retires a surviving card menu when search results are replaced', async () => {
        const firstSearchResults = [{ Id: 'Book-1', Name: 'Before readback' }];
        const refreshedSearchResults = [{ Id: 'Book-1', Name: 'After readback' }];

        await render({
            contentVersion: firstSearchResults,
            kinds: [ 'Book' ],
            routeKey: 'books:explore:search'
        });
        await click(getSummary(container, 'Book'));

        expect(getDetails(container, 'Book').open).toBe(true);

        await render({
            contentVersion: refreshedSearchResults,
            kinds: [ 'Book' ],
            routeKey: 'books:explore:search'
        });

        expect(getDetails(container, 'Book').open).toBe(false);
        expect(document.activeElement).toBe(getSummary(container, 'Book'));
    });

    it('disposes card ownership and the one active listener pair on unmount', async () => {
        const addListener = vi.spyOn(document, 'addEventListener');
        const removeListener = vi.spyOn(document, 'removeEventListener');

        await render({ kinds: [ 'Book' ] });
        await click(getSummary(container, 'Book'));

        const pointerAdds = addListener.mock.calls.filter(([eventName]) => eventName === 'pointerdown');
        const keyAdds = addListener.mock.calls.filter(([eventName]) => eventName === 'keydown');

        expect(pointerAdds).toHaveLength(1);
        expect(keyAdds).toHaveLength(1);

        await render({ kinds: [ 'Book' ], showMenus: false });

        expect(container.querySelector('details')).toBeNull();
        expect(removeListener.mock.calls.filter(([eventName]) => eventName === 'pointerdown')).toHaveLength(1);
        expect(removeListener.mock.calls.filter(([eventName]) => eventName === 'keydown')).toHaveLength(1);
    });
});

/* eslint-enable react/jsx-no-bind */
