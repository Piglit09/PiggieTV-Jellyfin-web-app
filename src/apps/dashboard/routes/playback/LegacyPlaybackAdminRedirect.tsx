import React from 'react';
import { Navigate } from 'react-router-dom';

const PLAYBACK_ROUTE = '/settings/admin/playback';

type LegacyPlaybackSection = 'resume' | 'streaming' | 'transcoding' | 'trickplay';

function LegacyPlaybackRedirect({ section }: Readonly<{ section: LegacyPlaybackSection }>) {
    return <Navigate replace to={`${PLAYBACK_ROUTE}/${section}`} />;
}

/** Redirects only the migrated legacy Streaming route. */
export function LegacyStreamingRedirect() {
    return <LegacyPlaybackRedirect section='streaming' />;
}

/** Redirects only the migrated legacy Transcoding route. */
export function LegacyTranscodingRedirect() {
    return <LegacyPlaybackRedirect section='transcoding' />;
}

/** Redirects only the migrated legacy Resume route. */
export function LegacyResumeRedirect() {
    return <LegacyPlaybackRedirect section='resume' />;
}

/** Redirects only the migrated legacy Trickplay route. */
export function LegacyTrickplayRedirect() {
    return <LegacyPlaybackRedirect section='trickplay' />;
}
