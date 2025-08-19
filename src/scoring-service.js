// src/scoring-service.js

const config = require('./config');

const { weights, tolerances } = config.scoring;

/**
 * Calculates a match score between two strings based on word overlap.
 * @param {string} titleStr - The title string of the scraped result.
 * @param {string} queryStr - The ideal title string we are looking for.
 * @returns {number} A score from 0 to 1 representing the match percentage.
 */
const _calculateWordMatchScore = (titleStr, queryStr) => {
    if (!queryStr || !titleStr) return 0;
    
    // Normalize by making lowercase and removing punctuation
    const normalize = (str) => str.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
    
    const titleWords = new Set(normalize(titleStr));
    const queryWords = normalize(queryStr);
    
    if (queryWords.length === 0) return 0;

    const matchedWords = queryWords.filter(word => titleWords.has(word));
    return matchedWords.length / queryWords.length;
};

const _parseDurationToMinutes = (durationStr) => {
    // ... function is unchanged ...
    if (!durationStr || typeof durationStr !== 'string') return null;
    const parts = durationStr.split(':').map(Number);
    let minutes = 0;
    if (parts.length === 3) { minutes = (parts[0] * 60) + parts[1] + (parts[2] / 60); }
    else if (parts.length === 2) { minutes = parts[0] + (parts[1] / 60); }
    else { return null; }
    return isNaN(minutes) ? null : minutes;
};

const calculateScore = (result, metadata, type) => {
    const breakdown = {
        googleRank: 0,
        title: 0,
        episodeNum: 0,
        episodeTitle: 0,
        season: 0,
        duration: 0,
        whitelist: 0,
        durationDiff: null,
    };

    // 1. Google Rank Bonus
    breakdown.googleRank = Math.max(0, weights.GOOGLE_RANK_BONUS - result.index);

    // 2. Title Match (NEW LOGIC)
    const titleMatchScore = _calculateWordMatchScore(result.title, metadata.title);
    breakdown.title = titleMatchScore * weights.TITLE_MATCH;
    // Penalize if less than 50% of the words match
    if (titleMatchScore < 0.5) {
        breakdown.title += weights.TITLE_PARTIAL_MISMATCH_PENALTY;
    }

    // 3. Episode & Season Score
    if (type === 'series') {
        const epNum = parseInt(metadata.episode, 10);
        const seasonNum = parseInt(metadata.season, 10);
        const episodeNumRegex = new RegExp(`episode\\s+0?${epNum}|e0?${epNum}`, 'i');
        const seasonMatchRegex = new RegExp(`season\\s+0?${seasonNum}|s0?${seasonNum}`, 'i');

        if (episodeNumRegex.test(result.title)) {
            breakdown.episodeNum = weights.EPISODE_NUMBER_MATCH;
        }

        // Episode Title Match (NEW LOGIC)
        if (metadata.episodeTitle) {
            const episodeTitleMatchScore = _calculateWordMatchScore(result.title, metadata.episodeTitle);
            breakdown.episodeTitle = episodeTitleMatchScore * weights.EPISODE_TITLE_MATCH;
        }

        if (seasonMatchRegex.test(result.title)) {
            breakdown.season = weights.SEASON_NUMBER_BONUS;
        }
    }

    // 4. Duration Match
    if (metadata.runtime > 0) {
        const scrapedMinutes = _parseDurationToMinutes(result.duration);
        if (scrapedMinutes) {
            const tolerance = type === 'movie' ? tolerances.MOVIE_DURATION_MINS : tolerances.SERIES_DURATION_MINS;
            const diff = Math.abs(scrapedMinutes - metadata.runtime);
            breakdown.durationDiff = diff;

            if (diff <= tolerance) {
                breakdown.duration = weights.DURATION_MATCH * (1 - (diff / tolerance));
            } else {
                breakdown.duration = weights.DURATION_MISMATCH_PENALTY;
            }
        }
    }

    // 5. Whitelist Bonus
    if (config.scraping.whitelistedDomains.some(domain => result.url.includes(domain))) {
        breakdown.whitelist = weights.WHITELIST_BONUS;
    }

    // Final Score Calculation
    const score = Object.values(breakdown).reduce((acc, val) => {
        return typeof val === 'number' && val !== breakdown.durationDiff ? acc + val : acc;
    }, 0);

    return { score, breakdown };
};

module.exports = {
    calculateScore,
};
