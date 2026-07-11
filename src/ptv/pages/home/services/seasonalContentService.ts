export type NativeHomeSeasonalContext = {
    keywords: string[];
    label: string;
    titleHint: string;
};

export function getNativeHomeSeasonalContext(date = new Date()): NativeHomeSeasonalContext {
    const month = date.getMonth();
    const day = date.getDate();

    if (month === 9) {
        return {
            keywords: ['horror', 'thriller', 'mystery', 'supernatural'],
            label: 'halloween',
            titleHint: 'Fresh Horror'
        };
    }

    if (month === 10 && day >= 20 || month === 11) {
        return {
            keywords: ['christmas', 'holiday', 'family', 'fantasy'],
            label: 'holiday',
            titleHint: 'Holiday Picks'
        };
    }

    if (month >= 5 && month <= 7) {
        return {
            keywords: ['adventure', 'action', 'comedy', 'family'],
            label: 'summer',
            titleHint: 'Summer Watchlist'
        };
    }

    if (month === 0 || month === 1) {
        return {
            keywords: ['drama', 'biography', 'history', 'documentary'],
            label: 'awards-season',
            titleHint: 'Award Season Picks'
        };
    }

    if ([0, 3, 6, 9].includes(month)) {
        return {
            keywords: ['anime', 'animation', 'fantasy', 'action'],
            label: 'anime-season',
            titleHint: 'New Anime Season'
        };
    }

    return {
        keywords: [],
        label: 'none',
        titleHint: ''
    };
}
