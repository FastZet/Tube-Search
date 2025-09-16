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
        log.step('Starting enhanced metadata enrichment process...');
        metadata = await apiService.getMetadata(type, id, log);
        log.step(`Metadata enrichment completed. Title: "${metadata.title}", Year: ${metadata.year || 'N/A'}`);

        // Enhanced episode title handling for series
        if (type === 'series' && metadata.imdbId) {
            log.step(`Attempting to enrich episode data for S${metadata.season}E${metadata.episode}...`);
            
            try {
                const imdbEpisodeTitle = await scraperService.scrapeImdbForEpisodeTitle(metadata.imdbId, metadata.season, metadata.episode);
                if (imdbEpisodeTitle) {
                    metadata.episodeTitle = imdbEpisodeTitle;
                    log.step(`Success! Found episode title from IMDb: "${metadata.episodeTitle}"`);
                } else {
                    log.step('IMDb episode scraping returned no title. Proceeding without specific episode title.');
                }
            } catch (episodeError) {
                log.step(`IMDb episode scraping failed: ${episodeError.message}. Proceeding without specific episode title.`);
            }
        }

        // Build search queries with enhanced fallback strategies
        const searchQueries = _buildSearchQueries(metadata, type);
        log.step('Building enhanced search queries...');
        searchQueries.forEach((q, i) => console.log(`  - Query ${i + 1}: ${q}`));

        log.step('Scraping Google for stream candidates...');
        
        let scrapedResults = [];
        let queryStats = [];
        
        try {
            const scrapingResult = await scraperService.scrapeGoogleForStreams(searchQueries);
            scrapedResults = scrapingResult.allResults;
            queryStats = scrapingResult.queryStats;
            
            log.step(`Found ${scrapedResults.length} unique results from Google.`);
            queryStats.forEach(stat => {
                console.log(`  - Query "${stat.query}" returned ${stat.count} results.`);
            });
        } catch (scrapingError) {
            log.step(`Google scraping failed: ${scrapingError.message}. Proceeding with empty results.`);
            console.error(`[HANDLER] Scraping error details:`, scrapingError);
        }

        // Enhanced scoring and selection
        log.step('Scoring and ranking results...');
        
        if (scrapedResults.length > 0) {
            const scoredResults = scrapedResults
                .map(result => ({ ...result, scoreData: scoringService.calculateScore(result, metadata, type) }))
                .sort((a, b) => b.scoreData.score - a.scoreData.score);

            // More intelligent result selection
            const topResults = _selectTopResults(scoredResults, log);
            
            log.step(`Scoring complete. Selected ${topResults.length} result(s) based on score thresholds.`);

            // Enhanced scoring logs
            if (config.logging.enableDetailedScoring && scoredResults.length > 0) {
                console.log('\n[HANDLER] Detailed scoring for top 5 results:');
                scoredResults.slice(0, 5).forEach((result, index) => {
                    const breakdownLog = _formatBreakdownForLog(result.scoreData.breakdown);
                    console.log(`  --- Result ${index + 1}: "${result.title}" (Score: ${result.scoreData.score.toFixed(2)}) ---`);
                    console.log(`    - Source: ${result.source || 'Unknown'}`);
                    console.log(`    - Duration: ${result.duration || 'N/A'}`);
                    console.log(`    - Breakdown: ${breakdownLog}`);
                });
                console.log('');
            }

            log.step('Formatting streams for Stremio...');
            if (topResults.length > 0) {
                streams.push(...topResults.map(result => _formatStream(result, metadata)));
            }
        } else {
            log.step('No results from scraping. Will rely entirely on fallback streams.');
        }

    } catch (error) {
        // Enhanced error logging with more context
        console.error(`[HANDLER] Critical error during stream processing:`, {
            error: error.message,
            stack: error.stack,
            type,
            id,
            timestamp: new Date().toISOString()
        });
        log.step(`Critical error occurred: ${error.message}. Providing fallback options.`);
    }

    // Always provide fallback streams, but make them more intelligent
    const fallbackStreams = _getFallbackStreams(metadata, type, id);
    streams.push(...fallbackStreams);

    const duration = Date.now() - start;
    log.step(`Request completed in ${duration}ms. Returning ${streams.length} total streams (including fallbacks).`);

    return { streams };
};

// --- Enhanced Private Helpers ---

/**
 * Intelligently select top results based on score thresholds and quality
 */
