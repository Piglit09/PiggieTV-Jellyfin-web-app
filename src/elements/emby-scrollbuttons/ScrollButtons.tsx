import React, { type FC, useCallback, useEffect, useRef, useState } from 'react';
import scrollerFactory from 'lib/scroller';
import globalize from 'lib/globalize';
import './emby-scrollbuttons.scss';
import { ScrollDirection, scrollerItemSlideIntoView } from './utils';

interface ScrollButtonsProps {
    scrollerFactoryRef: React.MutableRefObject<scrollerFactory | null>;
    scrollState: {
        scrollSize: number;
        scrollPos: number;
        scrollWidth: number;
    }
}

const ScrollButtons: FC<ScrollButtonsProps> = ({ scrollerFactoryRef, scrollState }) => {
    const [localeScrollPos, setLocaleScrollPos] = useState<number>(0);
    const scrollButtonsRef = useRef<HTMLDivElement>(null);

    const onScrollButtonClick = useCallback((direction: ScrollDirection) => {
        scrollerItemSlideIntoView({
            direction,
            scroller: scrollerFactoryRef.current,
            scrollState
        });
    }, [scrollState, scrollerFactoryRef]);

    const triggerScrollLeft = useCallback(() => onScrollButtonClick(ScrollDirection.LEFT), [ onScrollButtonClick ]);
    const triggerScrollRight = useCallback(() => onScrollButtonClick(ScrollDirection.RIGHT), [ onScrollButtonClick ]);
    const previousTitle = globalize.translate('Previous');
    const nextTitle = globalize.translate('Next');

    useEffect(() => {
        const parent = scrollButtonsRef.current?.parentNode as HTMLDivElement;
        parent.classList.add('emby-scroller-container');

        let localeAwarePos = scrollState.scrollPos;
        if (globalize.getIsElementRTL(scrollButtonsRef.current)) {
            localeAwarePos *= -1;
        }
        setLocaleScrollPos(localeAwarePos);
    }, [scrollState.scrollPos]);

    return (
        <div ref={scrollButtonsRef} className='emby-scrollbuttons padded-right'>

            <button
                type='button'
                className='emby-scrollbuttons-button btnPrev'
                title={previousTitle}
                onClick={triggerScrollLeft}
                disabled={localeScrollPos <= 0}
            >
                <span className='ptv-scroll-icon ptv-scroll-icon-left' aria-hidden='true' />
            </button>

            <button
                type='button'
                className='emby-scrollbuttons-button btnNext'
                title={nextTitle}
                onClick={triggerScrollRight}
                disabled={scrollState.scrollWidth > 0 && localeScrollPos + scrollState.scrollSize >= scrollState.scrollWidth}
            >
                <span className='ptv-scroll-icon ptv-scroll-icon-right' aria-hidden='true' />
            </button>
        </div>
    );
};

export default ScrollButtons;
