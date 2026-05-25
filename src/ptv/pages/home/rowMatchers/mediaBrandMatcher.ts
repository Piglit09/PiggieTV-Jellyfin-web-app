type MatchableRecord = Record<string, unknown>;

type BrandTitleMatch = {
    aliases: string[];
    needsSignal?: boolean;
    score?: number;
};

export type MediaBrandDefinition = {
    id: string;
    title: string;
    minScore: number;
    searchTerms: string[];
    strongKeywords: string[];
    supportingKeywords?: string[];
    titleMatches?: BrandTitleMatch[];
    studioKeywords?: string[];
    studioNames?: string[];
};

type MediaBrandMatcher = {
    definition: MediaBrandDefinition;
    getScore: (item: unknown) => number;
    matches: (item: unknown) => boolean;
    searchTerms: string[];
    studioKeywords: string[];
    studioNames: string[];
};

const ANIMATION_SUPPORT_KEYWORDS = [
    'animation',
    'animated',
    'cartoon',
    'family',
    'children',
    'kids'
];

const DISNEY_TITLE_MATCHES: BrandTitleMatch[] = [
    { aliases: ['lion king', 'the lion king'] },
    { aliases: ['frozen'], needsSignal: true },
    { aliases: ['moana'] },
    { aliases: ['aladdin'], needsSignal: true },
    { aliases: ['little mermaid', 'the little mermaid'] },
    { aliases: ['beauty and the beast'] },
    { aliases: ['mulan'], needsSignal: true },
    { aliases: ['hercules'], needsSignal: true },
    { aliases: ['tarzan'], needsSignal: true },
    { aliases: ['lilo and stitch', 'lilo stitch'] },
    { aliases: ['tangled'], needsSignal: true },
    { aliases: ['zootopia'] },
    { aliases: ['encanto'] },
    { aliases: ['wreck it ralph', 'wreckit ralph'] },
    { aliases: ['goof troop'] },
    { aliases: ['talespin', 'tale spin'] },
    { aliases: ['ducktales', 'duck tales', 'disneys ducktales'] },
    { aliases: ['quack pack'] },
    { aliases: ['darkwing duck'] },
    { aliases: ['chip n dale', 'chip and dale', 'chip dale'] },
    { aliases: ['gargoyles'] },
    { aliases: ['recess'], needsSignal: true },
    { aliases: ['kim possible'] },
    { aliases: ['proud family', 'the proud family'] },
    { aliases: ['gravity falls'] },
    { aliases: ['phineas and ferb'] },
    { aliases: ['american dragon'] },
    { aliases: ['house of mouse'] }
];

