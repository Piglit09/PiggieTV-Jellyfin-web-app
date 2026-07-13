import { applyPtvClientProfileClasses } from './clientProfile';

applyPtvClientProfileClasses();

if (typeof window !== 'undefined') {
    let ptvProfileRefreshTimer = 0;
    const refreshPtvClientProfile = () => {
        window.clearTimeout(ptvProfileRefreshTimer);
        ptvProfileRefreshTimer = window.setTimeout(() => {
            applyPtvClientProfileClasses();
        }, 120);
    };

    window.addEventListener('resize', refreshPtvClientProfile, { passive: true });
    window.addEventListener('orientationchange', refreshPtvClientProfile, { passive: true });
    window.visualViewport?.addEventListener('resize', refreshPtvClientProfile, { passive: true });
}
