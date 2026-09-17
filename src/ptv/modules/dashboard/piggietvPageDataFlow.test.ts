import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const configurationSource = readSource('src/ptv/modules/dashboard/PiggieTvDashboardPage.tsx');
const rowsSource = readSource('src/ptv/modules/dashboard/PiggieTvRowsPage.tsx');
const controllerSource = readSource('src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Api/PtvStatusController.cs');

describe('PiggieTV native page request flow', () => {
    it('hydrates plugin-owned feature settings without writing a second browser settings store', () => {
        expect(configurationSource).toContain('applyPtvFeatureSettings({');
        expect(configurationSource).not.toContain("setPtvFeatureSetting('heroEnabled'");
        expect(configurationSource).not.toContain("setPtvFeatureSetting('homeRowsEnabled'");
    });

    it('treats every provider credential returned by settings as write-only browser data', () => {
        expect(configurationSource).toContain('nextSettings.musicMetadataSettings.discogsToken = null;');
        expect(configurationSource).toContain('nextSettings.googleBooksSettings.googleBooksApiKey = null;');
        expect(configurationSource).toContain('nextSettings.tmdbSettings.tmdbApiToken = null;');
        expect(configurationSource).toContain('nextSettings.seerrSettings.apiKey = null;');
        expect(configurationSource).toContain('nextSettings.arrSettings.sonarr.apiKey = null;');
        expect(configurationSource).toContain('nextSettings.downloadSettings.password = null;');
    });

    it('uses authoritative shared Calendar availability and refreshes it after integration saves', () => {
        expect(configurationSource).toContain('usePtvArrCalendarAvailability()');
        expect(configurationSource).toContain('void invalidatePtvArrCalendarAvailability();');
        expect(configurationSource).toContain('href={PTV_ROUTES.calendar}');
        expect(configurationSource).toContain('Open Calendar');
        expect(configurationSource).not.toContain('ARR_CALENDAR_SERVICE_NAMES.some');

        const resetStart = configurationSource.indexOf('const resetPluginSettings = useCallback');
        const resetEnd = configurationSource.indexOf('const saveFeatureSettings = useCallback', resetStart);
        const resetSource = configurationSource.slice(resetStart, resetEnd);
        expect(resetSource).toContain('clearPtvIntegrationSettingsCache();');
        expect(resetSource).toContain('void invalidatePtvArrCalendarAvailability();');
        expect(configurationSource).toContain('Retry');
    });

    it('hydrates Configuration with two independent read-only sources on mount', () => {
        const mountLoadStart = configurationSource.indexOf('void loadPtvConfigurationSources({');
        const mountLoadEnd = configurationSource.indexOf('}, [loadPluginSettings, refreshPluginStatus]);', mountLoadStart);
        const mountLoad = configurationSource.slice(mountLoadStart, mountLoadEnd);

        expect(mountLoadStart).toBeGreaterThan(-1);
        expect(mountLoad).toContain("loadPluginSettings({ origin: 'mount' })");
        expect(mountLoad).toContain('loadStatus: refreshPluginStatus');
        expect(mountLoad).not.toMatch(/save|reset|refreshCache|clearCache/i);
    });

    it('loads Row Builder without invoking a mutation', () => {
        const loadStart = rowsSource.indexOf('const loadRows = useCallback(() => {');
        const loadEnd = rowsSource.indexOf('useEffect(() => {', loadStart);
        const loadRows = rowsSource.slice(loadStart, loadEnd);

        expect(loadStart).toBeGreaterThan(-1);
        expect(loadRows).toContain('api.getSettings<unknown>()');
        expect(loadRows).toContain('api.getRows<PtvRowBuilderSettings>()');
        expect(loadRows.match(/api\.getSettings<unknown>\(\)/g)).toHaveLength(1);
        expect(loadRows).toContain('getSeerrConfiguredFromSettingsPayload(payload)');
        expect(loadRows).not.toContain('getPtvIntegrationSettings');
        expect(loadRows).not.toMatch(/api\.(save|refresh|reset|clear|write|delete)/);
        expect(loadRows).toContain("throw rowsError || settingsError || new Error('Home Row settings were not returned by the server.')");
        expect(loadRows).not.toContain('rows || DEFAULT_SETTINGS');
    });

    it('refetches authoritative baselines before Configuration and Row writes', () => {
        const settingsSaveStart = configurationSource.indexOf('const savePluginSettings = useCallback((');
        const settingsSaveEnd = configurationSource.indexOf('const resetPluginSettings = useCallback', settingsSaveStart);
        const settingsSave = configurationSource.slice(settingsSaveStart, settingsSaveEnd);
        const rowsSaveStart = rowsSource.indexOf('const saveRows = useCallback(async () => {');
        const rowsSaveEnd = rowsSource.indexOf('const refreshCache = useCallback', rowsSaveStart);
        const rowsSave = rowsSource.slice(rowsSaveStart, rowsSaveEnd);

        expect(settingsSave).toContain('pluginApi.getSettings<PtvPluginSettings>()');
        expect(settingsSave.indexOf('pluginApi.getSettings<PtvPluginSettings>()'))
            .toBeLessThan(settingsSave.indexOf('pluginApi.saveSettings<PtvPluginSettings, PtvPluginSettingsPatch>'));
        expect(settingsSave).toContain('new PtvSettingsConflictError()');
        expect(settingsSave.indexOf('settingsSectionBaselineRef.current.set('))
            .toBeLessThan(settingsSave.indexOf('shouldApplyPtvAdminMutationResult('));
        expect(rowsSave).toContain('api.getRows<PtvRowBuilderSettings>()');
        expect(rowsSave.indexOf('api.getRows<PtvRowBuilderSettings>()'))
            .toBeLessThan(rowsSave.indexOf('api.saveRows<PtvRowBuilderSettings, PtvRowBuilderSettings>'));
        expect(rowsSave).toContain('new PtvRowsConflictError()');
    });

    it('serializes recommendation mutations and keeps conflicted drafts visible', () => {
        const recommendationSaveStart = rowsSource.indexOf('const savePersistedRecommendationSettings = useCallback(async (');
        const recommendationSaveEnd = rowsSource.indexOf('const loadPersistedRecommendationRows = useCallback', recommendationSaveStart);
        const recommendationSave = rowsSource.slice(recommendationSaveStart, recommendationSaveEnd);
        const recommendationActionsStart = rowsSource.indexOf('const previewRecommendationRows = useCallback(async');
        const recommendationActionsEnd = rowsSource.indexOf('const saveRows = useCallback(async () => {', recommendationActionsStart);
        const recommendationActions = rowsSource.slice(recommendationActionsStart, recommendationActionsEnd);

        expect(recommendationSave).toContain('runPtvRecommendationMutationSingleFlight(recommendationSaveRequestRef');
        expect(recommendationSave).toContain('api.getSettings<unknown>({ bypassCache: true })');
        expect(recommendationSave.indexOf('api.getSettings<unknown>({ bypassCache: true })'))
            .toBeLessThan(recommendationSave.indexOf('api.saveSettings<unknown'));
        expect(recommendationActions).toContain('setRecommendationConflict(true)');
        expect(recommendationActions).toContain('remain unsaved');
        expect(recommendationActions).not.toContain('setRecommendationSettings(previousSettings)');
    });

    it('refreshes unchanged rows without posting the full row document', () => {
        const refreshStart = rowsSource.indexOf('const refreshCache = useCallback(async () => {');
        const refreshEnd = rowsSource.indexOf('const exportObject = useCallback', refreshStart);
        const refresh = rowsSource.slice(refreshStart, refreshEnd);

        expect(refresh).toContain('if (dirty) {');
        expect(refresh).toContain('await api.refreshFeaturedContentCacheDocument();');
    });

    it('observes the one rebuild already performed by each server save contract', () => {
        const saveStart = rowsSource.indexOf('const saveRows = useCallback(async () => {');
        const saveEnd = rowsSource.indexOf('const refreshCache = useCallback', saveStart);

        expect(rowsSource.slice(saveStart, saveEnd)).not.toContain('refreshFeaturedContentCacheDocument');
        expect(rowsSource).toContain('observeStoredFeaturedCacheDocumentAfterSave');
        expect(controllerSource).toContain('await RefreshFeaturedCacheAfterRowsSaveAsync("settings", cancellationToken)');
        expect(controllerSource).toContain('await RefreshFeaturedCacheAfterRowsSaveAsync("rows", cancellationToken)');
    });

    it('fails authoritative plugin reads closed instead of returning writable defaults', () => {
        expect(controllerSource).toContain('PTV_SETTINGS_UNAVAILABLE');
        expect(controllerSource).toContain('PTV_ROWS_UNAVAILABLE');
        expect(controllerSource).not.toContain('settingsService?.GetSettings() ?? PtvPluginSettingsDto.FromConfiguration');
        expect(controllerSource).not.toContain('settingsService?.GetSettings().Rows ?? RowBuilderSettings.CreateDefault()');
    });
});
