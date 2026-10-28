import React, { useCallback, useMemo, useState } from 'react';

import {
    getPtvItemImageCandidates,
    markPtvImageCandidateFailed,
    recordPtvImageFallback,
    type PtvItemImageCandidate
} from '../../api/images';
import type { PtvCollectionMemberSummary } from './collectionTypes';

function MemberArtwork({
    candidates,
    title
}: Readonly<{
    candidates: readonly PtvItemImageCandidate[];
    title: string;
}>) {
    const [candidateIndex, setCandidateIndex] = useState(0);
    const candidate = candidates[candidateIndex];
    const onError = useCallback(() => {
        if (!candidate) return;
        markPtvImageCandidateFailed(candidate);
        recordPtvImageFallback();
        setCandidateIndex(index => index + 1);
    }, [candidate]);

    if (!candidate) {
        return <span className='ptv-collection-memberArtworkFallback'>{title.charAt(0)}</span>;
    }

    return (
        <img
            alt=''
            decoding='async'
            loading='lazy'
            src={candidate.url}
            onError={onError}
        />
    );
}

export function MemberCard({
    focusKey,
    href,
    mediaLabel,
    member
}: Readonly<{
    focusKey: string;
    href: string;
    mediaLabel: string;
    member: PtvCollectionMemberSummary;
}>) {
    const candidates = useMemo(() => getPtvItemImageCandidates(member.raw, {
        baseOptions: { maxHeight: 480, maxWidth: 320, quality: 85 },
        order: ['Primary', 'Thumb']
    }), [member.raw]);
    const artworkIdentity = `${member.key}:${candidates.map(candidate => candidate.url).join('|')}`;

    return (
        <article className='ptv-collection-memberCard' data-ptv-media-category={member.mediaCategory}>
            <a
                aria-label={`Open ${member.title}`}
                data-ptv-focus-key={focusKey}
                href={href}
            >
                <span className='ptv-collection-memberArtwork' aria-hidden='true'>
                    <MemberArtwork candidates={candidates} key={artworkIdentity} title={member.title} />
                    <span className='ptv-collection-memberIndex'>{member.collectionOrder + 1}</span>
                </span>
                <span className='ptv-collection-memberCopy'>
                    <strong>{member.title}</strong>
                    <span className='ptv-collection-memberMeta'>{mediaLabel}</span>
                    {member.progress.started ? <span className='ptv-collection-memberMeta'>{member.progress.completed ? 'Completed' : `${member.progress.percent}% complete`}</span> : null}
                </span>
            </a>
        </article>
    );
}