const MEDIA_BRAND_DEFINITIONS = {
    disney: {
        id: 'disney',
        title: 'Disney Cartoons & Animation',
        minScore: 6,
        searchTerms: [
            'Walt Disney Animation',
            'Disney Television Animation',
            'DisneyToon',
            'Pixar',
            'Disney Channel',
            'Disney Junior',
            'Lion King',
            'Frozen',
            'Moana',
            'Aladdin',
            'Little Mermaid',
            'Beauty and the Beast',
            'Mulan',
            'Hercules',
            'Tarzan',
            'Lilo & Stitch',
            'Tangled',
            'Zootopia',
            'Encanto',
            'Wreck-It Ralph',
            'Goof Troop',
            'TaleSpin',
            'DuckTales',
            'Quack Pack',
            'Darkwing Duck',
            'Chip n Dale',
            'Gargoyles',
            'Recess',
            'Kim Possible',
            'Proud Family',
            'Gravity Falls',
            'Phineas and Ferb',
            'American Dragon',
            'House of Mouse'
        ],
        strongKeywords: [
            'walt disney',
            'disney animation',
            'disney feature animation',
            'disney television animation',
            'disneytoon',
            'disney channel',
            'disney junior',
            'buena vista'
        ],
        studioKeywords: [
            'walt disney',
            'disney animation',
            'disney feature animation',
            'disney television animation',
            'disney channel',
            'disney junior',
            'disneytoon',
            'pixar',
            'blue sky'
        ],
        studioNames: [
            'Walt Disney Animation Studios',
            'Walt Disney Feature Animation',
            'Walt Disney Television Animation',
            'Disney Television Animation',
            'DisneyToon Studios',
            'Walt Disney Pictures',
            'Pixar',
            'Pixar Animation Studios',
            'Disney Channel',
            'Disney Junior',
            'Blue Sky Studios'
        ],
        supportingKeywords: [
            ...ANIMATION_SUPPORT_KEYWORDS,
            'pixar',
            'blue sky'
        ],
        titleMatches: DISNEY_TITLE_MATCHES
    },
    pixar: {
        id: 'pixar',
        title: 'Pixar',
        minScore: 5,
        searchTerms: ['Pixar', 'Toy Story', 'Finding Nemo', 'Cars', 'Monsters Inc', 'Inside Out', 'Incredibles'],
        strongKeywords: ['pixar'],
        studioKeywords: ['pixar'],
        studioNames: ['Pixar', 'Pixar Animation Studios'],
        supportingKeywords: ANIMATION_SUPPORT_KEYWORDS,
        titleMatches: [
            { aliases: ['toy story'] },
            { aliases: ['finding nemo'] },
            { aliases: ['finding dory'] },
            { aliases: ['cars'], needsSignal: true },
            { aliases: ['monsters inc', 'monsters university'] },
            { aliases: ['inside out'] },
            { aliases: ['the incredibles', 'incredibles'] },
            { aliases: ['ratatouille'] },
            { aliases: ['wall e', 'walle'] },
            { aliases: ['up'], needsSignal: true },
            { aliases: ['coco'], needsSignal: true },
            { aliases: ['brave'], needsSignal: true },
            { aliases: ['elemental'], needsSignal: true }
        ]
    },
    marvel: {
        id: 'marvel',
        title: 'Marvel',
        minScore: 5,
        searchTerms: ['Marvel', 'Avengers', 'Spider-Man', 'X-Men', 'Guardians of the Galaxy'],
        strongKeywords: ['marvel', 'mcu', 'avengers'],
        studioKeywords: ['marvel'],
        studioNames: ['Marvel Studios', 'Marvel Entertainment'],
        titleMatches: [
            { aliases: ['avengers'] },
            { aliases: ['spider man', 'spiderman'], needsSignal: true },
            { aliases: ['x men', 'xmen'], needsSignal: true },
            { aliases: ['guardians of the galaxy'] }
        ]
    },
    dc: {
        id: 'dc',
        title: 'DC',
        minScore: 5,
        searchTerms: ['DC Comics', 'Batman', 'Superman', 'Justice League'],
        strongKeywords: ['dc comics', 'dc entertainment', 'warner bros animation'],
        studioKeywords: ['dc entertainment', 'warner bros animation'],
        studioNames: ['DC Entertainment', 'DC Studios', 'Warner Bros. Animation'],
        titleMatches: [
            { aliases: ['batman'], needsSignal: true },
            { aliases: ['superman'], needsSignal: true },
            { aliases: ['justice league'] },
            { aliases: ['teen titans'] }
        ]
    },
    anime: {
        id: 'anime',
        title: 'Anime',
        minScore: 2,
        searchTerms: ['Anime', 'Manga', 'Crunchyroll', 'Funimation', 'Toonami', 'Toei Animation', 'Studio Pierrot', 'MAPPA'],
        strongKeywords: ['anime', 'manga', 'crunchyroll', 'funimation', 'toonami'],
        studioKeywords: [
            'toei animation',
            'mappa',
            'bones',
            'madhouse',
            'studio pierrot',
            'trigger',
            'a 1 pictures',
            'kyoto animation',
            'sunrise',
            'production i g',
            'ufotable',
            'shaft',
            'wit studio',
            'cloverworks'
        ],
        studioNames: [
            'Toei Animation',
            'MAPPA',
            'Bones',
            'Madhouse',
            'Studio Pierrot',
            'Trigger',
            'A-1 Pictures',
            'Kyoto Animation',
            'Sunrise',
            'Production I.G',
            'Ufotable',
            'Shaft',
            'Wit Studio',
            'CloverWorks'
        ],
        supportingKeywords: ['anime', 'manga', 'animation', 'animated', 'japan', 'japanese']
    },
    studioGhibli: {
        id: 'studioGhibli',
        title: 'Studio Ghibli',
        minScore: 5,
        searchTerms: ['Studio Ghibli', 'Hayao Miyazaki', 'Spirited Away', 'Totoro'],
        strongKeywords: ['studio ghibli', 'ghibli', 'hayao miyazaki'],
        studioKeywords: ['studio ghibli'],
        studioNames: ['Studio Ghibli'],
        supportingKeywords: ['animation', 'animated', 'anime'],
        titleMatches: [
            { aliases: ['spirited away'] },
            { aliases: ['my neighbor totoro', 'totoro'] },
            { aliases: ['princess mononoke'] },
            { aliases: ['howls moving castle'] },
            { aliases: ['kikis delivery service'] }
        ]
    }
} satisfies Record<string, MediaBrandDefinition>;

