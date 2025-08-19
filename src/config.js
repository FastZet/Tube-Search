// src/config.js

const config = {
    // Server Configuration
    server: {
        port: process.env.PORT || 7860,
        // Restrict origins in production for better security
        corsOrigins: process.env.NODE_ENV === 'production' ? ['https://your-production-domain.com'] : ['*'],
    },

    // API and external service configurations
    api: {
        tmdb: {
            baseUrl: 'https://api.themoviedb.org/3',
        },
        omdb: {
            baseUrl: 'http://www.omdbapi.com/',
        },
        imdb: {
            episodesUrl: (imdbId, season) => `https://www.imdb.com/title/${imdbId}/episodes?season=${season}`,
        },
        // Default timeout for all external HTTP requests
        defaultTimeout: 8000, // 8 seconds
    },

    // Logging Configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info', // 'debug', 'info', 'warn', 'error'
        // Enable detailed scoring logs only in development for cleaner production logs
        enableDetailedScoring: process.env.NODE_ENV !== 'production',
    },

    // Caching Configuration (for future implementation)
    cache: {
        ttl: {
            metadata: 60 * 60 * 1000, // 1 hour in ms
            searchResults: 30 * 60 * 1000, // 30 minutes in ms
        },
        maxSize: 100, // Max number of items in cache
    },

    // Rate Limiting Configuration (for future implementation)
    rateLimiting: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 100, // Max requests per IP per window
    },

    // Web scraping settings
    scraping: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        googleSearchUrl: 'https://www.google.com/search',
        whitelistedDomains: [
            'youtube.com', 
            'dailymotion.com', 
            'vimeo.com', 
            'archive.org', 
            'facebook.com', 
            'ok.ru'
        ],
        // Using arrays to allow for fallback selectors if a layout changes
        selectors: {
            google: {
                resultItem: ['div.vt6azd', 'div.g'],
                link: ['a'],
                title: ['h3.LC20lb', 'h3'],
                source: ['cite'],
                duration: ['.c8rnLc span, .O1CVkc'],
            },
            imdb: {
                episodeListItem: ['div.list_item'],
                episodeNumber: ['meta[itemprop="episodeNumber"]'],
                episodeTitle: ['a[itemprop="name"]'],
            },
        },
    },

    // Scoring algorithm weights and tolerances
    scoring: {
        weights: {
            GOOGLE_RANK_BONUS: 5,
            TITLE_MATCH: 6,
            TITLE_PARTIAL_MISMATCH_PENALTY: -5,
            EPISODE_NUMBER_MATCH: 5,
            EPISODE_TITLE_MATCH: 5,
            SEASON_NUMBER_BONUS: 2,
            DURATION_MATCH: 6,
            DURATION_MISMATCH_PENALTY: -10,
            WHITELIST_BONUS: 1,
        },
        tolerances: {
            MOVIE_DURATION_MINS: 20,
            SERIES_DURATION_MINS: 3,
        },
    },
};

module.exports = config;
