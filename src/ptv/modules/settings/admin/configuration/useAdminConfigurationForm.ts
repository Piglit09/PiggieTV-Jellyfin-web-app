import { useCallback, useEffect, useMemo, useState } from 'react';

type Equality<T> = (left: T, right: T) => boolean;

/**
 * Keeps edited and confirmed administrator configuration separate. Incoming
 * cache data is adopted while clean and flagged as a conflict while dirty.
 */
export function useAdminConfigurationForm<T extends object>(
    source: T | null,
    equal: Equality<T>
) {
    const [ confirmed, setConfirmed ] = useState<T | null>(null);
    const [ form, setForm ] = useState<T | null>(null);
    const [ serverChanged, setServerChanged ] = useState(false);
    const dirty = useMemo(() => Boolean(
        form && confirmed && !equal(form, confirmed)
    ), [ confirmed, equal, form ]);

    useEffect(() => {
        if (!source) return;
        if (!form || !confirmed) {
            setForm({ ...source });
            setConfirmed({ ...source });
            setServerChanged(false);
            return;
        }
        if (equal(source, confirmed)) {
            setServerChanged(false);
            return;
        }
        if (equal(source, form)) {
            setForm({ ...source });
            setConfirmed({ ...source });
            setServerChanged(false);
            return;
        }
        if (dirty) {
            setServerChanged(true);
            return;
        }
        setForm({ ...source });
        setConfirmed({ ...source });
        setServerChanged(false);
    }, [ confirmed, dirty, equal, form, source ]);

    const update = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
        setForm(current => current ? { ...current, [field]: value } : current);
    }, []);

    const adopt = useCallback((value: T) => {
        setForm({ ...value });
        setConfirmed({ ...value });
        setServerChanged(false);
    }, []);

    const reset = useCallback((latest?: T | null) => {
        const value = latest || confirmed;
        if (!value) return;
        adopt(value);
    }, [ adopt, confirmed ]);

    return {
        adopt,
        confirmed,
        dirty,
        form,
        reset,
        serverChanged,
        setServerChanged,
        update
    } as const;
}
