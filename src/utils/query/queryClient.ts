import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { sanitizePtvSdkTransportError } from '../jellyfin-apiclient/compat';

export const queryClient = new QueryClient({
    mutationCache: new MutationCache({
        onError: error => {
            sanitizePtvSdkTransportError(error);
        }
    }),
    queryCache: new QueryCache({
        onError: error => {
            sanitizePtvSdkTransportError(error);
        }
    }),
    defaultOptions: {
        mutations: {
            networkMode: 'always' // network connection is not required if running on localhost
        },
        queries: {
            networkMode: 'always' // network connection is not required if running on localhost
        }
    }
});
