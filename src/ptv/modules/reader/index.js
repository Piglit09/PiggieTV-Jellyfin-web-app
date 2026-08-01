import { pluginManager } from '../../../components/pluginManager';

import PtvReaderPlayer from './PtvReaderPlayer';
import './reader.scss';

let readerRegistrationPromise = null;

export function ensurePtvReaderRegistration() {
    const existingPlayer = pluginManager.plugins
        .find(plugin => plugin.id === 'ptvreader');

    if (existingPlayer) {
        return Promise.resolve(existingPlayer);
    }

    if (readerRegistrationPromise) return readerRegistrationPromise;

    readerRegistrationPromise = pluginManager
        .loadPlugin(Promise.resolve({ default: PtvReaderPlayer }))
        .catch(error => {
            readerRegistrationPromise = null;
            console.warn('[PiggieTV Reader] Failed to register reader player', error);
            throw error;
        });

    return readerRegistrationPromise;
}
