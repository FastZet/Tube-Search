// src/scraper-service.js
//
// Google video search HTML structure (as of May 2026, tbm=vid&tbs=dur:l):
//
// Each result is a:  div.PmEWq.wHYlTd.Ww4FFb.vt6azd   (jsname="pKB8Bc")
//   ├── div.WVV5ke          (video wrapper, holds data-curl = direct video page URL)
//   │     data-curl="https://www.youtube.com/watch?v=..."
//   │     data-pub="YouTube"  (publisher / source name)
//   ├── div.xe8e1b
//   │   └── div.b8lM7
//   │         └── span.V9tjod
//   │               └── a.zReHs[href]          ← canonical link, plain URL (no /url?q= wrapping)
//   │                     └── h3.LC20lb        ← title text
//   ├── div.notranslate.ESMNde  (URL breadcrumb row)
//   │     └── cite.tLk3Jb      ← domain breadcrumb (e.g. "www.youtube.com")
//   ├── div.iHxmLe              (video card / thumbnail row)
//   │     └── div.kSFuOd.rkqHyd
//   │           └── div.c8rnLc  ← contains <span> with duration text (e.g. "14449")
//   └── div.fzUZNc
//         └── div.ITZIwc.p4wth  ← snippet / description
//               ← div.gqF9jc.YrbPuc  (metadata row)
//                     spans: platform name, channel name, upload date
//
// NOTE: The link href on a.zReHs is a plain absolute URL — NOT wrapped in /url?q=
// NOTE: Duration shown in .c8rnLc span is raw seconds as a plain number string (e.g. "14449")
//       We convert it to HH:MM:SS for the scoring service.
// NOTE: data-curl on div.WVV5ke is the most reliable URL — use it when present.

const http = require('./http-client');
const cheerio = require('cheerio');
const config = require('./config');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a raw seconds string (e.g. "14449") to HH:MM:SS or MM:SS string.
 * Returns null if the input is not a valid integer.
 */
