import { createContext, useContext } from 'react';

import type { usePtvAdminNavigation } from './useAdminNavigation';

export type PtvAdminNavigationState = ReturnType<typeof usePtvAdminNavigation>;

export const PtvAdminNavigationContext = createContext<PtvAdminNavigationState | null>(null);

export function usePtvAdminNavigationContext() {
    return useContext(PtvAdminNavigationContext);
}
