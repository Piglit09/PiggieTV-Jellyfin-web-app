import React, { type FC, type PropsWithChildren, createContext, useContext, useEffect, useState } from 'react';

import type { WebConfig } from '../types/webConfig';
import defaultConfig from '../config.json';
import { getWebConfig, subscribeWebConfig } from '../scripts/settings/webSettings';

export const WebConfigContext = createContext<WebConfig>(defaultConfig);
export const useWebConfig = () => useContext(WebConfigContext);

export const WebConfigProvider: FC<PropsWithChildren<unknown>> = ({ children }) => {
    const [ config, setConfig ] = useState<WebConfig>(defaultConfig);

    useEffect(() => {
        let active = true;
        let appliedConfig: WebConfig = defaultConfig;
        const updateConfig = (configData: WebConfig) => {
            if (active && configData !== appliedConfig) {
                appliedConfig = configData;
                setConfig(configData);
            }
        };
        const unsubscribe = subscribeWebConfig(updateConfig);

        getWebConfig()
            .then(updateConfig)
            .catch((err: unknown) => {
                console.warn('[WebConfigProvider] failed to fetch config file', err);
            });

        return () => {
            active = false;
            unsubscribe();
        };
    }, [ setConfig ]);

    return (
        <WebConfigContext.Provider value={config}>
            {children}
        </WebConfigContext.Provider>
    );
};
