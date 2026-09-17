export declare global {
    import { ApiClient, Events } from 'jellyfin-apiclient';

    interface Window {
        ApiClient: ApiClient;
        Events: Events;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        NativeShell: any;
        Loading: {
            show();
            hide();
        }
    }

    interface DocumentEventMap {
        'viewshow': CustomEvent;
    }

    const __COMMIT_SHA__: string;
    const __JF_BUILD_VERSION__: string;
    const __PACKAGE_JSON_NAME__: string;
    const __PACKAGE_JSON_VERSION__: string;
    const __PTV_ACCEPTANCE_LEDGER__: boolean;
    const __PTV_BUILD_DATE__: string;
    const __PTV_BUILD_ID__: string;
    const __PTV_BUILD_MODE__: 'development' | 'production';
    const __PTV_DEV_JELLYFIN_URL__: string;
    const __PTV_VERSION__: string;
    const __USE_SYSTEM_FONTS__: boolean;
    const __WEBPACK_SERVE__: boolean;

    const __webpack_require__: import('./ptv/services/chunkLoadRecovery').PtvWebpackRuntime;
}
