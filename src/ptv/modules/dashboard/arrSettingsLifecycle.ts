type PtvArrServiceSettingsLike = {
    apiKey?: string | null;
    enabled: boolean;
};

export function applyPtvArrApiKeyInputs<
    TServiceName extends string,
    TService extends PtvArrServiceSettingsLike
>(
    settings: Record<TServiceName, TService>,
    apiKeyInputs: Partial<Record<TServiceName, string>>
) {
    const nextSettings = { ...settings };

    (Object.keys(settings) as TServiceName[]).forEach(serviceName => {
        const nextService = { ...settings[serviceName] };
        const apiKey = apiKeyInputs[serviceName]?.trim();

        if (apiKey) {
            nextService.apiKey = apiKey;
            nextService.enabled = true;
        } else {
            delete nextService.apiKey;
        }

        nextSettings[serviceName] = nextService;
    });

    return nextSettings;
}
