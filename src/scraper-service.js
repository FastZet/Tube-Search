// src/scraper-service.js
//
// Google search is now handled via Serper.dev API (https://serper.dev).
// No Chromium / Puppeteer is used for the Google step.
// IMDb episode-title scraping still uses the headless browser (browser.js).

const http    = require('./http-client');
const cheerio = require('cheerio');
const config  = require('./config');

// ─── Serper API helper ────────────────────────────────────────────────────────

/**
 * Calls the Serper.dev Videos endpoint and returns normalised results.
 * @param {string} query
 * @returns {Promise<Array<{title,url,source,duration,index}>>}
 */
const _serperVideoSearch = async (query) => {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) throw new Error('SERPER_API_KEY environment variable is not set');

    const payload = JSON.stringify({
        q:   query,
        tbs: 'dur:l',  // long-duration filter — same as &tbs=dur:l on Google
        num: 10,
    });

    const response = await http.post('https://google.serper.dev/videos', payload, {
        headers: {
            'X-API-KEY':    apiKey,
            'Content-Type': 'application/json',
        },
    });

    const videos = response.data?.videos || [];

    return videos
        .map((v, idx) => ({
            title:    v.title    || '',
            url:      v.link     || '',
            source:   v.source   || _domainFromUrl(v.link || ''),
            duration: v.duration || '',   // Serper returns "H:MM:SS" strings
            index:    idx,
        }))
        .filter(r => r.url.startsWith('http') && r.title);
};

// ─── Public: scrapeGoogleForStreams ───────────────────────────────────────────

/**
 * Runs each query through Serper and aggregates de-duplicated results.
 * Drop-in replacement for the old Chromium-based scraper.
 *
 * @param {string[]} searchQueries
 * @returns {Promise<{allResults: Array, queryStats: Array}>}
 */
const scrapeGoogleForStreams = async (searchQueries) => {
    const allResults = [];
    const seenUrls   = new Set();
    const queryStats = [];

    for (const query of searchQueries) {
        let resultsFromThisQuery = 0;
        try {
            console.log(`[SCRAPER_SERVICE] Serper search: "${query}"`);
            const results = await _serperVideoSearch(query);

            for (const r of results) {
                if (!seenUrls.has(r.url)) {
                    seenUrls.add(r.url);
                    allResults.push(r);
                    resultsFromThisQuery++;
                }
            }

            console.log(`[SCRAPER_SERVICE] Query "${query}" returned ${resultsFromThisQuery} new result(s)`);
        } catch (error) {
            console.error(`[SCRAPER_SERVICE] Serper failed for query "${query}": ${error.message}`);
        }
        queryStats.push({ query, count: resultsFromThisQuery });
    }

    // Re-index so the scoring service sees contiguous positions
    allResults.forEach((r, i) => { r.index = i; });

    return { allResults, queryStats };
};

// ─── Public: scrapeImdbForEpisodeTitle ────────────────────────────────────────
// Still uses the headless browser — IMDb is JS-rendered and has no free API.

const scrapeImdbForEpisodeTitle = async (imdbId, season, episode) => {
    const url = config.api.imdb.episodesUrl(imdbId, season);

    try {
        const { fetchRenderedPage } = require('./browser');

        const html = await fetchRenderedPage(url, 'article.episode-item-wrapper');
        if (!html) return null;

        const $ = cheerio.load(html);
        let foundTitle = null;

        $('article.episode-item-wrapper').each((i, el) => {
            const titleText = $(el).find('.ipc-title__text').text().trim();
            const match = titleText.match(/^S(\d+)\.E(\d+)/);
            if (match) {
                const scrapedSeason  = parseInt(match[1], 10);
                const scrapedEpisode = parseInt(match[2], 10);
                if (
                    scrapedSeason  === parseInt(season,  10) &&
                    scrapedEpisode === parseInt(episode, 10)
                ) {
                    const parts = titleText.split('∙');
                    if (parts.length > 1) {
                        foundTitle = parts[1].trim();
                        return false; // break $.each
                    }
                }
            }
        });

        if (!foundTitle) {
            console.warn(`[SCRAPER_SERVICE] IMDb scraped OK but no match for S${season}E${episode}.`);
        }
        return foundTitle;
    } catch (error) {
        if (error.response) {
            console.error(`[SCRAPER_SERVICE] IMDb scrape HTTP ${error.response.status} for ${url}`);
        } else {
            console.error(`[SCRAPER_SERVICE] IMDb scrape error: ${error.message}`);
        }
        return null;
    }
};

// ─── Utilities ────────────────────────────────────────────────────────────────

const _domainFromUrl = (url) => {
    try { return new URL(url).hostname.replace('www.', ''); }
    catch { return ''; }
};

module.exports = { scrapeGoogleForStreams, scrapeImdbForEpisodeTitle };
