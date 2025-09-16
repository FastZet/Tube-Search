// src/api-service.js
const http = require('./http-client');
const config = require('./config');
const cheerio = require('cheerio');

const { tmdb: tmdbConfig, omdb: omdbConfig } = config.api;

/**
 * A resilient request function that retries on failure.
 * @param {string} url The URL to request.
 * @returns {Promise<object|null>} The response data or null if all attempts fail.
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
    // Return null instead of throwing to allow graceful degradation
    console.error(`[API_SERVICE] All ${MAX_RETRIES} attempts failed for ${url}: ${lastError?.message}`);
    return null;
};

/**
 * Scrapes IMDb title page to extract basic movie information
 * @param {string} imdbId - The IMDb ID (e.g., 'tt26581740')
 * @returns {Promise<object|null>} Basic metadata or null if scraping fails
 */
const _scrapeImdbTitle = async (imdbId) => {
    try {
        const url = `https://www.imdb.com/title/${imdbId}/`;
        const response = await http.get(url, {
            headers: { 
                'User-Agent': config.scraping.userAgent,
                'Accept-Language': 'en-US,en;q=0.5'
            },
        });
        
        const $ = cheerio.load(response.data);
        
        // Extract title - try multiple selectors
        let title = null;
        const titleSelectors = [
            'h1[data-testid="hero__pageTitle"] span.hero__primary-text',
            'h1.sc-afe43def-0',
            'h1[data-testid="hero-title-block__title"]',
            'h1 .titlereference-title-link',
            'h1'
        ];
        
        for (const selector of titleSelectors) {
            const titleEl = $(selector).first();
            if (titleEl.length > 0) {
                title = titleEl.text().trim();
                if (title) break;
            }
        }
        
        // Extract year - try multiple approaches
        let year = null;
        const yearSelectors = [
            'span.sc-afe43def-1',
            'ul[data-testid="hero-title-block__metadata"] li.ipc-inline-list__item:first-child a',
            'ul[data-testid="hero-title-block__metadata"] li:first-child',
            'a[title*="See more release dates"]'
        ];
        
        for (const selector of yearSelectors) {
            const yearEl = $(selector).first();
            if (yearEl.length > 0) {
                const yearText = yearEl.text().trim();
                const yearMatch = yearText.match(/(\d{4})/);
                if (yearMatch) {
                    year = parseInt(yearMatch[1], 10);
                    break;
                }
            }
        }
        
        // Extract runtime if available
        let runtime = null;
        const runtimeSelectors = [
            'li[data-testid="title-techspec_runtime"] div.ipc-metadata-list-item__content-container',
            'time[datetime]'
        ];
        
        for (const selector of runtimeSelectors) {
            const runtimeEl = $(selector).first();
            if (runtimeEl.length > 0) {
                const runtimeText = runtimeEl.text().trim();
                const runtimeMatch = runtimeText.match(/(\d+)\s*(?:min|minutes)/i);
                if (runtimeMatch) {
                    runtime = parseInt(runtimeMatch[1], 10);
                    break;
                }
            }
        }
        
        if (title) {
            console.log(`[API_SERVICE] Successfully scraped IMDb: "${title}" (${year || 'N/A'})`);
            return { title, year, runtime };
        }
        
        return null;
    } catch (error) {
        console.error(`[API_SERVICE] IMDb scraping failed for ${imdbId}: ${error.message}`);
        return null;
    }
};

/**
 * Creates emergency fallback metadata when all other sources fail
 * @param {string} imdbId - The IMDb ID
 * @param {string} type - 'movie' or 'series'
 * @returns {object} Basic fallback metadata
 */
const _createFallbackMetadata = (imdbId, type) => {
    const currentYear = new Date().getFullYear();
    return {
        imdbId,
        tmdbId: null,
        title: `${type === 'movie' ? 'Movie' : 'Series'} ${imdbId}`,
        year: currentYear, // Use current year as fallback
        runtime: null,
        episodeTitle: null,
        season: null,
        episode: null,
    };
};

/**
 * Fetches metadata from multiple sources with graceful degradation.
 * This function tries TMDb, OMDb, IMDb scraping, and finally creates fallback metadata.
 * @param {string} type - 'movie' or 'series'.
 * @param {string} id - Stremio ID (e.g., 'tt0414762:1:4').
 * @param {object} log - A logging object with a step counter.
 * @returns {Promise<object>}
 */
