import type { NativeHomeProfile } from './homeProfileService';
import type { NativeHomeRow } from '../hooks';

export function getNativeHomeEditorialDescription(row: NativeHomeRow, profile: NativeHomeProfile) {
    const configured = (row as NativeHomeRow & {
        description?: unknown;
        editorialDescription?: unknown;
        editorialSubtitle?: unknown;
    }).editorialDescription || (row as { description?: unknown }).description || (row as { editorialSubtitle?: unknown }).editorialSubtitle;

    if (typeof configured === 'string' && configured.trim()) return configured.trim();
    if (row.id === 'today-for-you') return 'A tuned mix for the way your library feels right now.';

    const text = `${row.id} ${row.source} ${row.title} ${row.subtitle} ${row.sourceValue || ''}`.toLowerCase();
    const topGenre = profile.topGenres[0] || '';

    if (/continue[-\s]?watching|resume/.test(text)) {
        return profile.continueCounts.watching > 1
            ? `${profile.continueCounts.watching} unfinished titles are ready when you are.`
            : 'Pick up right where the story paused.';
    }

    if (/continue[-\s]?reading/.test(text)) return 'Open the next page without losing your place.';
    if (/continue[-\s]?listening/.test(text)) return 'Resume the sound you already had in motion.';
    if (/latest[-\s]?movies|new[-\s]?movies/.test(text)) return 'New film arrivals ready for tonight.';
    if (/latest[-\s]?shows|new[-\s]?shows|recent episodes/.test(text)) return 'Fresh episodes waiting to be discovered.';
    if (/latest[-\s]?anime|new[-\s]?anime/.test(text)) return 'Fresh anime picks from the newest additions.';
    if (/latest[-\s]?cartoons|new[-\s]?cartoons/.test(text)) return 'Bright, quick watches from the newest cartoon shelves.';
    if (/music|album|artist|song/.test(text)) return 'Albums, tracks, and artists tuned to your recent listening.';
    if (/reading|books|comic|manga/.test(text)) return 'Books, comics, and manga with a clear path back in.';
    if (/collection/.test(text)) return 'Franchises and curated sets gathered into one place.';
    if (/genre/.test(text)) return 'A focused lane through the moods you return to.';
    if (/rediscover/.test(text)) return 'Favorites and overlooked picks worth another visit.';
    if (/discover|discovery/.test(text)) return 'A few fresh turns outside your usual rotation.';
    if (row.source === 'recommendation') return topGenre ? `More stories that match your recent ${topGenre} favorites.` : "Curated from what you've been enjoying recently.";
    if (/disney/.test(text)) return 'Pixar, classics, and timeless family adventures.';
    if (/a24/.test(text)) return 'Modern horror, indie cinema, and award-winning dramas.';
    if (/studio/.test(text)) return 'A studio-focused shelf with a distinct point of view.';
    if (row.sourceValue) return `Curated from ${row.sourceValue}.`;

    return row.subtitle || 'Curated for your PiggieTV home.';
}

export function getNativeHomeTodayTitle(profile: NativeHomeProfile) {
    if (profile.continueCounts.watching && profile.context.timeOfDay === 'night') return 'Continue Tonight';
    if (profile.continueCounts.reading && profile.mood === 'reading') return 'Because You Have Been Reading';
    if (profile.continueCounts.listening && profile.mood === 'background-music') return 'Relax and Listen';
    if (profile.context.isWeekend) return 'Weekend Picks';
    if (profile.seasonal.titleHint) return profile.seasonal.titleHint;
    if (profile.mood === 'dark') return 'Fresh Dark Picks';
    if (profile.mood === 'anime') return 'Continue Your Anime';
    if (profile.context.timeOfDay === 'night') return "Tonight's Picks";

    return 'Today For You';
}