const _selectTopResults = (scoredResults, log) => {
    if (scoredResults.length === 0) return [];
    
    const MINIMUM_SCORE = -5; // Allow some negative scores but not completely irrelevant
    const MAXIMUM_RESULTS = 3; // Increased from 2 for better options
    
    // Filter by minimum score first
    const viableResults = scoredResults.filter(result => result.scoreData.score > MINIMUM_SCORE);
    
    if (viableResults.length === 0) {
        log.step(`No results met minimum score threshold (${MINIMUM_SCORE}). Taking top result anyway.`);
        return scoredResults.slice(0, 1);
    }
    
    // Take top results up to maximum
    const selected = viableResults.slice(0, MAXIMUM_RESULTS);
    log.step(`Selected ${selected.length} results with scores: ${selected.map(r => r.scoreData.score.toFixed(2)).join(', ')}`);
    
    return selected;
};

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
        // Primary movie query
        queries.push(`${metadata.title} ${metadata.year || ''} full movie`);
        
        // Additional movie queries for better coverage
        if (metadata.year) {
            queries.push(`"${metadata.title}" ${metadata.year} movie`);
        }
        
        // Fallback query without year if we have one
        if (metadata.year) {
            queries.push(`"${metadata.title}" full movie`);
        }
    } else {
        const paddedSeason = String(metadata.season).padStart(2, '0');
        const paddedEpisode = String(metadata.episode).padStart(2, '0');
        const compactSE = `S${paddedSeason}E${paddedEpisode}`;
        
        // Primary series query
        queries.push(`${metadata.title} ${compactSE}`);
        
        // Enhanced series query with episode title
        if (metadata.episodeTitle) {
            queries.push(`${metadata.title} ${compactSE} ${metadata.episodeTitle}`);
        }
        
        // Alternative format queries
        const spacedSE = `S${paddedSeason} E${paddedEpisode}`;
        queries.push(`"${metadata.title}" ${spacedSE}`);
    }
    
    return queries;
};

const _formatStream = (result, metadata) => {
    let cleanTitle = result.title
        .replace(/ - video Dailymotion/i, '')
        .replace(/\| YouTube/i, '')
        .replace(/- YouTube/i, '')
        .replace(/\| Facebook/i, '')
        .replace(/- Vimeo/i, '')
        .trim()
        .replace(/[\s\-,|]+$/, '');

    // Enhanced stream title with better formatting
    const sourceTag = `[${result.source || 'Stream'}]`;
    const durationInfo = result.duration ? `Duration: ${result.duration}` : '';
    const scoreInfo = result.scoreData ? `Score: ${result.scoreData.score.toFixed(1)}` : '';
    
    let subtitle = [durationInfo, scoreInfo].filter(Boolean).join(' • ');
    
    return {
        title: `${sourceTag} ${cleanTitle}${subtitle ? `\n${subtitle}` : ''}`,
        externalUrl: result.url,
        behaviorHints: { externalUrl: true },
    };
};

const _getFallbackStreams = (metadata, type, originalId) => {
    const fallbacks = [];
    
    if (!metadata || !metadata.title) {
        // Emergency fallback when metadata completely failed
        fallbacks.push({
            title: '🔍 Metadata failed - Manual search required',
            externalUrl: 'https://google.com/search?q=' + encodeURIComponent(`${type} ${originalId} watch online`),
            behaviorHints: { externalUrl: true }
        });
        return fallbacks;
    }
    
    if (type === 'series') {
        const spacedSE = `S${String(metadata.season).padStart(2, '0')} E${String(metadata.episode).padStart(2, '0')}`;
        
        // Generic series search
        const genericQuery = `${metadata.title} ${spacedSE}`;
        fallbacks.push({
            title: `🔍 Search: "${metadata.title}" ${spacedSE}`,
            externalUrl: `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(genericQuery)}&tbs=dur:l&tbm=vid`,
            behaviorHints: { externalUrl: true },
        });
        
        // Enhanced search with episode title
        if (metadata.episodeTitle) {
            const specificQuery = `${metadata.title} ${spacedSE} ${metadata.episodeTitle}`;
            fallbacks.push({
                title: `🔍 Search with episode title: "${metadata.episodeTitle}"`,
                externalUrl: `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(specificQuery)}&tbs=dur:l&tbm=vid`,
                behaviorHints: { externalUrl: true },
            });
        }
        
        // IMDb link as additional option
        if (metadata.imdbId) {
            fallbacks.push({
                title: `🎬 View on IMDb`,
                externalUrl: `https://www.imdb.com/title/${metadata.imdbId}/`,
                behaviorHints: { externalUrl: true },
            });
        }
    } else {
        // Movie fallbacks
        const movieQuery = `${metadata.title} ${metadata.year || ''} full movie`;
        fallbacks.push({
            title: `🔍 Search: "${metadata.title}" (${metadata.year || 'Movie'})`,
            externalUrl: `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(movieQuery)}&tbs=dur:l&tbm=vid`,
            behaviorHints: { externalUrl: true },
        });
        
        // Alternative movie search without year
        if (metadata.year) {
            const altQuery = `"${metadata.title}" full movie`;
            fallbacks.push({
                title: `🔍 Alternative search without year`,
                externalUrl: `${config.scraping.googleSearchUrl}?q=${encodeURIComponent(altQuery)}&tbs=dur:l&tbm=vid`,
                behaviorHints: { externalUrl: true },
            });
        }
        
        // IMDb link for movies too
        if (metadata.imdbId) {
            fallbacks.push({
                title: `🎬 View on IMDb`,
                externalUrl: `https://www.imdb.com/title/${metadata.imdbId}/`,
                behaviorHints: { externalUrl: true },
            });
        }
    }
    
    return fallbacks;
};

module.exports = { getStreams };
