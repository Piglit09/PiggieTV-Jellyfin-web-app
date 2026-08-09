import { QueryClientProvider } from '@tanstack/react-query';
import React, { lazy, Suspense } from 'react';

import { ApiProvider } from 'hooks/useApi';
import { UserSettingsProvider } from 'hooks/useUserSettings';
import { WebConfigProvider } from 'hooks/useWebConfig';
import browser from 'scripts/browser';
import { queryClient } from 'utils/query/queryClient';

import RootAppRouter from 'RootAppRouter';

const ReactQueryDevtools = lazy(async () => {
    const module = await import('@tanstack/react-query-devtools');

    return { default: module.ReactQueryDevtools };
});

const useReactQueryDevtools = process.env.NODE_ENV !== 'production'
    && window.Proxy // '@tanstack/query-devtools' requires 'Proxy', which cannot be polyfilled for legacy browsers
    && !browser.tv; // Don't use devtools on the TV as the navigation is weird

const RootApp = () => (
    <QueryClientProvider client={queryClient}>
        <ApiProvider>
            <UserSettingsProvider>
                <WebConfigProvider>
                    <RootAppRouter />
                </WebConfigProvider>
            </UserSettingsProvider>
        </ApiProvider>
        {useReactQueryDevtools && (
            <Suspense fallback={null}>
                <ReactQueryDevtools initialIsOpen={false} />
            </Suspense>
        )}
    </QueryClientProvider>
);

export default RootApp;