const _secondsToHMS = (raw) => {
    const secs = parseInt(raw, 10);
    if (isNaN(secs) || secs <= 0) return null;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/**
 * Extracts a clean domain from a cite/breadcrumb string.
 * e.g. "www.youtube.com › watch" → "youtube.com"
 */
const _parseDomain = (raw) => {
    return (raw || '').split('›')[0].replace('www.', '').trim();
};

/**
 * Resolves a Google redirect URL if present, otherwise returns as-is.
 * Handles both /url?q=... and plain absolute URLs.
 */
const _resolveGoogleRedirect = (href) => {
    if (!href) return null;
    if (href.startsWith('/url?') || href.startsWith('/url?q=')) {
        try {
            const qs = href.includes('?') ? href.split('?')[1] : '';
            return new URLSearchParams(qs).get('q') || null;
        } catch {
            return null;
        }
    }
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
    return null;
};

// ---------------------------------------------------------------------------
// Google scraping (primary entry point)
// ---------------------------------------------------------------------------

const scrapeGoogleForStreams = async (searchQueries) => {
    const allResults = [];
    const seenUrls = new Set();
    const queryStats = [];
    const { userAgent } = config.scraping;

    for (const query of searchQueries) {
        let resultsFromThisQuery = 0;

        try {
            const searchUrl =
                `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(query)}&tbs=dur:l&tbm=vid`;

            console.log(`[SCRAPER_SERVICE] Fetching: ${searchUrl}`);

            const response = await http.get(searchUrl, {
                headers: {
                    'User-Agent': userAgent,
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
            });

            const $ = cheerio.load(response.data);

            // ----------------------------------------------------------------
            // Strategy 1 – modern video card layout (May 2026)
            //   Container: div.PmEWq  (has additional classes wHYlTd Ww4FFb vt6azd)
            //   This is the primary layout for &tbm=vid results.
            // ----------------------------------------------------------------
            const modernCards = $('div.PmEWq');
            console.log(`[SCRAPER_SERVICE] Strategy 1 (div.PmEWq) found ${modernCards.length} containers for query: "${query}"`);

            modernCards.each((i, el) => {
                try {
                    // --- URL ---
                    // Prefer data-curl on the inner WVV5ke div (most reliable, plain URL).
                    let url = $(el).find('div.WVV5ke').first().attr('data-curl') || null;

                    // Fallback: the anchor inside span.V9tjod > a.zReHs
                    if (!url) {
                        const anchor = $(el).find('span.V9tjod a.zReHs').first();
                        url = _resolveGoogleRedirect(anchor.attr('href'));
                    }

                    // Fallback: any anchor with data-ved inside the card
                    if (!url) {
                        $(el).find('a[href]').each((_, a) => {
                            const candidate = _resolveGoogleRedirect($(a).attr('href'));
                            if (candidate && candidate.startsWith('http') && !candidate.includes('google.com')) {
                                url = candidate;
                                return false; // break
                            }
                        });
                    }

                    if (!url || !url.startsWith('http') || seenUrls.has(url)) return;

                    // --- Title ---
                    let title = $(el).find('h3.LC20lb').first().text().trim();
                    if (!title) {
                        title = $(el).find('h3').first().text().trim();
                    }
                    if (!title) return; // skip result with no title

                    // --- Source / domain ---
                    let source = '';
                    // Prefer the publisher stored in data-pub attribute
                    const pub = $(el).find('div.WVV5ke').first().attr('data-pub');
                    if (pub) {
                        source = pub.trim();
                    } else {
                        // Fall back to cite breadcrumb
                        const citeText = $(el).find('cite.tLk3Jb').first().text().trim();
                        source = _parseDomain(citeText);
                    }

                    // --- Duration ---
                    // div.c8rnLc > span contains raw seconds (e.g. "14449")
                    let duration = null;
                    const durSpan = $(el).find('div.c8rnLc span').first();
                    if (durSpan.length) {
                        duration = _secondsToHMS(durSpan.text().trim());
                    }
                    // Fallback: aria-label on the clickable video card row contains seconds too
                    if (!duration) {
                        const ariaLabel = $(el).find('[data-vll]').first().attr('aria-label') || '';
                        const secMatch = ariaLabel.match(/(\d{4,6})\s*(?:data-vll|$)/);
                        if (secMatch) duration = _secondsToHMS(secMatch[1]);
                    }

                    allResults.push({ title, url, source, duration, index: i });
                    seenUrls.add(url);
                    resultsFromThisQuery++;

                } catch (err) {
                    console.warn(`[SCRAPER_SERVICE] Failed to parse card at index ${i}: ${err.message}`);
                }
            });

            // ----------------------------------------------------------------
            // Strategy 2 – classic organic result layout (fallback / mixed pages)
            //   Container: div.g  or  div[data-ved] > div.g
            // ----------------------------------------------------------------
            if (resultsFromThisQuery === 0) {
                console.log(`[SCRAPER_SERVICE] Strategy 1 yielded 0 results — trying Strategy 2 (div.g) for query: "${query}"`);

                $('div.g, div.MjjYud > div.g').each((i, el) => {
                    try {
                        // anchor for URL + title
                        const anchor = $(el).find('a[href]').first();
                        const url = _resolveGoogleRedirect(anchor.attr('href'));
                        if (!url || !url.startsWith('http') || seenUrls.has(url)) return;

                        const title = $(el).find('h3.LC20lb, h3').first().text().trim();
                        if (!title) return;

                        const citeText = $(el).find('cite').first().text().trim();
                        const source = _parseDomain(citeText);

                        // Duration: .c8rnLc span (seconds) or legacy .O1CVkc text
                        let duration = null;
                        const legacyDur = $(el).find('.c8rnLc span, .O1CVkc').first().text().trim();
                        if (legacyDur) {
                            duration = /^\d+$/.test(legacyDur)
                                ? _secondsToHMS(legacyDur)
                                : legacyDur; // keep as-is if already formatted
                        }

                        allResults.push({ title, url, source, duration, index: i });
                        seenUrls.add(url);
                        resultsFromThisQuery++;

                    } catch (err) {
                        console.warn(`[SCRAPER_SERVICE] Strategy 2 failed at index ${i}: ${err.message}`);
                    }
                });

                console.log(`[SCRAPER_SERVICE] Strategy 2 found ${resultsFromThisQuery} results.`);
            }

            // ----------------------------------------------------------------
            // Strategy 3 – nuclear fallback: harvest all platform links on page
            // ----------------------------------------------------------------
            if (resultsFromThisQuery === 0) {
                console.warn(`[SCRAPER_SERVICE] Both strategies failed — running Strategy 3 (link harvest) for query: "${query}"`);

                $('a[href]').each((i, el) => {
                    const href = $(el).attr('href') || '';
                    const url = _resolveGoogleRedirect(href);
                    if (!url || seenUrls.has(url)) return;

                    const isKnownPlatform = config.scraping.whitelistedDomains.some(d => url.includes(d));
                    if (!isKnownPlatform) return;

                    // Title: nearest h3, or text of the anchor itself
                    let title = $(el).find('h3').first().text().trim()
                        || $(el).closest('div').find('h3').first().text().trim()
                        || $(el).text().trim();
                    if (!title || title.length < 3) return;

                    const domain = new URL(url).hostname.replace('www.', '');
                    allResults.push({ title, url, source: domain, duration: null, index: i });
                    seenUrls.add(url);
                    resultsFromThisQuery++;
                });

                console.log(`[SCRAPER_SERVICE] Strategy 3 found ${resultsFromThisQuery} results.`);
            }

        } catch (err) {
            console.error(`[SCRAPER_SERVICE] Failed to scrape Google for query "${query}": ${err.message}`);
        }

        queryStats.push({ query, count: resultsFromThisQuery });
    }

    return { allResults, queryStats };
};

// ---------------------------------------------------------------------------
// IMDb episode title scraping (unchanged logic, kept for compatibility)
// ---------------------------------------------------------------------------

const scrapeImdbForEpisodeTitle = async (imdbId, season, episode) => {
    const url = config.api.imdb.episodesUrl(imdbId, season);
    const { userAgent } = config.scraping;

    try {
        const { fetchRenderedPage } = require('./browser');

        const html = await fetchRenderedPage(url, 'article.episode-item-wrapper, div.list_item');
        if (!html) return null; // bail out cleanly if browser failed

        const $ = cheerio.load(html);
        let foundTitle = null;

        $('article.episode-item-wrapper').each((i, el) => {
            const titleElement = $(el).find('.ipc-title__text');
            const titleText = titleElement.text().trim();

            const match = titleText.match(/^S(\d+)\.E(\d+)/);
            if (match) {
                const scrapedSeason = parseInt(match[1], 10);
                const scrapedEpisode = parseInt(match[2], 10);
                if (
                    scrapedSeason === parseInt(season, 10) &&
                    scrapedEpisode === parseInt(episode, 10)
                ) {
                    const parts = titleText.split('∙');
                    if (parts.length > 1) {
                        foundTitle = parts[1].trim();
                        return false; // break .each()
                    }
                }
            }
        });

        if (!foundTitle) {
            console.warn(
                `[SCRAPER_SERVICE] IMDb page scraped successfully, but no match found for S${season}E${episode}.`
            );
        }
        return foundTitle;

    } catch (error) {
        if (error.response) {
            console.error(
                `[SCRAPER_SERVICE] IMDb scrape failed with status ${error.response.status} for URL: ${url}`
            );
        } else if (error.request) {
            console.error(`[SCRAPER_SERVICE] No response received from IMDb for URL: ${url}`);
        } else {
            console.error(`[SCRAPER_SERVICE] Error setting up IMDb scrape request: ${error.message}`);
        }
        return null;
    }
};

module.exports = { scrapeGoogleForStreams, scrapeImdbForEpisodeTitle };
