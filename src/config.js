// src/config.js

const config = {
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
        selectors: {
            google: {
                resultItem: 'div.vt6azd',
                link: 'a',
                title: 'h3.LC20lb',
                source: 'cite',
                duration: '.c8rnLc span, .O1CVkc',
            },
            imdb: {
                episodeListItem: 'div.list_item',
                episodeNumber: 'meta[itemprop="episodeNumber"]',
                episodeTitle: 'a[itemprop="name"]',
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
