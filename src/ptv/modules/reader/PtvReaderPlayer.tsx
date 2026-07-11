/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-floating-promises, prefer-promise-reject-errors, react/jsx-no-bind */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import dialogHelper from '../../../components/dialogHelper/dialogHelper';
import { PluginType } from '../../../types/plugin';
import Events from '../../../utils/events';

import { recordPtvEvent } from '../../core/observability';

import type { ReaderSource } from './readerModels';
import { isPiggieTvReaderItem, resolveReaderSource } from './sourceResolver';

export default class PtvReaderPlayer {
    name = 'PiggieTV Reader';
    type = PluginType.MediaPlayer;
    id = 'ptvreader';
    priority = 0;
    isLocalPlayer = true;

    private mediaElement: HTMLElement | null = null;
    private root: Root | null = null;
    private item: Record<string, any> | null = null;
    private source: ReaderSource | null = null;
    private progress = 0;
    private stopping = false;
    streamInfo: Record<string, any> | null = null;

    play(options: Record<string, any>): Promise<void> {
        const startedAt = performance.now();

        this.stopping = false;
        this.progress = 0;
        this.item = options.items?.[0] || options.item || null;

        if (!this.item) {
            return Promise.reject('ErrorDefault');
        }

        this.streamInfo = {
            started: true,
            ended: false,
            item: this.item,
            mediaSource: {
                Id: this.item.Id
            }
        };

        return resolveReaderSource(this.item)
            .then(async source => {
                const { ReaderApp } = await import('./ReaderApp');

                if (this.stopping) return;

                this.source = source;
                const element = this.createMediaElement();
                const rootHost = element.querySelector('.ptv-reader-root');

                if (!rootHost) throw new Error('Reader host missing');

                this.root = createRoot(rootHost);
                this.root.render(
                    <ReaderApp
                        openedAt={startedAt}
                        source={source}
                        onClose={() => this.stop()}
                        onProgress={(percent) => {
                            this.progress = (Math.max(0, Math.min(100, percent)) / 100) * 1000;
                            Events.trigger(this, 'pause');
                        }}
                    />
                );
                recordPtvEvent('render', 'readerOpenMs', {
                    itemId: this.item?.Id || null,
                    readerOpenMs: Math.max(0, Math.round(performance.now() - startedAt)),
                    sourceFormat: source.format
                });
            });
    }

    stop() {
        if (this.stopping) return;

        this.stopping = true;

        const stopInfo = {
            src: this.item
        };

        if (this.streamInfo) {
            this.streamInfo.ended = true;
        }

        Events.trigger(this, 'stopped', [stopInfo]);

        if (this.root) {
            this.root.unmount();
            this.root = null;
        }

        if (this.mediaElement) {
            this.mediaElement.removeEventListener('close', this.onDialogClosed);
            dialogHelper.close(this.mediaElement);
            this.mediaElement = null;
        }

        this.item = null;
        this.source = null;
    }

    destroy() {
        this.stop();
    }

    currentItem() {
        return this.item;
    }

    currentTime() {
        return this.progress;
    }

    duration() {
        return 1000;
    }

    getBufferedRanges() {
        return [{ start: 0, end: 1000 }];
    }

    volume() {
        return 100;
    }

    isMuted() {
        return false;
    }

    paused() {
        return false;
    }

    seekable() {
        return true;
    }

    canPlayMediaType(mediaType: string) {
        return String(mediaType || '').toLowerCase() === 'book';
    }

    canPlayItem(item: Record<string, any>) {
        return isPiggieTvReaderItem(item);
    }

    private onDialogClosed = () => {
        this.stop();
    };

    private createMediaElement() {
        if (this.mediaElement) return this.mediaElement;

        const element = dialogHelper.createDialog({
            autoFocus: false,
            exitAnimation: 'fadeout',
            exitAnimationDuration: 220,
            removeOnClose: true,
            scrollY: false,
            size: 'fullscreen'
        });

        element.id = 'ptvReaderPlayer';
        element.classList.add('ptv-reader-dialog');
        element.innerHTML = '<div class="ptv-reader-root"></div>';
        element.addEventListener('close', this.onDialogClosed, { once: true });
        dialogHelper.open(element);

        this.mediaElement = element;
        return element;
    }
}

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-floating-promises, prefer-promise-reject-errors, react/jsx-no-bind */
