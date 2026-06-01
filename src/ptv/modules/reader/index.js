import { pluginManager } from '../../../components/pluginManager';

import PtvReaderPlayer from './PtvReaderPlayer';
import './reader.scss';

pluginManager.loadPlugin(Promise.resolve({ default: PtvReaderPlayer }))
    .catch(error => {
        console.warn('[PiggieTV Reader] Failed to register reader player', error);
    });
