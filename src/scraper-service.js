// src/scraper-service.js

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');

// ... selectFirst helper function remains unchanged ...
const selectFirst = ($, element, selectors) => {
    for (const selector of selectors) {
        const result = $(element).find(selector);
        if (result.length > 0) {
            return result.first();
        }
    }
    return cheerio.load('')('');
};

// ... scrapeGoogleForStreams function remains unchanged ...
const scrapeGoogleForStreams = async (searchQueries) => {
    const allResults = [];
    const seenUrls = new Set();
    const { userAgent } = config.scraping;
    const { defaultTimeout } = config.api;
    const { google: selectors } = config.scraping.selectors;

    for (const query of searchQueries) {
        try {
            const searchUrl = `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(query)}&tbs=dur:l&tbm=vid`;
            const response = await axios.get(searchUrl, {
                headers: { 'User-Agent': userAgent },
                timeout: defaultTimeout,
            });

            const $ = cheerio.load(response.data);

            $(selectors.resultItem.join(', ')).each((i, el) => {
                const linkEl = selectFirst($, el, selectors.link);
                let url = linkEl.attr('href');

                if (url && url.startsWith('/url?q=')) {
                    url = new URLSearchParams(url.split('?')[1]).get('q');
                }

                if (url && url.startsWith('http') && !seenUrls.has(url)) {
                    const title = selectFirst($, el, selectors.title).text().trim();
                    const source = selectFirst($, el, selectors.source).text().split(' › ')[0].replace('www.', '').trim();
                    const duration = selectFirst($, el, selectors.duration).text().trim();

                    if (title) {
                        allResults.push({ title, url, source, duration, index: i });
                        seenUrls.add(url);
                    }
                }
            });
        } catch (error) {
            console.error(`[SCRAPER_SERVICE] Failed to scrape Google for query "${query}": ${error.message}`);
        }
    }
    return allResults;
};


/**
 * Scrapes IMDb for a specific episode's title.
 * @param {string} imdbId - The IMDb ID of the series.
 * @param {number|string} season - The season number.
 * @param {number|string} episode - The episode number.
 * @returns {Promise<string|null>} A promise that resolves to the episode title or null.
 */
const scrapeImdbForEpisodeTitle = async (imdbId, season, episode) => {
    const url = config.api.imdb.episodesUrl(imdbId, season);
    const { userAgent } = config.scraping;
    const { defaultTimeout } = config.api;
    const { imdb: selectors } = config.scraping.selectors;

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': userAgent,
                'Accept-Language': 'en-US,en;q=0.5' // ADDED: More browser-like header
            },
            timeout: defaultTimeout,
        });
        const $ = cheerio.load(response.data);
        let foundTitle = null;

        $(selectors.episodeListItem.join(', ')).each((i, el) => {
            const epNumberEl = selectFirst($, el, selectors.episodeNumber);
            const epNumber = epNumberEl.attr('content');

            if (epNumber && parseInt(epNumber, 10) === parseInt(episode, 10)) {
                foundTitle = selectFirst($, el, selectors.episodeTitle).text().trim();
                return false;
            }
        });
        
        // ADDED: More specific logging for parsing failure
        if (!foundTitle) {
            console.warn(`[SCRAPER_SERVICE] IMDb page scraped successfully, but no match found for S${season}E${episode}.`);
        }

        return foundTitle;
    } catch (error) {
        // ADDED: Detailed error logging
        if (error.response) {
            // The request was made and the server responded with a status code
            console.error(`[SCRAPER_SERVICE] IMDb scrape failed with status ${error.response.status} for URL: ${url}`);
        } else if (error.request) {
            // The request was made but no response was received
            console.error(`[SCRAPER_SERVICE] No response received from IMDb for URL: ${url}`);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error(`[SCRAPER_SERVICE] Error setting up IMDb scrape request: ${error.message}`);
        }
        return null;
    }
};

module.exports = {
    scrapeGoogleForStreams,
    scrapeImdbForEpisodeTitle,
};
