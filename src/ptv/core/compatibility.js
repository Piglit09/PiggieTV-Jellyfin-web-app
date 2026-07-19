import { applyPtvClientProfileClasses } from './clientProfile';
import { syncPtvTvFocusEngine } from './tvFocus';

syncPtvTvFocusEngine(applyPtvClientProfileClasses());

if (typeof window !== 'undefined') {
    let ptvProfileRefreshTimer = 0;
    const refreshPtvClientProfile = () => {
        window.clearTimeout(ptvProfileRefreshTimer);
        ptvProfileRefreshTimer = window.setTimeout(() => {
            syncPtvTvFocusEngine(applyPtvClientProfileClasses());
        }, 120);
    };

    window.addEventListener('resize', refreshPtvClientProfile, { passive: true });
    window.addEventListener('orientationchange', refreshPtvClientProfile, { passive: true });
    window.visualViewport?.addEventListener('resize', refreshPtvClientProfile, { passive: true });
}
