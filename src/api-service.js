// src/api-service.js

const http = require('./http-client');
const config = require('./config');

const { tmdb: tmdbConfig, omdb: omdbConfig } = config.api;

/**
 * Fetches metadata from TMDb and OMDb APIs in parallel.
 * @param {string} type - The content type ('movie' or 'series').
 * @param {string} id - The Stremio ID (e.g., 'tt0414762:1:4').
 * @returns {Promise<object>} A promise that resolves to a consolidated metadata object.
 */
const getMetadata = async (type, id) => {
    const tmdbApiKey = process.env.TMDB_API_KEY || '';
    const omdbApiKey = process.env.OMDB_API_KEY || '';

    if (!tmdbApiKey) {
        throw new Error('[API_SERVICE] TMDB_API_KEY env var is required.');
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

    try {
        if (imdbId && !tmdbId) {
            const findUrl = `${tmdbConfig.baseUrl}/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`;
            const response = await _makeRequest(findUrl);
            const results = type === 'movie' ? response?.movie_results : response?.tv_results;
            if (results && results.length > 0) {
                metadata.tmdbId = results.id;
                tmdbId = results.id;
            }
        }

        const promises = [];

        if (tmdbId) {
            const tmdbUrl = `${tmdbConfig.baseUrl}/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
            promises.push(_makeRequest(tmdbUrl));
        } else {
            promises.push(Promise.resolve(null));
        }

        if (imdbId && omdbApiKey) {
            const omdbUrl = `${omdbConfig.baseUrl}?apikey=${omdbApiKey}&i=${imdbId}`;
            promises.push(_makeRequest(omdbUrl));
        } else {
            promises.push(Promise.resolve(null));
        }

        const [tmdbResult, omdbResult] = await Promise.all(promises);

        _populateFromTMDb(metadata, tmdbResult, type);
        _populateFromOMDb(metadata, omdbResult);

    } catch (error) {
        console.error(`[API_SERVICE] An error occurred during metadata fetching: ${error.message}`);
    }

    return metadata;
};

// --- Private Helper Functions ---

const _makeRequest = async (url) => {
    try {
        const response = await http.get(url);
        return response.data;
    } catch (error) {
        console.warn(`[API_SERVICE] Request to ${url} failed: ${error.message}`);
        return null;
    }
};

const _populateFromTMDb = (metadata, tmdbData, type) => {
    if (!tmdbData) return;
    metadata.title = metadata.title || (type === 'movie' ? tmdbData.title : tmdbData.name);
    const releaseDate = type === 'movie' ? tmdbData.release_date : tmdbData.first_air_date;
    if (releaseDate) {
        metadata.year = metadata.year || new Date(releaseDate).getFullYear();
    }
    metadata.runtime = metadata.runtime || tmdbData.runtime || (tmdbData.episode_run_time ? tmdbData.episode_run_time : null);
    metadata.imdbId = metadata.imdbId || tmdbData.external_ids?.imdb_id;
};

const _populateFromOMDb = (metadata, omdbData) => {
    if (!omdbData || omdbData.Response !== 'True') return;
    metadata.title = metadata.title || omdbData.Title;
    if (omdbData.Year) {
        metadata.year = metadata.year || parseInt(omdbData.Year.substring(0, 4));
    }
    if (omdbData.Runtime && omdbData.Runtime !== 'N/A') {
        metadata.runtime = metadata.runtime || parseInt(omdbData.Runtime);
    }
};

const _parseStremioId = (type, id) => {
    const result = { imdbId: null, tmdbId: null, season: null, episode: null };
    const parts = id.split(':');
    
    if (id.startsWith('tt')) {
        result.imdbId = parts;
    } else {
        result.tmdbId = parts;
    }
    
    if (type === 'series') {
        result.season = parts[1];
        result.episode = parts[5];
    }
    return result;
};

module.exports = {
    getMetadata,
};
