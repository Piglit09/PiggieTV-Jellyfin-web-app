import { useEffect } from 'react';
import { unstable_usePrompt as usePrompt } from 'react-router-dom';

/** Applies the shared PiggieTV administrator dirty-form navigation policy. */
export function useAdminUnsavedChanges(
    dirty: boolean,
    message: string,
    promptWhen = dirty
) {
    usePrompt({ message, when: promptWhen });

    useEffect(() => {
        if (!dirty) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- required for legacy browser unload prompts.
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [ dirty ]);
}
