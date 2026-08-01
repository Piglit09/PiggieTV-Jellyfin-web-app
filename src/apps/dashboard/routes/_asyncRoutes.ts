import type { AsyncRoute } from 'components/router/AsyncRoute';
import { AppType } from 'constants/appType';
import { registerPtvRecommendationRouteOnce } from 'ptv/modules/recommendations/recommendationRouteRegistration';

const PTV_ROW_BUILDER_ROUTE: AsyncRoute = { path: 'piggietv/rows', type: AppType.Dashboard };
const PTV_RECOMMENDATIONS_ROUTE: AsyncRoute = { path: 'piggietv/recommendations', type: AppType.Dashboard };
const PTV_DIAGNOSTICS_ROUTE: AsyncRoute = { path: 'piggietv/diagnostics', type: AppType.Dashboard };

registerPtvRecommendationRouteOnce(PTV_RECOMMENDATIONS_ROUTE.path);

export const ASYNC_ADMIN_ROUTES: AsyncRoute[] = [
    { path: 'activity', type: AppType.Dashboard },
    { path: 'backups', type: AppType.Dashboard },
    { path: 'branding', type: AppType.Dashboard },
    { path: 'devices', type: AppType.Dashboard },
    { path: 'settings', type: AppType.Dashboard },
    { path: 'keys', type: AppType.Dashboard },
    { path: 'libraries', type: AppType.Dashboard },
    { path: 'libraries/display', type: AppType.Dashboard },
    { path: 'libraries/metadata', type: AppType.Dashboard },
    { path: 'libraries/nfo', type: AppType.Dashboard },
    { path: 'livetv', type: AppType.Dashboard },
    { path: 'livetv/recordings', type: AppType.Dashboard },
    { path: 'logs', type: AppType.Dashboard },
    { path: 'logs/:file', page: 'logs/file', type: AppType.Dashboard },
    { path: 'playback/resume', type: AppType.Dashboard },
    { path: 'playback/streaming', type: AppType.Dashboard },
    { path: 'playback/transcoding', type: AppType.Dashboard },
    { path: 'playback/trickplay', type: AppType.Dashboard },
    { path: 'plugins', type: AppType.Dashboard },
    { path: 'plugins/:pluginId', page: 'plugins/plugin', type: AppType.Dashboard },
    { path: 'plugins/repositories', type: AppType.Dashboard },
    { path: 'piggietv', type: AppType.Dashboard },
    PTV_ROW_BUILDER_ROUTE,
    PTV_RECOMMENDATIONS_ROUTE,
    PTV_DIAGNOSTICS_ROUTE,
    { path: 'tasks', type: AppType.Dashboard },
    { path: 'tasks/:id', page: 'tasks/task', type: AppType.Dashboard },
    { path: 'users', type: AppType.Dashboard },
    { path: 'users/access', type: AppType.Dashboard },
    { path: 'users/add', type: AppType.Dashboard },
    { path: 'users/parentalcontrol', type: AppType.Dashboard },
    { path: 'users/password', type: AppType.Dashboard },
    { path: 'users/profile', type: AppType.Dashboard },
    { path: 'users/signup-invites', type: AppType.Dashboard }
];
