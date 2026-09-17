import React, {
    forwardRef,
    useCallback,
    useRef,
    useState,
    type ImgHTMLAttributes,
    type MutableRefObject,
    type Ref,
    type SyntheticEvent
} from 'react';

import {
    createPtvReadingArtworkLifecycle,
    getPtvReadingArtworkActiveSource,
    transitionPtvReadingArtworkLifecycle,
    type PtvReadingArtworkGeneration,
    type PtvReadingArtworkLifecycleOutcome,
    type PtvReadingArtworkLifecycleState,
    type PtvReadingArtworkSource
} from './readingArtworkLifecycle';

export type PtvReadingArtworkImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & Readonly<{
    alternateSrc?: null | string;
    generation: PtvReadingArtworkGeneration;
    identity: string;
    onCurrentGenerationFailure?: (
        outcome: PtvReadingArtworkLifecycleOutcome,
        event: SyntheticEvent<HTMLImageElement>
    ) => void;
    onCurrentGenerationSuccess?: (
        outcome: PtvReadingArtworkLifecycleOutcome,
        event: SyntheticEvent<HTMLImageElement>
    ) => void;
    placeholderSrc: string;
    primarySrc?: null | string;
    sources?: readonly PtvReadingArtworkSource[];
}>;

type PtvReadingArtworkGenerationImageProps = Omit<
    PtvReadingArtworkImageProps,
    'alternateSrc' | 'generation' | 'identity' | 'placeholderSrc' | 'primarySrc' | 'sources'
> & Readonly<{
    activeImageRef: MutableRefObject<HTMLImageElement | null>;
    imageRef: Ref<HTMLImageElement>;
    initialLifecycle: PtvReadingArtworkLifecycleState;
}>;

function setRefValue<T>(ref: Ref<T> | undefined, value: T | null) {
    if (typeof ref === 'function') {
        ref(value);
    } else if (ref) {
        (ref as MutableRefObject<T | null>).current = value;
    }
}

function PtvReadingArtworkGenerationImage({
    activeImageRef,
    alt = '',
    imageRef,
    initialLifecycle,
    onCurrentGenerationFailure,
    onCurrentGenerationSuccess,
    onError,
    onLoad,
    ...imageProps
}: PtvReadingArtworkGenerationImageProps) {
    const [ lifecycle, setLifecycle ] = useState(initialLifecycle);
    const lifecycleRef = useRef(lifecycle);
    const activeSource = getPtvReadingArtworkActiveSource(lifecycle);
    const { attemptKey, lifecycleKey } = lifecycle;

    lifecycleRef.current = lifecycle;

    const settle = useCallback((
        type: 'error' | 'load',
        event: SyntheticEvent<HTMLImageElement>
    ) => {
        const currentLifecycle = lifecycleRef.current;

        if (activeImageRef.current !== event.currentTarget) return;

        const transition = transitionPtvReadingArtworkLifecycle(currentLifecycle, {
            attemptKey,
            lifecycleKey,
            type
        });

        if (!transition.accepted || !transition.outcome) return;

        lifecycleRef.current = transition.state;
        setLifecycle(transition.state);

        if (type === 'load') {
            onLoad?.(event);
            onCurrentGenerationSuccess?.(transition.outcome, event);
        } else {
            onError?.(event);
            onCurrentGenerationFailure?.(transition.outcome, event);
        }
    }, [
        activeImageRef,
        attemptKey,
        lifecycleKey,
        onCurrentGenerationFailure,
        onCurrentGenerationSuccess,
        onError,
        onLoad
    ]);
    const handleError = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
        settle('error', event);
    }, [ settle ]);
    const handleLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
        settle('load', event);
    }, [ settle ]);

    return (
        <img
            {...imageProps}
            alt={alt}
            key={lifecycle.attemptKey}
            ref={imageRef}
            src={activeSource.src}
            onError={handleError}
            onLoad={handleLoad}
        />
    );
}

export const PtvReadingArtworkImage = forwardRef<HTMLImageElement, PtvReadingArtworkImageProps>(
    function PtvReadingArtworkImage({
        alternateSrc,
        generation,
        identity,
        placeholderSrc,
        primarySrc,
        sources,
        ...imageProps
    }, forwardedRef) {
        const initialLifecycle = createPtvReadingArtworkLifecycle({
            alternateSrc,
            generation,
            identity,
            placeholderSrc,
            primarySrc,
            sources
        });
        const activeImageRef = useRef<HTMLImageElement | null>(null);
        const setImageRef = useCallback((node: HTMLImageElement | null) => {
            activeImageRef.current = node;
            setRefValue(forwardedRef, node);
        }, [ forwardedRef ]);

        return (
            <PtvReadingArtworkGenerationImage
                {...imageProps}
                key={initialLifecycle.lifecycleKey}
                activeImageRef={activeImageRef}
                imageRef={setImageRef}
                initialLifecycle={initialLifecycle}
            />
        );
    }
);
