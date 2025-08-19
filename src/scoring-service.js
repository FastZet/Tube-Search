// src/scoring-service.js

const config = require('./config');

const { weights, tolerances } = config.scoring;

/**
 * Parses a duration string (e.g., "1:30:00" or "90:00") into total minutes.
 * @param {string} durationStr - The duration string from scraping.
 * @returns {number|null} The total duration in minutes, or null if parsing fails.
 */
const _parseDurationToMinutes = (durationStr) => {
    if (!durationStr || typeof durationStr !== 'string') return null;

    const parts = durationStr.split(':').map(Number);
    let minutes = 0;

    if (parts.length === 3) { // HH:MM:SS
        minutes = (parts[0] * 60) + parts[1] + (parts[2] / 60);
    } else if (parts.length === 2) { // MM:SS
        minutes = parts[0] + (parts[1] / 60);
    } else {
        return null;
    }

    return isNaN(minutes) ? null : minutes;
};

/**
 * Calculates a relevance score for a scraped video result.
 * @param {object} result - The scraped result object { title, url, source, duration, index }.
 * @param {object} metadata - The consolidated metadata object from the API service.
 * @param {string} type - The content type ('movie' or 'series').
 * @returns {{score: number, breakdown: object}} An object containing the final score and a detailed breakdown.
 */
const calculateScore = (result, metadata, type) => {
    const lowerTitle = result.title.toLowerCase();
    const lowerQueryTitle = metadata.title.toLowerCase();
    const lowerEpisodeTitle = metadata.episodeTitle ? metadata.episodeTitle.toLowerCase() : '';

    const breakdown = {
        googleRank: 0,
        title: 0,
        episodeNum: 0,
        episodeTitle: 0,
        season: 0,
        duration: 0,
        whitelist: 0,
        durationDiff: null, // For logging purposes only
    };

    // 1. Google Rank Bonus
    breakdown.googleRank = Math.max(0, weights.GOOGLE_RANK_BONUS - result.index);

    // 2. Title Match
    if (lowerTitle.includes(lowerQueryTitle)) {
        breakdown.title = weights.TITLE_MATCH;
    } else {
        const queryWords = lowerQueryTitle.split(' ');
        const matchedWords = queryWords.filter(word => lowerTitle.includes(word));
        breakdown.title = weights.TITLE_MATCH * (matchedWords.length / queryWords.length);
        if (queryWords.length > 2 && matchedWords.length < queryWords.length - 1) {
            breakdown.title += weights.TITLE_PARTIAL_MISMATCH_PENALTY;
        }
    }

    // 3. Episode & Season Score (for series only)
    if (type === 'series') {
        const epNum = parseInt(metadata.episode, 10);
        const seasonNum = parseInt(metadata.season, 10);
        const episodeNumRegex = new RegExp(`episode\\s+0?${epNum}|e0?${epNum}`, 'i');
        const seasonMatchRegex = new RegExp(`season\\s+0?${seasonNum}|s0?${seasonNum}`, 'i');

        if (episodeNumRegex.test(lowerTitle)) {
            breakdown.episodeNum = weights.EPISODE_NUMBER_MATCH;
        }
        if (lowerEpisodeTitle && lowerTitle.includes(lowerEpisodeTitle)) {
            breakdown.episodeTitle = weights.EPISODE_TITLE_MATCH;
        }
        if (seasonMatchRegex.test(lowerTitle)) {
            breakdown.season = weights.SEASON_NUMBER_BONUS;
        }
    }

    // 4. Duration Match
    if (metadata.runtime > 0) {
        const scrapedMinutes = _parseDurationToMinutes(result.duration);
        if (scrapedMinutes) {
            const tolerance = type === 'movie' ? tolerances.MOVIE_DURATION_MINS : tolerances.SERIES_DURATION_MINS;
            const diff = Math.abs(scrapedMinutes - metadata.runtime);
            breakdown.durationDiff = diff; // Store for logging

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
        // Only sum the numeric score components, ignoring durationDiff
        return typeof val === 'number' && val !== breakdown.durationDiff ? acc + val : acc;
    }, 0);

    return { score, breakdown };
};

module.exports = {
    calculateScore,
};
