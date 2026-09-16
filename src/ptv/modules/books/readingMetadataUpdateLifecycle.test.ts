import { describe, expect, it } from 'vitest';

import type {
    PtvReadingHomeData,
    PtvReadingItem,
    PtvReadingSection
} from './booksTypes';
import {
    getPtvReadingAdminDialogClosePolicy,
    getPtvReadingMetadataUpdateAuthority,
    getPtvReadingMetadataUpdateDetail,
    isPtvReadingMetadataUpdateAuthoritative,
    isPtvReadingMetadataUpdateOwnedBy,
    replacePtvReadingItemInHomeData,
    replacePtvReadingItemInList,
    shouldPublishPtvReadingAdminDialogItem
} from './readingMetadataUpdateLifecycle';

function item(id: string, imageTag: string): PtvReadingItem {
    return {
        Id: id,
        ImageTags: { Primary: imageTag },
        Name: id,
        Type: 'Book'
    };
}

function section(id: string, items: PtvReadingItem[]): PtvReadingSection {
    return {
        id,
        items,
        title: id
    } as PtvReadingSection;
}

function homeData(sections: PtvReadingSection[]): PtvReadingHomeData {
    return {
        generatedAt: 1,
        kind: 'books',
        libraries: [],
        sections,
        stats: {
            favoriteCount: 0,
            itemCount: sections.reduce((total, value) => total + value.items.length, 0),
            libraryCount: 0,
            metadata: {
                itemCount: 0,
                providerCounts: {
                    comicvine: 0,
                    googlebooks: 0,
                    openlibrary: 0
                }
            },
            resumedCount: 0
        }
    };
}

