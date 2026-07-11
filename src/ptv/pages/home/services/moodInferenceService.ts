export type NativeHomeMood =
    | 'action'
    | 'anime'
    | 'background-music'
    | 'comedy'
    | 'dark'
    | 'family'
    | 'fantasy'
    | 'general'
    | 'late-night'
    | 'reading'
    | 'relaxing'
    | 'sci-fi';

export type NativeHomeMoodResult = {
    confidence: number;
    mood: NativeHomeMood;
    signals: string[];
};

type NativeHomeMoodInput = {
    genreScores: Record<string, number>;
    isWeekend: boolean;
    mediaCounts: Record<string, number>;
    timeOfDay: 'afternoon' | 'evening' | 'morning' | 'night';
};

function getScore(scores: Record<string, number>, ...terms: string[]) {
    return terms.reduce((total, term) => total + (scores[term] || 0), 0);
}

function addMoodScore(
    scores: Map<NativeHomeMood, { score: number; signals: string[] }>,
    mood: NativeHomeMood,
    score: number,
    signal: string
) {
    if (score <= 0) return;

    const current = scores.get(mood) || { score: 0, signals: [] };

    current.score += score;
    current.signals.push(signal);
    scores.set(mood, current);
}

export function inferNativeHomeMood(input: NativeHomeMoodInput): NativeHomeMoodResult {
    const scores = new Map<NativeHomeMood, { score: number; signals: string[] }>();
    const genreScores = input.genreScores;

    addMoodScore(scores, 'comedy', getScore(genreScores, 'comedy', 'animation') * 1.2, 'comedy and animation activity');
    addMoodScore(scores, 'dark', getScore(genreScores, 'horror', 'thriller', 'crime', 'mystery') * 1.15, 'dark genre activity');
    addMoodScore(scores, 'fantasy', getScore(genreScores, 'fantasy', 'adventure') * 1.1, 'fantasy and adventure activity');
    addMoodScore(scores, 'sci-fi', getScore(genreScores, 'sci-fi', 'science fiction') * 1.15, 'science fiction activity');
    addMoodScore(scores, 'action', getScore(genreScores, 'action', 'superhero') * 1.05, 'action activity');
    addMoodScore(scores, 'family', getScore(genreScores, 'family', 'children') * 1.2, 'family titles');
    addMoodScore(scores, 'anime', getScore(genreScores, 'anime') + (input.mediaCounts.anime || 0) * 8, 'anime activity');
    addMoodScore(scores, 'reading', (input.mediaCounts.book || 0) * 8, 'reading activity');
    addMoodScore(scores, 'background-music', (input.mediaCounts.audio || 0) * 7 + (input.mediaCounts.musicalbum || 0) * 5, 'listening activity');

    if (input.timeOfDay === 'night') {
        addMoodScore(scores, 'late-night', 28, 'late-night context');
        addMoodScore(scores, 'relaxing', 10, 'night wind-down context');
    }

    if (input.timeOfDay === 'evening') {
        addMoodScore(scores, 'relaxing', 18, 'evening context');
    }

    if (input.isWeekend) {
        addMoodScore(scores, 'fantasy', 8, 'weekend context');
        addMoodScore(scores, 'family', 8, 'weekend context');
    }

    const entries = Array.from(scores.entries()).sort((left, right) => right[1].score - left[1].score);
    const [mood, result] = entries[0] || ['general', { score: 0, signals: ['balanced library activity'] }] as const;
    const confidence = Math.max(42, Math.min(96, Math.round(result.score)));

    return {
        confidence,
        mood,
        signals: result.signals.slice(0, 4)
    };
}