function isRecord(value: unknown): value is MatchableRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeBrandText(value: unknown) {
    return String(value || '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getTextValue(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
    }

    if (isRecord(value) && typeof value.Name === 'string') {
        return value.Name;
    }

    return '';
}

function getArrayText(value: unknown) {
    if (!Array.isArray(value)) return '';

    return value
        .map(getTextValue)
        .filter(Boolean)
        .join(' ');
}

function getRecordText(value: unknown) {
    if (!isRecord(value)) return '';

    return Object.keys(value)
        .flatMap(key => [key, getTextValue(value[key])])
        .filter(Boolean)
        .join(' ');
}

function includesPhrase(text: string, phrase: string) {
    if (!text || !phrase) return false;

    return text === phrase
        || text.startsWith(`${phrase} `)
        || text.endsWith(` ${phrase}`)
        || text.includes(` ${phrase} `);
}

function getTitleFields(item: MatchableRecord) {
    return [
        item.Name,
        item.OriginalTitle,
        item.SeriesName
    ]
        .map(normalizeBrandText)
        .filter(Boolean);
}

function getMetadataBuckets(item: MatchableRecord) {
    const studioText = normalizeBrandText(getArrayText(item.Studios));
    const providerText = normalizeBrandText(getRecordText(item.ProviderIds));
    const productionText = normalizeBrandText(getArrayText(item.ProductionLocations));
    const genreTagText = normalizeBrandText([
        getArrayText(item.Genres),
        getArrayText(item.Tags)
    ].filter(Boolean).join(' '));
    const titleText = getTitleFields(item).join(' ');
    const collectionText = normalizeBrandText([
        item.CollectionName,
        item.CollectionType,
        item.ParentName,
        getArrayText(item.Collections)
    ].filter(Boolean).join(' '));

    return {
        allText: normalizeBrandText([
            studioText,
            providerText,
            productionText,
            genreTagText,
            titleText,
            collectionText
        ].filter(Boolean).join(' ')),
        collectionText,
        genreTagText,
        productionText,
        providerText,
        studioText,
        titleFields: getTitleFields(item)
    };
}

function countKeywordMatches(text: string, keywords: string[]) {
    return keywords.reduce((count, keyword) => {
        const normalizedKeyword = normalizeBrandText(keyword);

        return includesPhrase(text, normalizedKeyword) || text.includes(normalizedKeyword) ?
            count + 1 :
            count;
    }, 0);
}

function isMovieOrSeries(item: MatchableRecord) {
    const type = normalizeBrandText(item.Type);

    return !type || type === 'movie' || type === 'series';
}

function getTitleMatchScore(
    titleFields: string[],
    titleMatches: BrandTitleMatch[],
    hasSupportingSignal: boolean
) {
    return titleMatches.reduce((score, match) => {
        const matched = titleFields.some(title =>
            match.aliases.some(alias => includesPhrase(title, normalizeBrandText(alias)))
        );

        if (!matched || (match.needsSignal && !hasSupportingSignal)) return score;

        return score + (match.score || 4);
    }, 0);
}

