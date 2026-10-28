import { useCallback, useRef, useState } from 'react';

/** Library-page view state, extracted from NativeBrowsePage. */
export function usePtvBrowseBackdrop(scopeKey: string, available: boolean) {
    const current = useRef({ scopeKey, available, revision: 0 });
    if (current.current.scopeKey !== scopeKey || current.current.available !== available) {
        current.current = { scopeKey, available, revision: current.current.revision + 1 };
    }
    const owner = current.current;
    const [captured, setCaptured] = useState({ owner, url: '' });
    const setBackdropUrl = useCallback((url: string) => {
        if (current.current !== owner || !owner.available) return;
        setCaptured(previous => previous.owner === owner && previous.url === url ? previous : { owner, url });
    }, [owner]);
    return {
        backdropUrl: available && captured.owner === owner ? captured.url : '',
        // Retire the shell's retained/crossfade image too, not just its URL prop.
        backdropPresentationKey: `${scopeKey}:${owner.revision}`,
        setBackdropUrl
    };
}