const getMetadata = async (type, id, log) => {
    const tmdbApiKey = process.env.TMDB_API_KEY || '';
    const omdbApiKey = process.env.OMDB_API_KEY || '';

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

    let sourceUsed = [];

    // PHASE 1: Try TMDb (preferred source)
    if (tmdbApiKey) {
        try {
            // Use TMDb to find the ID if we only have an IMDb ID
            if (imdbId && !tmdbId) {
                log.step(`Querying TMDb's find API for IMDB ID: ${imdbId}...`);
                const findUrl = `${tmdbConfig.baseUrl}/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`;
                const response = await _makeRequest(findUrl);
                
                if (response) {
                    const results = type === 'movie' ? response?.movie_results : response?.tv_results;
                    if (results && results.length > 0) {
                        metadata.tmdbId = results[0].id;
                        tmdbId = results[0].id;
                        log.step(`TMDb found a matching ID: ${tmdbId}`);
                    } else {
                        log.step(`TMDb's find API returned no results for ${imdbId}.`);
                    }
                } else {
                    log.step(`TMDb find API failed, continuing with other sources...`);
                }
            }

            // Get detailed metadata from TMDb if we have an ID
            if (tmdbId) {
                const tmdbUrl = `${tmdbConfig.baseUrl}/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
                log.step(`Querying TMDb metadata endpoint for ID: ${tmdbId}...`);
                const tmdbResult = await _makeRequest(tmdbUrl);
                
                if (tmdbResult) {
                    log.step('TMDb request successful. Populating metadata...');
                    _populateFromTMDb(metadata, tmdbResult, type);
                    sourceUsed.push('TMDb');
                } else {
                    log.step('TMDb metadata request failed, trying other sources...');
                }
            }
        } catch (error) {
            log.step(`TMDb processing failed: ${error.message}. Continuing with fallbacks...`);
        }
    } else {
        log.step('TMDb API key not provided, skipping TMDb...');
    }

    // PHASE 2: Try OMDb if we still need data
    if ((!metadata.title || !metadata.year) && imdbId && omdbApiKey) {
        try {
            const omdbUrl = `${omdbConfig.baseUrl}?apikey=${omdbApiKey}&i=${imdbId}`;
            log.step(`Querying OMDb for IMDB ID: ${imdbId}...`);
            const omdbResult = await _makeRequest(omdbUrl);
            
            if (omdbResult && omdbResult.Response === 'True') {
                log.step('OMDb request successful. Populating metadata...');
                _populateFromOMDb(metadata, omdbResult);
                sourceUsed.push('OMDb');
            } else {
                log.step('OMDb returned no valid data or failed, trying IMDb scraping...');
            }
        } catch (error) {
            log.step(`OMDb processing failed: ${error.message}. Trying IMDb scraping...`);
        }
    }

    // PHASE 3: Try IMDb scraping if we still need critical data
    if ((!metadata.title || !metadata.year) && imdbId) {
        log.step(`Scraping IMDb title page for ${imdbId}...`);
        const scrapedData = await _scrapeImdbTitle(imdbId);
        
        if (scrapedData) {
            // Only use scraped data if we don't have better data already
            if (!metadata.title) metadata.title = scrapedData.title;
            if (!metadata.year) metadata.year = scrapedData.year;
            if (!metadata.runtime) metadata.runtime = scrapedData.runtime;
            sourceUsed.push('IMDb-Scraping');
            log.step(`IMDb scraping successful. Title: "${metadata.title}", Year: ${metadata.year || 'N/A'}`);
        } else {
            log.step('IMDb scraping failed or returned no data...');
        }
    }

    // PHASE 4: Emergency fallback if we still don't have a title
    if (!metadata.title) {
        log.step('All metadata sources failed. Creating emergency fallback...');
        const fallback = _createFallbackMetadata(imdbId || id, type);
        Object.assign(metadata, fallback);
        sourceUsed.push('Fallback');
    }

    log.step(`Metadata enrichment complete. Sources used: ${sourceUsed.join(', ')}`);
    log.step(`Final metadata - Title: "${metadata.title}", Year: ${metadata.year || 'N/A'}, Runtime: ${metadata.runtime || 'N/A'} mins`);

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
