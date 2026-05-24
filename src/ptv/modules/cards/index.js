import { registerModule } from '../../core/lifecycle';
import { watchDom } from '../../core/observer';

import { enhancePtvCards } from './CardEnhancer';

function init() {
    document.documentElement.classList.add('ptv-native-cards');
    enhancePtvCards();
    watchDom(enhancePtvCards);
}

function destroy() {
    document.documentElement.classList.remove('ptv-native-cards');
}

registerModule({
    density: 'comfortable',
    features: ['media-grid', 'cards'],
    name: 'cards',
    surface: 2,
    widgets: [
        {
            density: 'comfortable',
            id: 'media-card',
            surface: 2,
            type: 'media-card'
        }
    ],
    init,
    destroy
});
