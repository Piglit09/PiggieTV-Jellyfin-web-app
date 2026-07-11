import { recordPtvEvent } from 'ptv/core/observability';
import PiggieTvMusicPage from 'ptv/modules/music/musicPage';

const MUSIC_ROUTE_DIAGNOSTIC = {
    module: 'ptv/modules/music',
    page: 'music',
    route: '#/music'
};

recordPtvEvent('route', 'music-route-loaded', MUSIC_ROUTE_DIAGNOSTIC);
console.info('[PTV Music] music route loaded', MUSIC_ROUTE_DIAGNOSTIC);

export const Component = PiggieTvMusicPage;
