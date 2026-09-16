/* eslint-disable react/jsx-no-bind */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PtvReadingItem } from './booksTypes';
import { usePtvReadingGridVisibleLimit } from './readingGridLifecycle';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

function item(id: string, name = id): PtvReadingItem {
    return {
        Id: id,
        Name: name,
        ServerId: 'server-one',
        Type: 'Book'
    };
}

function GridWindowFixture({ items, routeKey }: Readonly<{
    items: PtvReadingItem[];
    routeKey: string;
}>) {
    const [ visibleLimit, setVisibleLimit ] = usePtvReadingGridVisibleLimit(items, routeKey, 2);

    return (
        <button type='button' onClick={() => setVisibleLimit(limit => limit + 2)}>
            {visibleLimit}
        </button>
    );
}

describe('Reading grid visible window lifecycle', () => {
    let container: HTMLDivElement;
    let root: Root;

    const render = async (items: PtvReadingItem[], routeKey = 'books:library') => {
        await act(async () => root.render(<GridWindowFixture items={items} routeKey={routeKey} />));
    };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('preserves an expanded grid when metadata replaces one item with the same identity', async () => {
        const initialItems = [ item('book-1'), item('book-2'), item('book-3'), item('book-4') ];

        await render(initialItems);
        const button = container.querySelector<HTMLButtonElement>('button')!;
        await act(async () => button.click());
        expect(button.textContent).toBe('4');

        await render([
            item('book-1', 'Server-normalized title'),
            initialItems[1],
            initialItems[2],
            initialItems[3]
        ]);

        expect(button.textContent).toBe('4');
    });

    it('resets the window for a different dataset or route', async () => {
        const initialItems = [ item('book-1'), item('book-2'), item('book-3'), item('book-4') ];

        await render(initialItems);
        const button = container.querySelector<HTMLButtonElement>('button')!;
        await act(async () => button.click());
        expect(button.textContent).toBe('4');

        await render([ item('book-1'), item('book-2'), item('book-5') ]);
        expect(button.textContent).toBe('2');

        await act(async () => button.click());
        await render([ item('book-1'), item('book-2'), item('book-5') ], 'comics:library');
        expect(button.textContent).toBe('2');
    });
});

/* eslint-enable react/jsx-no-bind */
