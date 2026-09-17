import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    loadPtvMusicArtworkSource,
    markPtvMusicArtworkSourceFailed
} from './musicArtworkSourceCoordinator';

type PtvMusicArtworkSource = Readonly<{
    key: string;
    url: string;
}>;

export type PtvMusicArtworkProps = Readonly<{
    alt?: string;
    className?: string;
    eager?: boolean;
    imageUrl: string;
    onError?: React.ReactEventHandler<HTMLImageElement>;
    onSourceFailure?: (url: string) => void;
    placeholderUrl: string;
    rootMargin?: string;
}>;

/**
 * Keeps a stable image element in every card while only assigning the real
 * artwork URL when the card is in (or near) the viewport. This intentionally
 * does not own a cache; URL creation and failure state remain with Music's
 * existing image pipeline.
 */
export default function PtvMusicArtwork({
    alt = '',
    className,
    eager = false,
    imageUrl,
    onError,
    onSourceFailure,
    placeholderUrl,
    rootMargin = '240px'
}: PtvMusicArtworkProps) {
    const imageRef = useRef<HTMLImageElement>(null);
    const [loadedSource, setLoadedSource] = useState<PtvMusicArtworkSource>(() => ({
        key: imageUrl,
        url: imageUrl === placeholderUrl ? placeholderUrl : ''
    }));
    let source = '';

    if (loadedSource.key === imageUrl) {
        source = loadedSource.url;
    }

    useEffect(() => {
        let disposed = false;
        const loadArtwork = () => {
            if (disposed) return;

            if (!imageUrl || imageUrl === placeholderUrl) {
                setLoadedSource({ key: imageUrl, url: placeholderUrl });
                return;
            }

            void loadPtvMusicArtworkSource(imageUrl, onSourceFailure).then(loaded => {
                if (disposed) return;

                setLoadedSource({
                    key: imageUrl,
                    url: loaded ? imageUrl : ''
                });
            });
        };

        if (eager || !imageUrl || imageUrl === placeholderUrl) {
            loadArtwork();
            return () => {
                disposed = true;
            };
        }

        setLoadedSource({
            key: imageUrl,
            url: ''
        });

        if (typeof IntersectionObserver === 'undefined' || !imageRef.current) {
            loadArtwork();
            return () => {
                disposed = true;
            };
        }

        const observer = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;

            loadArtwork();
            observer.disconnect();
        }, {
            rootMargin
        });

        observer.observe(imageRef.current);

        return () => {
            disposed = true;
            observer.disconnect();
        };
    }, [eager, imageUrl, onSourceFailure, placeholderUrl, rootMargin]);

    const handleError = useCallback<React.ReactEventHandler<HTMLImageElement>>(event => {
        markPtvMusicArtworkSourceFailed(imageUrl, onSourceFailure);
        setLoadedSource({ key: imageUrl, url: '' });
        onError?.(event);
    }, [imageUrl, onError, onSourceFailure]);
    const deferredStyle = source ? undefined : {
        backgroundImage: `url("${placeholderUrl.split('"').join('%22')}")`,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover'
    };

    return (
        <img
            ref={imageRef}
            alt={alt}
            className={className}
            decoding='async'
            data-ptv-artwork-deferred={source ? undefined : 'true'}
            loading={eager ? 'eager' : 'lazy'}
            src={source || undefined}
            style={deferredStyle}
            onError={handleError}
        />
    );
}
