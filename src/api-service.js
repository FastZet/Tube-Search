// src/api-service.js
const http = require('./http-client');
const config = require('./config');

const { tmdb: tmdbConfig, omdb: omdbConfig } = config.api;

/**
 * A resilient request function that retries on failure.
 * @param {string} url The URL to request.
 * @returns {Promise<object>} The response data.
 */
const _makeRequest = async (url) => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000; // 2 seconds in ms

    let lastError;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const res = await http.get(url);
            return res.data; // Success, return immediately
        } catch (error) {
            lastError = error;
            console.warn(`[API_SERVICE] Attempt ${i + 1} of ${MAX_RETRIES} failed for ${url}: ${error.message}`);
            if (i < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            }
        }
    }
    // If all retries failed, throw the last captured error
    console.error(`[API_SERVICE] All ${MAX_RETRIES} attempts failed for ${url}.`);
    throw lastError;
};

/**
 * Fetches metadata from TMDb and OMDb APIs in parallel.
 * This function will now throw an error if any critical API fails.
 * @param {string} type - 'movie' or 'series'.
 * @param {string} id - Stremio ID (e.g., 'tt0414762:1:4').
 * @param {object} log - A logging object with a step counter.
 * @returns {Promise<object>}
 */
const getMetadata = async (type, id, log) => {
    const tmdbApiKey = process.env.TMDB_API_KEY || '';
    const omdbApiKey = process.env.OMDB_API_KEY || '';

    if (!tmdbApiKey) {
        throw new Error('TMDB_API_KEY environment variable is not set.');
    }

    let { imdbId, tmdbId, season, episode } = _parseStremioId(type, id);

    const metadata = {
        imdbId,
        tmdbId,
        title: null,
        year: null,
        runtime: null,
        episodeTitle: null,
        season,
        episode,
    };

    // Use TMDb to find the ID if we only have an IMDb ID
    if (imdbId && !tmdbId) {
        log.step(`Querying TMDb's find API for IMDB ID: ${imdbId}...`);
        const findUrl = `${tmdbConfig.baseUrl}/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`;
        const response = await _makeRequest(findUrl);
        const results = type === 'movie' ? response?.movie_results : response?.tv_results;
        if (results && results.length > 0) {
            metadata.tmdbId = results[0].id;
            tmdbId = results[0].id;
            log.step(`TMDb found a matching ID: ${tmdbId}`);
        } else {
            log.step(`TMDb's find API returned no results for ${imdbId}.`);
        }
    }

    const promises = [];
    if (tmdbId) {
        const tmdbUrl = `${tmdbConfig.baseUrl}/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
        log.step(`Querying TMDb metadata endpoint for ID: ${tmdbId}...`);
        promises.push(_makeRequest(tmdbUrl));
    } else {
        promises.push(Promise.resolve(null));
    }

    if (imdbId && omdbApiKey) {
        const omdbUrl = `${omdbConfig.baseUrl}?apikey=${omdbApiKey}&i=${imdbId}`;
        log.step(`Querying OMDb for IMDB ID: ${imdbId}...`);
        promises.push(_makeRequest(omdbUrl));
    } else {
        promises.push(Promise.resolve(null));
    }

    const [tmdbResult, omdbResult] = await Promise.all(promises);

    if (tmdbResult) {
        log.step('TMDb request successful. Populating metadata...');
        _populateFromTMDb(metadata, tmdbResult, type);
    }
    if (omdbResult) {
        log.step('OMDb request successful. Populating metadata...');
        _populateFromOMDb(metadata, omdbResult);
    }

    if (!metadata.title) {
        throw new Error('Failed to retrieve a title from TMDb or OMDb. Cannot proceed.');
    }

    return metadata;
};

const _populateFromTMDb = (metadata, tmdbData, type) => {
    if (!tmdbData) return;
    metadata.title = metadata.title || (type === 'movie' ? tmdbData.title : tmdbData.name);
    const releaseDate = type === 'movie' ? tmdbData.release_date : tmdbData.first_air_date;
    if (releaseDate) metadata.year = metadata.year || new Date(releaseDate).getFullYear();
    metadata.runtime = metadata.runtime || tmdbData.runtime || (tmdbData.episode_run_time ? tmdbData.episode_run_time[0] : null);
    metadata.imdbId = metadata.imdbId || tmdbData.external_ids?.imdb_id;
};

const _populateFromOMDb = (metadata, omdbData) => {
    if (!omdbData || omdbData.Response !== 'True') return;
    metadata.title = metadata.title || omdbData.Title;
    if (omdbData.Year) metadata.year = metadata.year || parseInt(omdbData.Year.substring(0, 4));
    if (omdbData.Runtime && omdbData.Runtime !== 'N/A') metadata.runtime = metadata.runtime || parseInt(omdbData.Runtime);
};

const _parseStremioId = (type, id) => {
    const result = { imdbId: null, tmdbId: null, season: null, episode: null };
    const parts = id.split(':');
    if (id.startsWith('tt')) {
        result.imdbId = parts[0];
    } else {
        result.tmdbId = parts[0];
    }
    if (type === 'series' && parts.length === 3) {
        result.season = parts[1];
        result.episode = parts[2];
    }
    return result;
};

module.exports = { getMetadata };
