import React, { useEffect, useRef, useState } from 'react';

import { PTV_ASSETS } from '../core/config';
import { recordPtvEvent } from '../core/observability';
import { resolvePtvStaticAssetUrl } from '../core/urlOrigins';

const PTV_SHELL_FALLBACK_BACKDROP_URL = resolvePtvStaticAssetUrl(PTV_ASSETS.backgrounds.page);

let shellBackdropInstanceSequence = 0;

export default function PTVShellBackdrop({
    source,
    url
}: Readonly<{
    source?: string;
    url?: string;
}>) {
    const resolvedUrl = url || PTV_SHELL_FALLBACK_BACKDROP_URL;
    const [currentUrl, setCurrentUrl] = useState(resolvedUrl);
    const [previousUrl, setPreviousUrl] = useState('');
    const [isCurrentVisible, setCurrentVisible] = useState(Boolean(resolvedUrl));
    const [isPreviousVisible, setPreviousVisible] = useState(false);
    const mountEventRecordedRef = useRef(false);
    const shellInstanceIdRef = useRef('');

    if (!shellInstanceIdRef.current) {
        shellBackdropInstanceSequence += 1;
        shellInstanceIdRef.current = `shell-${shellBackdropInstanceSequence}`;
    }

    const initialMountEventRef = useRef({
        actualComponentMount: true,
        activeBackdropSource: source || 'fallback',
        backdropActive: Boolean(resolvedUrl),
        shellInstanceId: shellInstanceIdRef.current
    });

    useEffect(() => {
        if (!resolvedUrl || resolvedUrl === currentUrl) return undefined;

        const startedAt = performance.now();
        let cancelled = false;
        const image = new Image();

        image.decoding = 'async';
        image.onload = () => {
            if (cancelled) return;

            setPreviousUrl(currentUrl);
            setPreviousVisible(Boolean(currentUrl));
            setCurrentUrl(resolvedUrl);
            setCurrentVisible(false);

            const frame = window.requestAnimationFrame(() => {
                setPreviousVisible(false);
                setCurrentVisible(true);
            });
            const timeout = window.setTimeout(() => {
                setPreviousUrl('');
            }, 900);

            recordPtvEvent('render', 'ptv-shell-backdrop-loaded', {
                activeBackdropSource: source || 'unknown',
                backdropCacheHit: performance.now() - startedAt < 10,
                backdropLoadMs: Number((performance.now() - startedAt).toFixed(1))
            });

            window.setTimeout(() => {
                window.cancelAnimationFrame(frame);
                window.clearTimeout(timeout);
            }, 950);
        };
        image.onerror = () => {
            if (cancelled) return;

            recordPtvEvent('render', 'ptv-shell-backdrop-failed', {
                activeBackdropSource: source || 'unknown',
                fallbackUrl: PTV_SHELL_FALLBACK_BACKDROP_URL,
                requestedUrl: resolvedUrl
            });
        };
        image.src = resolvedUrl;

        return () => {
            cancelled = true;
        };
    }, [currentUrl, resolvedUrl, source]);

    useEffect(() => {
        if (mountEventRecordedRef.current) return;

        mountEventRecordedRef.current = true;
        recordPtvEvent('route', 'ptv-shell-mounted', initialMountEventRef.current);
    }, []);

    return (
        <div className='ptv-shell-backdrop' aria-hidden='true' data-ptv-shell-backdrop-source={source || 'fallback'}>
            {previousUrl ? (
                <img
                    alt=''
                    className={`ptv-shell-backdrop-image ptv-shell-backdrop-image-previous${isPreviousVisible ? ' is-visible' : ''}`}
                    decoding='async'
                    src={previousUrl}
                />
            ) : null}
            {currentUrl ? (
                <img
                    alt=''
                    className={`ptv-shell-backdrop-image ptv-shell-backdrop-image-current${isCurrentVisible ? ' is-visible' : ''}`}
                    decoding='async'
                    src={currentUrl}
                />
            ) : null}
            <div className='ptv-shell-backdrop-overlay' />
            <div className='ptv-shell-noise' />
        </div>
    );
}

