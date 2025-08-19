// src/scraper-service.js

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');

/**
 * A resilient selector function that tries an array of selectors in order.
 * @param {cheerio.CheerioAPI} $ - The Cheerio instance.
 * @param {cheerio.Element} element - The parent element to search within.
 * @param {string[]} selectors - An array of CSS selectors to try.
 * @returns {cheerio.Cheerio<cheerio.Element>} The first matching element.
 */
const selectFirst = ($, element, selectors) => {
    for (const selector of selectors) {
        const result = $(element).find(selector);
        if (result.length > 0) {
            return result.first();
        }
    }
    return cheerio.load('')(''); // Return an empty Cheerio object if no match
};

/**
 * Scrapes Google Video search for potential stream links.
 * @param {string[]} searchQueries - An array of search strings.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of scraped results.
 */
const scrapeGoogleForStreams = async (searchQueries) => {
    const allResults = [];
    const seenUrls = new Set();
    // CORRECTED: Pulling userAgent and defaultTimeout from their correct config locations
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
            // Continue to next query even if one fails
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
    // CORRECTED: Pulling userAgent and defaultTimeout from their correct config locations
    const { userAgent } = config.scraping;
    const { defaultTimeout } = config.api;
    const { imdb: selectors } = config.scraping.selectors;

    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': userAgent },
            timeout: defaultTimeout,
        });
        const $ = cheerio.load(response.data);
        let foundTitle = null;

        $(selectors.episodeListItem.join(', ')).each((i, el) => {
            const epNumberEl = selectFirst($, el, selectors.episodeNumber);
            const epNumber = epNumberEl.attr('content');

            if (epNumber && parseInt(epNumber, 10) === parseInt(episode, 10)) {
                foundTitle = selectFirst($, el, selectors.episodeTitle).text().trim();
                return false; // Break the loop once found
            }
        });
        return foundTitle;
    } catch (error) {
        console.error(`[SCRAPER_SERVICE] Failed to scrape IMDb page for ${imdbId} S${season}: ${error.message}`);
        return null;
    }
};

module.exports = {
    scrapeGoogleForStreams,
    scrapeImdbForEpisodeTitle,
};
