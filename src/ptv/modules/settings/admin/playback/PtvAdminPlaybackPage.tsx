import Dialog from '@mui/material/Dialog/Dialog';
import DialogActions from '@mui/material/DialogActions/DialogActions';
import DialogContent from '@mui/material/DialogContent/DialogContent';
import DialogContentText from '@mui/material/DialogContentText/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle/DialogTitle';
import React, { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AdminConfigurationHeader } from '../configuration/AdminConfigurationPrimitives';
import type { AdminPlaybackSection } from './AdminPlaybackRoute';
import AdminResumeSection from './sections/AdminResumeSection';
import AdminStreamingSection from './sections/AdminStreamingSection';
import AdminTrickplaySection from './sections/AdminTrickplaySection';
import AdminTranscodingSection from './sections/AdminTranscodingSection';

import './adminPlayback.scss';

export type AdminPlaybackGuardRegistration = (
    dirty: boolean,
    isBusy: () => boolean,
    discard: () => void
) => void;

type AdminPlaybackGuardState = Readonly<{
    dirty: boolean;
    discard: () => void;
    isBusy: () => boolean;
}>;

const PLAYBACK_TABS: readonly Readonly<{
    id: AdminPlaybackSection;
    label: string;
}>[] = [
    { id: 'streaming', label: 'Streaming' },
    { id: 'transcoding', label: 'Transcoding' },
    { id: 'resume', label: 'Resume' },
    { id: 'trickplay', label: 'Trickplay' }
] as const;
const PLAYBACK_PANEL_ID = 'ptv-admin-playback-panel';

function sectionPath(section: AdminPlaybackSection) {
    return `/settings/admin/playback/${section}`;
}

function PlaybackSection({
    onGuardChange,
    section
}: Readonly<{
    onGuardChange: AdminPlaybackGuardRegistration;
    section: AdminPlaybackSection;
}>) {
    switch (section) {
        case 'transcoding':
            return <AdminTranscodingSection onGuardChange={onGuardChange} />;
        case 'resume':
            return <AdminResumeSection onGuardChange={onGuardChange} />;
        case 'trickplay':
            return <AdminTrickplaySection onGuardChange={onGuardChange} />;
        case 'streaming':
        default:
            return <AdminStreamingSection onGuardChange={onGuardChange} />;
    }
}

/* eslint-disable react/jsx-no-bind */
export default function PtvAdminPlaybackPage({
    section
}: Readonly<{ section: AdminPlaybackSection }>) {
    const navigate = useNavigate();
    const guardRef = useRef<AdminPlaybackGuardState>({
        dirty: false,
        discard: () => undefined,
        isBusy: () => false
    });
    const [ dirty, setDirty ] = useState(false);
    const [ busy, setBusy ] = useState(false);
    const [ pendingSection, setPendingSection ] = useState<AdminPlaybackSection | null>(null);
    const registerGuard = useCallback<AdminPlaybackGuardRegistration>((isDirty, isBusy, discard) => {
        guardRef.current = { dirty: isDirty, discard, isBusy };
        setDirty(isDirty);
        setBusy(isBusy());
    }, []);
    const requestSection = useCallback((target: AdminPlaybackSection) => {
        if (target === section) return false;
        if (guardRef.current.isBusy()) return false;
        if (guardRef.current.dirty) {
            setPendingSection(target);
            return false;
        }
        navigate(sectionPath(target));
        return true;
    }, [ navigate, section ]);
    const handleTabClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        requestSection(event.currentTarget.dataset.playbackSection as AdminPlaybackSection);
    }, [ requestSection ]);
    const handleTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLAnchorElement>) => {
        const currentSection = event.currentTarget.dataset.playbackSection as AdminPlaybackSection;
        const currentIndex = PLAYBACK_TABS.findIndex(tab => tab.id === currentSection);
        if (currentIndex < 0) return;

        let nextIndex: number | null = null;
        switch (event.key) {
            case 'ArrowLeft':
                nextIndex = (currentIndex + PLAYBACK_TABS.length - 1) % PLAYBACK_TABS.length;
                break;
            case 'ArrowRight':
                nextIndex = (currentIndex + 1) % PLAYBACK_TABS.length;
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = PLAYBACK_TABS.length - 1;
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                requestSection(currentSection);
                return;
            default:
                return;
        }

        event.preventDefault();
        const nextSection = PLAYBACK_TABS[nextIndex].id;
        if (requestSection(nextSection)) {
            document.getElementById(`ptv-admin-playback-tab-${nextSection}`)?.focus();
        }
    }, [ requestSection ]);
    const discardAndNavigate = useCallback(() => {
        if (guardRef.current.isBusy()) return;
        const target = pendingSection;
        guardRef.current.discard();
        guardRef.current = { ...guardRef.current, dirty: false };
        setDirty(false);
        setPendingSection(null);
        if (target) window.setTimeout(() => navigate(sectionPath(target)), 0);
    }, [ navigate, pendingSection ]);

    return (
        <section className='ptv-admin-playback' data-active-section={section} data-testid='ptv-admin-playback'>
            <AdminConfigurationHeader
                fetching={false}
                subtitle='Configure server-wide streaming and playback processing.'
                title='Playback'
            />

            <nav aria-label='Playback administration sections'>
                <div
                    aria-label='Playback settings'
                    aria-orientation='horizontal'
                    className='ptv-admin-playback-tabs'
                    role='tablist'
                >
                    {PLAYBACK_TABS.map(tab => (
                        <Link
                            aria-controls={PLAYBACK_PANEL_ID}
                            aria-disabled={busy && tab.id !== section ? true : undefined}
                            aria-selected={tab.id === section}
                            data-playback-section={tab.id}
                            id={`ptv-admin-playback-tab-${tab.id}`}
                            key={tab.id}
                            onClick={handleTabClick}
                            onKeyDown={handleTabKeyDown}
                            role='tab'
                            tabIndex={tab.id === section ? 0 : -1}
                            to={sectionPath(tab.id)}
                        >
                            {tab.label}
                        </Link>
                    ))}
                </div>
            </nav>

            <div
                aria-labelledby={`ptv-admin-playback-tab-${section}`}
                className='ptv-admin-playback-section'
                data-dirty={dirty || undefined}
                id={PLAYBACK_PANEL_ID}
                role='tabpanel'
            >
                <PlaybackSection key={section} onGuardChange={registerGuard} section={section} />
            </div>

            <Dialog
                aria-labelledby='ptv-playback-discard-title'
                className='ptv-admin-playback-dialog'
                fullWidth
                maxWidth='xs'
                onClose={() => setPendingSection(null)}
                open={Boolean(pendingSection)}
            >
                <DialogTitle id='ptv-playback-discard-title'>Discard unsaved changes?</DialogTitle>
                <DialogContent>
                    <DialogContentText>Your edits in this Playback section have not been saved.</DialogContentText>
                </DialogContent>
                <DialogActions className='ptv-admin-playback-dialog-actions'>
                    <button onClick={() => setPendingSection(null)} type='button'>Keep Editing</button>
                    <button className='is-danger' disabled={busy} onClick={discardAndNavigate} type='button'>Discard Changes</button>
                </DialogActions>
            </Dialog>
        </section>
    );
}
/* eslint-enable react/jsx-no-bind */
