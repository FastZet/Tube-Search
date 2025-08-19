// src/stream-handler.js

const config = require('./config');
const apiService = require('./api-service');
const scraperService = require('./scraper-service');
const scoringService = require('./scoring-service');


// ... getStreams function header remains the same ...
const getStreams = async (type, id, apiKeys) => {
    const start = Date.now();
    if (!type || !id || !apiKeys?.tmdbApiKey) {
        throw new Error('[HANDLER] Invalid arguments: type, id, and tmdbApiKey are required.');
    }

    let metadata;
    let searchQueries = [];
    let streams = [];

    try {
        console.log(`\n[HANDLER] ----- New Request Started: ${type} ${id} -----`);

        console.log('[HANDLER] Step 1/5: Starting metadata enrichment...');
        metadata = await apiService.getMetadata(type, id, apiKeys);

        if (type === 'series' && metadata.imdbId) {
            console.log(`[HANDLER] Step 1.1: Scraping IMDb for S${metadata.season}E${metadata.episode} title...`);
            const imdbEpisodeTitle = await scraperService.scrapeImdbForEpisodeTitle(metadata.imdbId, metadata.season, metadata.episode);
            if (imdbEpisodeTitle) {
                metadata.episodeTitle = imdbEpisodeTitle;
                console.log(`[HANDLER] Step 1.2: Success! Found episode title from IMDb: "${metadata.episodeTitle}"`);
            } else {
                console.log('[HANDLER] Step 1.2: IMDb scrape failed or returned no title. Proceeding without it.');
            }
        }

        if (!metadata.title) {
            throw new Error('Failed to retrieve a title for the content. Cannot proceed.');
        }

        searchQueries = _buildSearchQueries(metadata, type);
        console.log('[HANDLER] Step 2/5: Built search queries:');
        searchQueries.forEach((q, i) => console.log(`  ${i + 1}: ${q}`));

        console.log('[HANDLER] Step 3/5: Scraping Google for stream candidates...');
        const scrapedResults = await scraperService.scrapeGoogleForStreams(searchQueries);
        console.log(`[HANDLER] Step 3.1: Found ${scrapedResults.length} unique results.`);
        if (config.logging.enableDetailedScoring) {
            scrapedResults.forEach((res, i) => console.log(`  ${i + 1}: ${res.title}`));
        }
        
        console.log('\n[HANDLER] Step 4/5: Scoring results...');
        const scoredResults = scrapedResults
            .map(result => ({
                ...result,
                scoreData: scoringService.calculateScore(result, metadata, type),
            }))
            .sort((a, b) => b.scoreData.score - a.scoreData.score);
        
        const topResult = (scoredResults.length > 0 && scoredResults[0].scoreData.score > 0) ? scoredResults[0] : null;

        if (topResult) {
            console.log(`[HANDLER] Step 4.1: Final Selection: "${topResult.title}" with score ${topResult.scoreData.score.toFixed(2)}`);
        }
        
        if (config.logging.enableDetailedScoring) {
            console.log('\n[HANDLER] Step 4.2: Detailed scoring for top results:');
            scoredResults.slice(0, 5).forEach((result, index) => {
                const breakdownLog = _formatBreakdownForLog(result.scoreData.breakdown); // Use helper here
                console.log(`[HANDLER] --- Result ${index + 1}: "${result.title}" ---`);
                console.log(`[HANDLER]   - Final Score: ${result.scoreData.score.toFixed(2)}`);
                console.log(`[HANDLER]   - Breakdown: ${breakdownLog}`); // Log formatted string
            });
        }
        
        console.log('\n[HANDLER] Step 5/5: Formatting final streams for Stremio.');
        if (topResult) {
            streams.push(_formatStream(topResult));
        }

    } catch (error) {
        console.error(`[HANDLER] An error occurred in the main stream handler: ${error.message}`);
    }

    streams.push(..._getFallbackStreams(metadata, type));
    
    const duration = Date.now() - start;
    console.log(`[HANDLER] Request for ${type}:${id} completed in ${duration}ms. Returning ${streams.length} streams.`);

    return { streams };
};

// --- Private Helper Functions ---

// ADDED: Helper to format the breakdown object for clean logging
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
        if (metadata.episodeTitle) {
            queries.push(`${metadata.title} ${compactSE} ${metadata.episodeTitle}`);
        }
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
