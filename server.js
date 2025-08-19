const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const manifest = require('./manifest.json');

const app = express();

// Helper function to parse the combined config string
function parseConfigString(configString) {
    let tmdbApiKey = '', omdbApiKey = '';
    if (configString) {
        try {
            const decodedConfigString = decodeURIComponent(configString);
            decodedConfigString.split('|').forEach(param => {
                const [key, value] = param.split('=');
                if (key === 'tmdb') tmdbApiKey = value;
                else if (key === 'omdb') omdbApiKey = value;
            });
        } catch (e) { console.error('[Log] Error decoding config string:', e.message); }
    }
    return { tmdbApiKey, omdbApiKey };
}

// Helper function to parse duration strings into minutes
function parseDurationToMinutes(durationStr) {
    if (!durationStr || typeof durationStr !== 'string') return null;
    const parts = durationStr.split(':').map(Number);
    let minutes = 0;
    if (parts.length === 3) { minutes = (parts[0] * 60) + parts[1] + (parts[2] / 60); }
    else if (parts.length === 2) { minutes = parts[0] + (parts[1] / 60); }
    else { return null; }
    return isNaN(minutes) ? null : minutes;
}

// --- Main function for fetching metadata and streams ---
async function getStreamsForContent(type, id, config) {
    console.log(`\n[Log] ----- New Request Started: ${type} ${id} -----`);
    const { tmdbApiKey, omdbApiKey } = config;
    if (!tmdbApiKey) { return { streams: [], error: 'TMDb API key is required.' }; }

    let IMDB_ID = null, TMDB_ID = null, queryTitle = '', queryYear = '', seasonNum, episodeNum, episodeTitle = '';
    let apiRuntime = null;
    let streams = []; // Define streams at the top level

    try {
        console.log('[Log Step 1/5] Starting metadata enrichment...');
        // --- (Metadata fetching logic) ---
        let rawContentId = id;
        if (type === 'series') { const parts = id.split(':'); rawContentId = parts[0]; IMDB_ID = rawContentId.startsWith('tt') ? rawContentId : null; TMDB_ID = (IMDB_ID === null && rawContentId.includes(':')) ? rawContentId.split(':')[1] : (IMDB_ID === null ? rawContentId : null); seasonNum = parts[1]; episodeNum = parts[2]; } 
        else if (type === 'movie') { rawContentId = id; IMDB_ID = rawContentId.startsWith('tt') ? rawContentId : null; TMDB_ID = (IMDB_ID === null && rawContentId.includes(':')) ? rawContentId.split(':')[1] : (IMDB_ID === null ? rawContentId : null); }
        if (TMDB_ID && isNaN(TMDB_ID) && TMDB_ID.includes(':')) { TMDB_ID = TMDB_ID.split(':')[1]; } else if (TMDB_ID && isNaN(TMDB_ID) && !TMDB_ID.startsWith('tt')) { TMDB_ID = null; }
        if (IMDB_ID) { try { const res = await axios.get(`https://api.themoviedb.org/3/find/${IMDB_ID}?api_key=${tmdbApiKey}&external_source=imdb_id`); if (type === 'movie' && res.data.movie_results.length > 0) { TMDB_ID = res.data.movie_results[0].id; queryTitle = res.data.movie_results[0].title; queryYear = new Date(res.data.movie_results[0].release_date).getFullYear(); } else if (type === 'series' && res.data.tv_results.length > 0) { TMDB_ID = res.data.tv_results[0].id; queryTitle = res.data.tv_results[0].name; queryYear = new Date(res.data.tv_results[0].first_air_date).getFullYear(); } } catch (e) { console.warn(`[Log] TMDb Find error: ${e.message}.`); } }
        if (TMDB_ID && !queryTitle) { try { const url = (type === 'movie') ? `https://api.themoviedb.org/3/movie/${TMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids` : `https://api.themoviedb.org/3/tv/${TMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids`; const res = await axios.get(url); queryTitle = type === 'movie' ? res.data.title : res.data.name; queryYear = type === 'movie' ? new Date(res.data.release_date).getFullYear() : new Date(res.data.first_air_date).getFullYear(); if (type === 'movie' && res.data.runtime) apiRuntime = res.data.runtime; if (!IMDB_ID && res.data.external_ids?.imdb_id) IMDB_ID = res.data.external_ids.imdb_id; } catch (e) { console.warn(`[Log] Direct TMDb lookup failed: ${e.message}`); } }
        if (!queryTitle && IMDB_ID && omdbApiKey) { try { const res = await axios.get(`http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${IMDB_ID}&plot=short&r=json`); if (res.data.Response === 'True') { queryTitle = res.data.Title; queryYear = res.data.Year ? parseInt(res.data.Year.substring(0, 4)) : ''; if (res.data.Runtime !== "N/A") apiRuntime = parseInt(res.data.Runtime); } } catch (e) { console.error(`[Log] OMDb API error: ${e.message}`); } }
        if (queryTitle && !TMDB_ID) { try { const url = `https://api.themoviedb.org/3/search/${type === 'movie' ? 'movie' : 'tv'}?api_key=${tmdbApiKey}&query=${encodeURIComponent(queryTitle)}&first_air_date_year=${queryYear ? queryYear.toString().substring(0, 4) : ''}`; const res = await axios.get(url); if (res.data?.results.length > 0) TMDB_ID = (res.data.results.find(r => (r.name || r.title) === queryTitle) || res.data.results[0]).id; } catch (e) { console.warn(`[Log] TMDb search fallback failed: ${e.message}`); } }
        if (!queryTitle) { throw new Error('Failed to retrieve title.'); }
        if (type === 'series' && TMDB_ID) { try { const res = await axios.get(`https://api.themoviedb.org/3/tv/${TMDB_ID}/season/${seasonNum}/episode/${episodeNum}?api_key=${tmdbApiKey}`); episodeTitle = res.data.name; if (res.data.runtime) apiRuntime = res.data.runtime; } catch (e) { /* Optional */ } }
        if (!episodeTitle && type === 'series' && IMDB_ID && omdbApiKey) { try { const res = await axios.get(`http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${IMDB_ID}&Season=${seasonNum}&Episode=${episodeNum}`); if (res.data?.Response === 'True') { episodeTitle = res.data.Title; if (res.data.Runtime !== "N/A") apiRuntime = parseInt(res.data.Runtime); } } catch (e) { /* Optional */ } }
        console.log(`[Log] Metadata found: Title='${queryTitle}', Episode='${episodeTitle || 'N/A'}', Runtime=${apiRuntime || 'N/A'} mins.`);
        
        // --- HYBRID SCRAPING & SCORING LOGIC ---
        const searchQueries = [];
        if (type === 'movie') {
            searchQueries.push(`${queryTitle} ${queryYear || ''} full movie`);
        } else if (type === 'series') {
            const paddedSeason = seasonNum.toString().padStart(2, '0');
            const paddedEpisode = episodeNum.toString().padStart(2, '0');
            const compactSE = `S${paddedSeason}E${paddedEpisode}`;

            // Main query with Season/Episode number
            searchQueries.push(`${queryTitle} ${compactSE}`);
            
            // Add a second, more specific query if we have an episode title
            if (episodeTitle) {
                searchQueries.push(`${queryTitle} ${compactSE} ${episodeTitle}`);
            }
        }

        let allResults = []; 
        const seenUrls = new Set();
        console.log(`[Log Step 2/5] Starting Google scraping for ${searchQueries.length} queries.`);
        for (const query of searchQueries) {
            try {
                const googleSearchLink = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbs=dur:l&tbm=vid`;
                const response = await axios.get(googleSearchLink, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36' } });
                const $ = cheerio.load(response.data);
                $('div.vt6azd').each((i, el) => {
                    const linkEl = $(el).find('a').first(); 
                    let url = linkEl.attr('href'); 
                    if (url && url.startsWith('/url?q=')) { 
                        url = new URLSearchParams(url.split('?')[1]).get('q'); 
                    }
                    if (url && url.startsWith('http') && !seenUrls.has(url)) {
                        const title = $(el).find('h3.LC20lb').first().text(); 
                        const source = $(el).find('cite').first().text().split(' › ')[0].replace('www.', ''); 
                        const duration = $(el).find('.c8rnLc span, .O1CVkc').first().text();
                        if(title) { 
                            allResults.push({ title, url, source, duration, index: i }); 
                            seenUrls.add(url); 
                        }
                    }
                });
            } catch (error) { console.error(`[Log] Failed to scrape query "${query}": ${error.message}`); }
        }
        console.log(`[Log Step 3/5] Found ${allResults.length} initial unique results from all queries.`);

        console.log('[Log Step 4/5] Scoring results...');
        const videoDomains = ['youtube.com', 'dailymotion.com', 'vimeo.com', 'archive.org', 'facebook.com', 'ok.ru'];

        const calculateScore = (result) => {
            const lowerTitle = result.title.toLowerCase();
            const lowerQueryTitle = queryTitle.toLowerCase();
            const lowerEpisodeTitle = episodeTitle ? episodeTitle.toLowerCase() : '';
            
            let scoreBreakdown = { title: 0, episodeNum: 0, episodeTitle: 0, season: 0, duration: 0, whitelist: 0, googleRank: 0, durationDiff: null };

            // 1. Google Rank Bonus (Max 5 points) - Highest score for the top result
            scoreBreakdown.googleRank = Math.max(0, 5 - result.index);

            // 2. Title Match (Max 6 points) - Strong score for matching series name
            if (lowerTitle.includes(lowerQueryTitle)) {
                scoreBreakdown.title = 6;
            } else {
                const queryWords = lowerQueryTitle.split(' ');
                const matchedWords = queryWords.filter(word => lowerTitle.includes(word));
                scoreBreakdown.title = 6 * (matchedWords.length / queryWords.length);
                if (queryWords.length > 2 && matchedWords.length < queryWords.length - 1) scoreBreakdown.title -= 5;
            }

            // 3. Episode & Season Score (for series only)
            if (type === 'series') {
                const ep_num = parseInt(episodeNum, 10);
                const episodeNumRegex = new RegExp(`episode\\s+0?${ep_num}|e0?${ep_num}`, 'i');
                
                // Episode Number Match (Max 5 points) - High value
                if (episodeNumRegex.test(lowerTitle)) {
                    scoreBreakdown.episodeNum = 5;
                }

                // Episode Title Match (Max 5 points) - Equally high value
                if (lowerEpisodeTitle && lowerTitle.includes(lowerEpisodeTitle)) {
                    scoreBreakdown.episodeTitle = 5;
                }
                
                // Season Match (Bonus 2 points)
                const s_num = parseInt(seasonNum, 10);
                const seasonMatchRegex = new RegExp(`season\\s+0?${s_num}|s0?${s_num}`, 'i');
                if (seasonMatchRegex.test(lowerTitle)) {
                    scoreBreakdown.season = 2;
                }
            }

            // 4. Duration Match (Max 6 points, -10 penalty)
            if (apiRuntime > 0) {
                const scrapedMinutes = parseDurationToMinutes(result.duration);
                scoreBreakdown.durationDiff = scrapedMinutes ? Math.abs(scrapedMinutes - apiRuntime) : null;
                if (scrapedMinutes) {
                    const tolerance = type === 'movie' ? 20 : 3; // 3 min tolerance for episodes
                    if (scoreBreakdown.durationDiff <= tolerance) {
                        scoreBreakdown.duration = 6 * (1 - (scoreBreakdown.durationDiff / tolerance));
                    } else {
                        scoreBreakdown.duration = -10; // Heavy penalty for mismatch
                    }
                }
            }
            
            // 5. Whitelist Bonus (1 point)
            if (videoDomains.some(domain => result.url.includes(domain))) {
                scoreBreakdown.whitelist = 1;
            }

            const totalScore = Object.values(scoreBreakdown).reduce((acc, val) => acc + (typeof val === 'number' ? val : 0), 0);
            return { score: totalScore, breakdown: scoreBreakdown };
        };

        const scoredResults = allResults.map(res => { const { score, breakdown } = calculateScore(res); return { ...res, score, breakdown }; });
        scoredResults.sort((a, b) => b.score - a.score);
        
        console.log('[Log Step 4.5] Detailed scoring for top results:');
        scoredResults.slice(0, 5).forEach((result, index) => {
            console.log(`[Log] --- Result ${index + 1}: "${result.title}" ---`);
            console.log(`[Log]   - Final Score: ${result.score.toFixed(2)}`);
            console.log(`[Log]   - Breakdown: Title(${result.breakdown.title.toFixed(2)}), EpNum(${result.breakdown.episodeNum.toFixed(2)}), EpTitle(${result.breakdown.episodeTitle.toFixed(2)}), Season(${result.breakdown.season.toFixed(2)}), Duration(${result.breakdown.duration.toFixed(2)}), Whitelist(${result.breakdown.whitelist.toFixed(2)}), GoogleRank(${result.breakdown.googleRank.toFixed(2)})`);
            if (result.breakdown.durationDiff !== null) console.log(`[Log]   - Duration Difference: ${result.breakdown.durationDiff.toFixed(2)} mins`);
        });

        if (scoredResults.length > 0 && scoredResults[0].score > 0) {
             const finalResults = scoredResults.slice(0, 1);
             console.log(`[Log Step 5/5] Success. Returning ${finalResults.length} best stream.`);
             streams = finalResults.map(res => {
                let cleanTitle = res.title.replace(/ - video Dailymotion/i, '').replace(/\| YouTube/i, '').replace(/- YouTube/i, '').replace(/\| Facebook/i, '').trim().replace(/[\s\-,|]+$/, '');
                return { title: `[${res.source || 'Stream'}] ${cleanTitle}\n${res.duration ? `Duration: ${res.duration}` : ''}`, externalUrl: res.url, behaviorHints: { externalUrl: true } };
            });
        } else {
            console.warn('[Log Step 5/5] Failure. No results scored high enough.');
            throw new Error('No valid video results found after all scraping attempts and filtering.');
        }

    } catch (error) {
        console.error(`[Log] FINAL FALLBACK: ${error.message}.`);
        streams.push({ title: `[Scraping Failed] 🔍 Google Search`, externalUrl: `https://www.google.com/search?q=${encodeURIComponent(searchQueries[0])}&tbs=dur:l&tbm=vid`, behaviorHints: { externalUrl: true } });
    }

    // --- Final link assembly is now outside the try/catch, ensuring it always runs ---
    if (type === 'series') {
        const spacedSE = `S${seasonNum.toString().padStart(2, '0')} E${episodeNum.toString().padStart(2, '0')}`;
        const genericQuery = `${queryTitle} ${spacedSE}`;
        const genericSearchLink = `https://www.google.com/search?q=${encodeURIComponent(genericQuery)}&tbs=dur:l&tbm=vid`;
        
        streams.push({ title: `🔍 No Title: See all results on Google...`, externalUrl: genericSearchLink, behaviorHints: { externalUrl: true } });

        if (episodeTitle) {
            const specificQuery = `${queryTitle} ${spacedSE} ${episodeTitle}`;
            const specificSearchLink = `https://www.google.com/search?q=${encodeURIComponent(specificQuery)}&tbs=dur:l&tbm=vid`;
            streams.push({ title: `🔍 With Title: See all results on Google...`, externalUrl: specificSearchLink, behaviorHints: { externalUrl: true } });
        }
    } else if (type === 'movie') {
        const movieQuery = `${queryTitle} ${queryYear || ''} full movie`;
        const googleSearchLink = `https://www.google.com/search?q=${encodeURIComponent(movieQuery)}&tbs=dur:l&tbm=vid`;
        streams.push({ title: `🔍 See all results on Google...`, externalUrl: googleSearchLink, behaviorHints: { externalUrl: true } });
    }

    return { streams };
}

// --- (Server routes - no changes needed here) ---
app.get('/:configString/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
  const { tmdbApiKey, omdbApiKey } = parseConfigString(req.params.configString);
  const configuredManifest = { ...manifest, id: manifest.id + `_${tmdbApiKey.substring(0,5)}_${omdbApiKey.substring(0,5)}`, name: 'Tube Search', config: { tmdbApiKey, omdbApiKey } };
  res.json(configuredManifest);
});
app.get('/:configString/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
  const { tmdbApiKey, omdbApiKey } = parseConfigString(req.params.configString);
  const { type, id } = req.params;
  try { const result = await getStreamsForContent(type, id, { tmdbApiKey, omdbApiKey }); res.json(result); } 
  catch (error) { console.error('[Server Log] Stream handler error:', error); res.status(500).json({ err: 'Internal server error.' }); }
});
app.get('/', (req, res) => { res.redirect('/configure'); });
app.get('/:configString?/configure', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => { res.status(404).send('Not Found'); });
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
    console.log(`Tube Search add-on running on port ${PORT}`);
    console.log(`Manifest URL (example): http://localhost:${PORT}/tmdb=YOUR_TMDB_KEY|omdb=YOUR_OMDB_KEY/manifest.json`);
});
