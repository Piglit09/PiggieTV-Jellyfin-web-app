import React, { useEffect, useRef, useState } from 'react';

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
    placeholderUrl,
    rootMargin = '240px'
}: PtvMusicArtworkProps) {
    const imageRef = useRef<HTMLImageElement>(null);
    const [loadedSource, setLoadedSource] = useState<PtvMusicArtworkSource>(() => ({
        key: imageUrl,
        url: eager ? imageUrl : placeholderUrl
    }));
    let source = placeholderUrl;

    if (loadedSource.key === imageUrl) {
        source = loadedSource.url;
    } else if (eager) {
        source = imageUrl;
    }

    useEffect(() => {
        let disposed = false;
        const loadArtwork = () => {
            if (!disposed) {
                setLoadedSource({
                    key: imageUrl,
                    url: imageUrl || placeholderUrl
                });
            }
        };

        if (eager || !imageUrl || imageUrl === placeholderUrl) {
            loadArtwork();
            return () => {
                disposed = true;
            };
        }

        setLoadedSource({
            key: imageUrl,
            url: placeholderUrl
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
    }, [eager, imageUrl, placeholderUrl, rootMargin]);

    return (
        <img
            ref={imageRef}
            alt={alt}
            className={className}
            decoding='async'
            loading={eager ? 'eager' : 'lazy'}
            src={source}
            onError={onError}
        />
    );
}
