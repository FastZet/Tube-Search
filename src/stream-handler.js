// src/stream-handler.js
const config = require('./config');
const apiService = require('./api-service');
const scraperService = require('./scraper-service');
const scoringService = require('./scoring-service');

const getStreams = async (type, id) => {
    const start = Date.now();
    console.log(`\n[HANDLER] ----- New Request Started: ${type} ${id} -----`);
    
    // Logger object to manage chronological steps
    const log = {
        stepCounter: 1,
        step: function(message) {
            console.log(`[HANDLER] Step ${this.stepCounter++}: ${message}`);
        }
    };

    let metadata;
    let streams = [];

    try {
        log.step('Starting metadata enrichment process...');
        metadata = await apiService.getMetadata(type, id, log);
        log.step(`Successfully retrieved base metadata. Title: "${metadata.title}", Year: ${metadata.year || 'N/A'}`);

        if (type === 'series' && metadata.imdbId) {
            log.step(`Scraping IMDb for S${metadata.season}E${metadata.episode} episode title...`);
            const imdbEpisodeTitle = await scraperService.scrapeImdbForEpisodeTitle(metadata.imdbId, metadata.season, metadata.episode);
            if (imdbEpisodeTitle) {
                metadata.episodeTitle = imdbEpisodeTitle;
                log.step(`Success! Found episode title from IMDb: "${metadata.episodeTitle}"`);
            } else {
                log.step('IMDb scrape failed or returned no title. Proceeding without it.');
            }
        }

        const searchQueries = _buildSearchQueries(metadata, type);
        log.step('Building search queries...');
        searchQueries.forEach((q, i) => console.log(`  - Query ${i + 1}: ${q}`));

        log.step('Scraping Google for stream candidates...');
        const { allResults: scrapedResults, queryStats } = await scraperService.scrapeGoogleForStreams(searchQueries);
        log.step(`Found ${scrapedResults.length} unique results from Google.`);
        queryStats.forEach(stat => {
            console.log(`  - Query "${stat.query}" returned ${stat.count} results.`);
        });

        log.step('Scoring results...');
        const scoredResults = scrapedResults
            .map(result => ({ ...result, scoreData: scoringService.calculateScore(result, metadata, type) }))
            .sort((a, b) => b.scoreData.score - a.scoreData.score);

        const topResults = (scoredResults.length > 0 && scoredResults[0].scoreData.score > 0)
            ? scoredResults.slice(0, 2)
            : [];
        
        log.step(`Scoring complete. Selected ${topResults.length} result(s) with a score > 0.`);

        if (config.logging.enableDetailedScoring && scoredResults.length > 0) {
            console.log('\n[HANDLER] Detailed scoring for top 5 results:');
            scoredResults.slice(0, 5).forEach((result, index) => {
                const breakdownLog = _formatBreakdownForLog(result.scoreData.breakdown);
                console.log(`  --- Result ${index + 1}: "${result.title}" ---`);
                console.log(`    - Final Score: ${result.scoreData.score.toFixed(2)}`);
                console.log(`    - Breakdown: ${breakdownLog}`);
            });
            console.log('');
        }

        log.step('Formatting final streams for Stremio...');
        if (topResults.length > 0) {
            streams.push(...topResults.map(_formatStream));
        }

    } catch (error) {
        // This block will now catch ANY error from the metadata/scraping process
        console.error(`[HANDLER] A critical error occurred: ${error.message}`);
        console.error('[HANDLER] The process was halted. Returning fallback streams.');
    }

    streams.push(..._getFallbackStreams(metadata, type));

    const duration = Date.now() - start;
    log.step(`Request completed in ${duration}ms. Returning ${streams.length} total streams.`);

    return { streams };
};

// --- Private Helpers ---

const _formatBreakdownForLog = (breakdown) => {
    const formatted = {};
    for (const key in breakdown) {
        const value = breakdown[key];
        formatted[key] = typeof value === 'number' ? value.toFixed(2) : value;
    }
    return JSON.stringify(formatted);
};

const _buildSearchQueries = (metadata, type) => {
    const queries = [];
    if (type === 'movie') {
        queries.push(`${metadata.title} ${metadata.year || ''} full movie`);
    } else {
        const paddedSeason = String(metadata.season).padStart(2, '0');
        const paddedEpisode = String(metadata.episode).padStart(2, '0');
        const compactSE = `S${paddedSeason}E${paddedEpisode}`;
        queries.push(`${metadata.title} ${compactSE}`);
        if (metadata.episodeTitle) queries.push(`${metadata.title} ${compactSE} ${metadata.episodeTitle}`);
    }
    return queries;
};

const _formatStream = (result) => {
    let cleanTitle = result.title
        .replace(/ - video Dailymotion/i, '')
        .replace(/\| YouTube/i, '')
        .replace(/- YouTube/i, '')
        .replace(/\| Facebook/i, '')
        .trim()
        .replace(/[\s\-,|]+$/, '');

    return {
        title: `[${result.source || 'Stream'}] ${cleanTitle}\n${result.duration ? `Duration: ${result.duration}` : ''}`,
        externalUrl: result.url,
        behaviorHints: { externalUrl: true },
    };
};

const _getFallbackStreams = (metadata, type) => {
    if (!metadata || !metadata.title) {
        return [{
            title: '🔍 Metadata failed, click to search Google manually',
            externalUrl: 'https://google.com',
            behaviorHints: { externalUrl: true }
        }];
    }
    const fallbacks = [];
    if (type === 'series') {
        const spacedSE = `S${String(metadata.season).padStart(2, '0')} E${String(metadata.episode).padStart(2, '0')}`;
        const genericQuery = `${metadata.title} ${spacedSE}`;
        fallbacks.push({
            title: `🔍 No Title: See all results on Google...`,
            externalUrl: `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(genericQuery)}&tbs=dur:l&tbm=vid`,
            behaviorHints: { externalUrl: true },
        });
        if (metadata.episodeTitle) {
            const specificQuery = `${metadata.title} ${spacedSE} ${metadata.episodeTitle}`;
            fallbacks.push({
                title: `🔍 With Title: See all results on Google...`,
                externalUrl: `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(specificQuery)}&tbs=dur:l&tbm=vid`,
                behaviorHints: { externalUrl: true },
            });
        }
    } else {
        const movieQuery = `${metadata.title} ${metadata.year || ''} full movie`;
        fallbacks.push({
            title: `🔍 See all results on Google...`,
            externalUrl: `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(movieQuery)}&tbs=dur:l&tbm=vid`,
            behaviorHints: { externalUrl: true },
        });
    }
    return fallbacks;
};

module.exports = { getStreams };
