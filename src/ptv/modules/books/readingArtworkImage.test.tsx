import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PtvReadingArtworkImage } from './readingArtworkImage';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

describe('PtvReadingArtworkImage', () => {
    let container: HTMLDivElement;
    let root: Root;

    const render = async (props: Partial<React.ComponentPropsWithRef<typeof PtvReadingArtworkImage>> = {}) => {
        await act(async () => root.render(
            <PtvReadingArtworkImage
                alt='Manga cover'
                alternateSrc='/alternate.jpg'
                className='reading-cover'
                data-testid='cover'
                decoding='async'
                generation='tag-1'
                identity='item-1'
                loading='lazy'
                placeholderSrc='/placeholder.svg'
                primarySrc='/primary.jpg'
                {...props}
            />
        ));
    };

    const image = () => container.querySelector<HTMLImageElement>('[data-testid="cover"]')!;

    const dispatch = async (element: HTMLImageElement, type: 'error' | 'load') => {
        await act(async () => element.dispatchEvent(new Event(type, { bubbles: false })));
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

    it('renders standard image attributes and advances through bounded fallbacks', async () => {
        const onError = vi.fn();
        const onCurrentGenerationFailure = vi.fn();

        await render({ onCurrentGenerationFailure, onError });

        expect(image().alt).toBe('Manga cover');
        expect(image().className).toBe('reading-cover');
        expect(image().getAttribute('loading')).toBe('lazy');
        expect(image().getAttribute('src')).toBe('/primary.jpg');

        await dispatch(image(), 'error');
        expect(image().getAttribute('src')).toBe('/alternate.jpg');

        await dispatch(image(), 'error');
        expect(image().getAttribute('src')).toBe('/placeholder.svg');

        await dispatch(image(), 'error');
        await dispatch(image(), 'error');

        expect(image().getAttribute('src')).toBe('/placeholder.svg');
        expect(onError).toHaveBeenCalledTimes(3);
        expect(onCurrentGenerationFailure).toHaveBeenCalledTimes(3);
        expect(onCurrentGenerationFailure.mock.calls[2]?.[0]).toMatchObject({
            source: 'placeholder',
            terminal: true
        });
    });

    it('resets a latched placeholder when artwork generation changes', async () => {
        await render();
        await dispatch(image(), 'error');
        await dispatch(image(), 'error');

        expect(image().getAttribute('src')).toBe('/placeholder.svg');

        await render({
            alternateSrc: '/new-alternate.jpg',
            generation: 'tag-2',
            primarySrc: '/new-primary.jpg'
        });

        expect(image().getAttribute('src')).toBe('/new-primary.jpg');

        await dispatch(image(), 'load');
        expect(image().getAttribute('src')).toBe('/new-primary.jpg');
    });

    it('does not let detached old-generation events alter or report against the new generation', async () => {
        const onCurrentGenerationFailure = vi.fn();
        const onCurrentGenerationSuccess = vi.fn();
        const onError = vi.fn();
        const onLoad = vi.fn();

        await render({ onCurrentGenerationFailure, onCurrentGenerationSuccess, onError, onLoad });
        const oldImage = image();

        await render({
            generation: 'tag-2',
            onCurrentGenerationFailure,
            onCurrentGenerationSuccess,
            onError,
            onLoad,
            primarySrc: '/new-primary.jpg'
        });
        const newImage = image();

        expect(newImage).not.toBe(oldImage);
        expect(newImage.getAttribute('src')).toBe('/new-primary.jpg');

        await dispatch(oldImage, 'error');
        await dispatch(oldImage, 'load');

        expect(image()).toBe(newImage);
        expect(image().getAttribute('src')).toBe('/new-primary.jpg');
        expect(onCurrentGenerationFailure).not.toHaveBeenCalled();
        expect(onCurrentGenerationSuccess).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(onLoad).not.toHaveBeenCalled();

        await dispatch(newImage, 'load');

        expect(onCurrentGenerationSuccess).toHaveBeenCalledTimes(1);
        expect(onLoad).toHaveBeenCalledTimes(1);
        expect(onCurrentGenerationSuccess.mock.calls[0]?.[0]).toMatchObject({
            generation: 'tag-2',
            source: 'primary',
            status: 'loaded',
            terminal: true
        });
    });

    it('resets when item identity changes even if the generation label is reused', async () => {
        await render();
        await dispatch(image(), 'error');

        expect(image().getAttribute('src')).toBe('/alternate.jpg');

        await render({
            generation: 'tag-1',
            identity: 'item-2',
            primarySrc: '/item-2-primary.jpg'
        });

        expect(image().getAttribute('src')).toBe('/item-2-primary.jpg');
    });

    it('uses arbitrary backdrop sources and never revives a failed candidate', async () => {
        const onCurrentGenerationFailure = vi.fn();

        await render({
            generation: 'backdrop-generation-1',
            onCurrentGenerationFailure,
            sources: [
                { kind: 'backdrop', src: '/backdrop.jpg' },
                { kind: 'parent-primary', src: '/parent-primary.jpg' },
                { kind: 'thumb', src: '/thumb.jpg' }
            ]
        });

        expect(image().getAttribute('src')).toBe('/backdrop.jpg');

        await dispatch(image(), 'error');
        expect(image().getAttribute('src')).toBe('/parent-primary.jpg');

        await dispatch(image(), 'error');
        expect(image().getAttribute('src')).toBe('/thumb.jpg');

        await dispatch(image(), 'error');
        expect(image().getAttribute('src')).toBe('/placeholder.svg');
        expect(onCurrentGenerationFailure.mock.calls.map(call => call[0].source)).toEqual([
            'backdrop',
            'parent-primary',
            'thumb'
        ]);
    });

    it('resets a placeholder when Identify changes the Primary image tag generation', async () => {
        await render({
            generation: 'PrimaryImageTag:primary-tag-1',
            sources: [{ kind: 'primary', src: '/primary.jpg?tag=primary-tag-1' }]
        });
        await dispatch(image(), 'error');

        expect(image().getAttribute('src')).toBe('/placeholder.svg');

        await render({
            generation: 'PrimaryImageTag:primary-tag-2',
            sources: [{ kind: 'primary', src: '/primary.jpg?tag=primary-tag-2' }]
        });

        expect(image().getAttribute('src')).toBe('/primary.jpg?tag=primary-tag-2');
    });

    it('resets a placeholder when Identify changes the Backdrop image tag generation', async () => {
        await render({
            generation: 'BackdropImageTags:backdrop-tag-1',
            sources: [{ kind: 'backdrop', src: '/backdrop.jpg?tag=backdrop-tag-1' }]
        });
        await dispatch(image(), 'error');

        expect(image().getAttribute('src')).toBe('/placeholder.svg');

        await render({
            generation: 'BackdropImageTags:backdrop-tag-2',
            sources: [{ kind: 'backdrop', src: '/backdrop.jpg?tag=backdrop-tag-2' }]
        });

        expect(image().getAttribute('src')).toBe('/backdrop.jpg?tag=backdrop-tag-2');
    });

    it('starts clean when the same item is closed and reopened in one session', async () => {
        await render();
        await dispatch(image(), 'error');
        await dispatch(image(), 'error');
        const closedImage = image();

        expect(closedImage.getAttribute('src')).toBe('/placeholder.svg');

        await act(async () => root.render(null));
        expect(container.querySelector('img')).toBeNull();

        await render();
        const reopenedImage = image();

        expect(reopenedImage).not.toBe(closedImage);
        expect(reopenedImage.getAttribute('src')).toBe('/primary.jpg');

        await dispatch(closedImage, 'error');
        expect(image()).toBe(reopenedImage);
        expect(image().getAttribute('src')).toBe('/primary.jpg');
    });

    it('starts clean after a navigation-style full root unmount and remount', async () => {
        await render({
            generation: 'BackdropImageTags:stable-tag',
            identity: 'reading:backdrop:item-1',
            sources: [{ kind: 'backdrop', src: '/backdrop.jpg?tag=stable-tag' }]
        });
        await dispatch(image(), 'error');
        const navigatedAwayImage = image();

        expect(navigatedAwayImage.getAttribute('src')).toBe('/placeholder.svg');

        await act(async () => root.unmount());
        root = createRoot(container);

        await render({
            generation: 'BackdropImageTags:stable-tag',
            identity: 'reading:backdrop:item-1',
            sources: [{ kind: 'backdrop', src: '/backdrop.jpg?tag=stable-tag' }]
        });
        const remountedImage = image();

        expect(remountedImage).not.toBe(navigatedAwayImage);
        expect(remountedImage.getAttribute('src')).toBe('/backdrop.jpg?tag=stable-tag');

        await dispatch(navigatedAwayImage, 'error');
        expect(image()).toBe(remountedImage);
        expect(image().getAttribute('src')).toBe('/backdrop.jpg?tag=stable-tag');
    });

    it('forwards refs to only the active generation image', async () => {
        const imageRef = React.createRef<HTMLImageElement>();

        await render({ ref: imageRef });
        const firstImage = image();

        expect(imageRef.current).toBe(firstImage);

        await render({ generation: 'tag-2', primarySrc: '/new-primary.jpg', ref: imageRef });

        expect(imageRef.current).toBe(image());
        expect(imageRef.current).not.toBe(firstImage);
    });
});
