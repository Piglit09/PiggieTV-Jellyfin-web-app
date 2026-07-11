import { AsyncRoute } from 'components/router/AsyncRoute';
import { AppType } from 'constants/appType';

export const ASYNC_USER_ROUTES: AsyncRoute[] = [
    { path: 'books', page: 'books' },
    { path: 'books/*', page: 'books' },
    { path: 'comics', page: 'comics' },
    { path: 'comics/*', page: 'comics' },
    { path: 'home', type: AppType.Experimental },
    { path: 'homevideos', type: AppType.Experimental },
    { path: 'livetv', type: AppType.Experimental },
    { path: 'maga', page: 'maga' },
    { path: 'maga/*', page: 'maga' },
    { path: 'manga', page: 'manga' },
    { path: 'manga/*', page: 'manga' },
    { path: 'movies', type: AppType.Experimental },
    { path: 'music', type: AppType.Experimental },
    { path: 'mypreferencesdisplay', page: 'user/display', type: AppType.Experimental },
    { path: 'mypreferencesmenu', page: 'user/settings' },
    { path: 'quickconnect', page: 'quickConnect' },
    { path: 'recomendations', page: 'recommendations' },
    { path: 'recomendations/*', page: 'recommendations' },
    { path: 'recommendations', page: 'recommendations' },
    { path: 'recommendations/*', page: 'recommendations' },
    { path: 'search' },
    { path: 'tv', page: 'shows', type: AppType.Experimental },
    { path: 'userprofile', page: 'user/userprofile' }
];
