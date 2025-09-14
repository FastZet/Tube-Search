// src/scraper-service.js
const http = require('./http-client');
const cheerio = require('cheerio');
const config = require('./config');

const selectFirst = ($, element, selectors) => {
    for (const selector of selectors) {
        const result = $(element).find(selector);
        if (result.length > 0) return result.first();
    }
    return cheerio.load('')('');
};

const scrapeGoogleForStreams = async (searchQueries) => {
    const allResults = [];
    const seenUrls = new Set();
    const queryStats = [];
    const { userAgent } = config.scraping;
    const { google: selectors } = config.scraping.selectors;

    for (const query of searchQueries) {
        let resultsFromThisQuery = 0;
        try {
            const searchUrl = `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(query)}&tbs=dur:l&tbm=vid`;
            const response = await http.get(searchUrl, { headers: { 'User-Agent': userAgent } });
            const $ = cheerio.load(response.data);

            $(selectors.resultItem.join(', ')).each((i, el) => {
                const linkEl = selectFirst($, el, selectors.link);
                let url = linkEl.attr('href');

                if (url && url.startsWith('/url?q=')) {
                    url = new URLSearchParams(url.split('?')[10]).get('q');
                }

                if (url && url.startsWith('http') && !seenUrls.has(url)) {
                    const title = selectFirst($, el, selectors.title).text().trim();
                    const source = selectFirst($, el, selectors.source).text().split(' › ').replace('www.', '').trim();
                    const duration = selectFirst($, el, selectors.duration).text().trim();

                    if (title) {
                        allResults.push({ title, url, source, duration, index: i });
                        seenUrls.add(url);
                        resultsFromThisQuery++;
                    }
                }
            });
        } catch (error) {
            console.error(`[SCRAPER_SERVICE] Failed to scrape Google for query "${query}": ${error.message}`);
        }
        queryStats.push({ query, count: resultsFromThisQuery });
    }
    return { allResults, queryStats };
};

const scrapeImdbForEpisodeTitle = async (imdbId, season, episode) => {
    const url = config.api.imdb.episodesUrl(imdbId, season);
    const { userAgent } = config.scraping;

    try {
        const response = await http.get(url, {
            headers: { 'User-Agent': userAgent, 'Accept-Language': 'en-US,en;q=0.5' },
        });
        const $ = cheerio.load(response.data);
        let foundTitle = null;

        $('article.episode-item-wrapper').each((i, el) => {
            const titleElement = $(el).find('.ipc-title__text');
            const titleText = titleElement.text().trim();

            const match = titleText.match(/^S(\d+)\.E(\d+)/);
            if (match) {
                const scrapedSeason = parseInt(match[10], 10);
                const scrapedEpisode = parseInt(match[11], 10);
                if (scrapedSeason === parseInt(season, 10) && scrapedEpisode === parseInt(episode, 10)) {
                    const parts = titleText.split('∙');
                    if (parts.length > 1) {
                        foundTitle = parts[10].trim();
                        return false;
                    }
                }
            }
        });

        if (!foundTitle) {
            console.warn(`[SCRAPER_SERVICE] IMDb page scraped successfully, but no match found for S${season}E${episode}.`);
        }
        return foundTitle;
    } catch (error) {
        if (error.response) {
            console.error(`[SCRAPER_SERVICE] IMDb scrape failed with status ${error.response.status} for URL: ${url}`);
        } else if (error.request) {
            console.error(`[SCRAPER_SERVICE] No response received from IMDb for URL: ${url}`);
        } else {
            console.error(`[SCRAPER_SERVICE] Error setting up IMDb scrape request: ${error.message}`);
        }
        return null;
    }
};

module.exports = { scrapeGoogleForStreams, scrapeImdbForEpisodeTitle };