export function scoreMediaBrandItem(item: unknown, definition: MediaBrandDefinition) {
    if (!isRecord(item) || !isMovieOrSeries(item)) return 0;

    const buckets = getMetadataBuckets(item);
    const strongKeywords = definition.strongKeywords || [];
    const supportingKeywords = definition.supportingKeywords || [];
    const titleMatches = definition.titleMatches || [];
    const strongScore = (
        countKeywordMatches(buckets.studioText, strongKeywords) * 5
        + countKeywordMatches(buckets.providerText, strongKeywords) * 4
        + countKeywordMatches(buckets.productionText, strongKeywords) * 3
        + countKeywordMatches(buckets.genreTagText, strongKeywords) * 2
        + countKeywordMatches(buckets.collectionText, strongKeywords) * 3
    );
    const supportingScore = (
        countKeywordMatches(buckets.genreTagText, supportingKeywords) * 2
        + countKeywordMatches(buckets.allText, supportingKeywords)
    );
    const hasSupportingSignal = strongScore > 0 || supportingScore > 0;
    const titleScore = getTitleMatchScore(buckets.titleFields, titleMatches, hasSupportingSignal);

    return strongScore + supportingScore + titleScore;
}

function createMediaBrandMatcher(definition: MediaBrandDefinition): MediaBrandMatcher {
    return {
        definition,
        getScore: (item: unknown) => scoreMediaBrandItem(item, definition),
        matches: (item: unknown) => scoreMediaBrandItem(item, definition) >= definition.minScore,
        searchTerms: definition.searchTerms,
        studioKeywords: definition.studioKeywords || definition.strongKeywords,
        studioNames: definition.studioNames || []
    };
}

const FAMILY_ANIMATION_KEYWORDS = [
    'animation',
    'animated',
    'cartoon',
    'walt disney animation',
    'disney television animation',
    'pixar',
    'dreamworks animation',
    'illumination',
    'studio ghibli',
    'cartoon network',
    'nickelodeon'
];

const FAMILY_AUDIENCE_KEYWORDS = [
    'family',
    'children',
    'kids',
    'disney',
    'pixar',
    'dreamworks',
    'illumination',
    'cartoon network',
    'nickelodeon',
    'disney channel',
    'disney junior'
];

const ADULT_ANIMATION_EXCLUSION_KEYWORDS = [
    'adult animation',
    'adult swim',
    'mature',
    'tv ma'
];

export function isFamilyAnimationItem(item: unknown) {
    if (!isRecord(item) || !isMovieOrSeries(item)) return false;

    const buckets = getMetadataBuckets(item);
    const metadataText = normalizeBrandText([
        buckets.studioText,
        buckets.providerText,
        buckets.productionText,
        buckets.genreTagText,
        buckets.collectionText
    ].filter(Boolean).join(' '));
    const animationScore = countKeywordMatches(metadataText, FAMILY_ANIMATION_KEYWORDS);
    const familyScore = countKeywordMatches(metadataText, FAMILY_AUDIENCE_KEYWORDS);
    const adultScore = countKeywordMatches(metadataText, ADULT_ANIMATION_EXCLUSION_KEYWORDS);

    return animationScore > 0 && familyScore > 0 && adultScore === 0;
}

export const mediaBrandMatchers = Object.keys(MEDIA_BRAND_DEFINITIONS).reduce<Record<string, MediaBrandMatcher>>(
    (matchers, brandId) => {
        const definition = MEDIA_BRAND_DEFINITIONS[brandId as keyof typeof MEDIA_BRAND_DEFINITIONS];

        matchers[brandId] = createMediaBrandMatcher(definition);

        return matchers;
    },
    {}
);

export const DISNEY_ANIMATION_SEARCH_TERMS = mediaBrandMatchers.disney.searchTerms;

export function isDisneyAnimationItem(item: unknown) {
    return mediaBrandMatchers.disney.matches(item);
}

export function isAnimeItem(item: unknown) {
    return mediaBrandMatchers.anime.matches(item);
}