describe('Reading metadata update publication', () => {
    it('adopts the authoritative image tag for only the affected card', () => {
        const affected = item('book-1', 'old-tag');
        const unaffected = item('book-2', 'keep-tag');
        const untouchedSection = section('other', [ item('book-3', 'other-tag') ]);
        const initialSection = section('library', [ affected, unaffected ]);
        const initial = homeData([ initialSection, untouchedSection ]);
        const updated = {
            ...affected,
            ImageTags: { Primary: 'new-tag' },
            Name: 'Server-normalized title'
        };
        const next = replacePtvReadingItemInHomeData(initial, updated);

        expect(next).not.toBe(initial);
        expect(next.sections[0]).not.toBe(initialSection);
        expect(next.sections[0].items[0]).toMatchObject({
            ImageTags: { Primary: 'new-tag' },
            Name: 'Server-normalized title'
        });
        expect(next.sections[0].items[1]).toBe(unaffected);
        expect(next.sections[1]).toBe(untouchedSection);
    });

    it('updates repeated affected cards without replacing unrelated list entries', () => {
        const affected = item('comic-1', 'old-tag');
        const unaffected = item('manga-1', 'keep-tag');
        const initial = [ affected, unaffected, affected ];
        const next = replacePtvReadingItemInList(initial, {
            ...affected,
            ImageTags: { Primary: 'fresh-tag' }
        });

        expect(next).not.toBe(initial);
        expect(next[0].ImageTags?.Primary).toBe('fresh-tag');
        expect(next[1]).toBe(unaffected);
        expect(next[2].ImageTags?.Primary).toBe('fresh-tag');
    });

    it('accepts only matching item events and distinguishes unconfirmed readback', () => {
        const updated = item('book-1', 'fresh-tag');
        const confirmed = getPtvReadingMetadataUpdateDetail(new CustomEvent(
            'ptv-reading-item-metadata-updated',
            {
                detail: {
                    item: updated,
                    itemId: updated.Id,
                    operationGeneration: 7,
                    outcome: 'FULL_SUCCESS',
                    readingOwnerGeneration: 3,
                    readbackCode: 'READBACK_CONFIRMED'
                }
            }
        ));
        const unconfirmed = getPtvReadingMetadataUpdateDetail(new CustomEvent(
            'ptv-reading-item-metadata-updated',
            {
                detail: {
                    item: updated,
                    itemId: updated.Id,
                    outcome: 'PARTIAL_SUCCESS',
                    readbackCode: 'REFRESH_FAILED'
                }
            }
        ));

        expect(confirmed && isPtvReadingMetadataUpdateAuthoritative(confirmed)).toBe(true);
        expect(confirmed).toMatchObject({
            operationGeneration: 7,
            readingOwnerGeneration: 3
        });
        expect(confirmed && getPtvReadingMetadataUpdateAuthority(confirmed)).toBe('READBACK_CONFIRMED_MUTATION');
        expect(unconfirmed && isPtvReadingMetadataUpdateAuthoritative(unconfirmed)).toBe(false);
        expect(unconfirmed && getPtvReadingMetadataUpdateAuthority(unconfirmed)).toBe('READBACK_STALE_OR_UNCONFIRMED');
        const missingReadback = getPtvReadingMetadataUpdateDetail(new CustomEvent('ptv-reading-item-metadata-updated', {
            detail: { item: updated, itemId: 'another-item' }
        }));
        const matchingMissingReadback = getPtvReadingMetadataUpdateDetail(new CustomEvent('ptv-reading-item-metadata-updated', {
            detail: { item: updated, itemId: updated.Id }
        }));

        expect(missingReadback).toBeNull();
        expect(matchingMissingReadback && isPtvReadingMetadataUpdateAuthoritative(matchingMissingReadback)).toBe(false);
    });

    it('rejects a terminal event owned by an unmounted Reading route generation', () => {
        const updated = item('book-1', 'fresh-tag');
        const detail = getPtvReadingMetadataUpdateDetail(new CustomEvent('ptv-reading-item-metadata-updated', {
            detail: {
                item: updated,
                itemId: updated.Id,
                operationGeneration: 9,
                readingOwnerGeneration: 4,
                readbackCode: 'READBACK_CONFIRMED'
            }
        }));

        expect(detail && isPtvReadingMetadataUpdateOwnedBy(detail, 4)).toBe(true);
        expect(detail && isPtvReadingMetadataUpdateOwnedBy(detail, 5)).toBe(false);
    });

    it('classifies transport failure separately and rejects invalid operation generations', () => {
        const updated = item('book-1', 'fresh-tag');
        const failed = getPtvReadingMetadataUpdateDetail(new CustomEvent('ptv-reading-item-metadata-updated', {
            detail: {
                item: updated,
                itemId: updated.Id,
                operationGeneration: 0,
                readbackCode: 'READBACK_FAILED'
            }
        }));

        expect(failed).toMatchObject({
            itemId: 'book-1',
            operationGeneration: undefined,
            readbackCode: 'READBACK_FAILED'
        });
        expect(failed && getPtvReadingMetadataUpdateAuthority(failed)).toBe('READBACK_FAILED');
    });

    it('uses the typed authoritative event instead of the Identify dialog fallback item', () => {
        expect(shouldPublishPtvReadingAdminDialogItem('identify')).toBe(false);
        expect(shouldPublishPtvReadingAdminDialogItem('metadata')).toBe(true);
        expect(shouldPublishPtvReadingAdminDialogItem('images')).toBe(true);
        expect(getPtvReadingAdminDialogClosePolicy('identify')).toBe('identify-event');
        expect(getPtvReadingAdminDialogClosePolicy('metadata')).toBe('targeted-readback');
        expect(getPtvReadingAdminDialogClosePolicy('images')).toBe('targeted-readback');
        expect(getPtvReadingAdminDialogClosePolicy('metadata', item('book-1', 'new-tag'))).toBe('publish-item');
    });

    it('preserves component-specific refresh failure codes for targeted readback', () => {
        const updated = item('book-1', 'fresh-tag');

        expect(getPtvReadingMetadataUpdateDetail(new CustomEvent('ptv-reading-item-metadata-updated', {
            detail: {
                item: updated,
                itemId: updated.Id,
                outcome: 'PARTIAL_SUCCESS',
                readbackCode: 'METADATA_REFRESH_FAILED'
            }
        }))).toMatchObject({
            itemId: 'book-1',
            readbackCode: 'METADATA_REFRESH_FAILED'
        });
    });
});
