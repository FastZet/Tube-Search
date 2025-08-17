const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio'); // The new library for parsing HTML
const path = require('path');
const manifest = require('./manifest.json');

const app = express();

// Helper function to parse the combined config string
function parseConfigString(configString) {
    let tmdbApiKey = '';
    let omdbApiKey = '';
    if (configString) {
        try {
            const decodedConfigString = decodeURIComponent(configString);
            const params = decodedConfigString.split('|');
            params.forEach(param => {
                const parts = param.split('=');
                if (parts.length === 2) {
                    if (parts[0] === 'tmdb') {
                        tmdbApiKey = parts[1];
                    } else if (parts[0] === 'omdb') {
                        omdbApiKey = parts[1];
                    }
                }
            });
        } catch (e) {
            console.error('[Addon Log] Error decoding or parsing config string:', e.message);
        }
    }
    return { tmdbApiKey, omdbApiKey };
}

// --- Helper function for fetching TMDb/OMDb data and Google Search ---
async function getStreamsForContent(type, id, config) {
    const { tmdbApiKey, omdbApiKey } = config;

    console.log('[Addon Log] Stream handler invoked with config:', {
        tmdbApiKey: tmdbApiKey ? 'Provided' : 'Missing',
        omdbApiKey: omdbApiKey ? 'Provided' : 'Missing'
    });

    if (!tmdbApiKey) {
        console.error('[Addon Log] Missing TMDb API key.');
        return { streams: [], error: 'TMDb API key is required.' };
    }
    if (!omdbApiKey) {
        console.warn('[Addon Log] Missing OMDb API key. OMDb fallback will not be used.');
    }

    let IMDB_ID = null;
    let TMDB_ID = null;
    let queryTitle = '';
    let queryYear = '';
    let seasonNum, episodeNum;
    let episodeTitle = '';

    // --- (This entire metadata fetching section is your existing, robust logic) ---
    try {
        let rawContentId = id;
        if (type === 'series') {
            const parts = id.split(':');
            rawContentId = parts[0];
            IMDB_ID = rawContentId.startsWith('tt') ? rawContentId : null;
            TMDB_ID = (IMDB_ID === null && rawContentId.includes(':')) ? rawContentId.split(':')[1] : (IMDB_ID === null ? rawContentId : null);
            seasonNum = parts[1];
            episodeNum = parts[2];
        } else if (type === 'movie') {
            rawContentId = id;
            IMDB_ID = rawContentId.startsWith('tt') ? rawContentId : null;
            TMDB_ID = (IMDB_ID === null && rawContentId.includes(':')) ? rawContentId.split(':')[1] : (IMDB_ID === null ? rawContentId : null);
        }
        if (TMDB_ID && isNaN(TMDB_ID) && TMDB_ID.includes(':')) { TMDB_ID = TMDB_ID.split(':')[1]; }
        else if (TMDB_ID && isNaN(TMDB_ID) && !TMDB_ID.startsWith('tt')) { TMDB_ID = null; }

        if (IMDB_ID) {
            try {
                const tmdbFindUrl = `https://api.themoviedb.org/3/find/${IMDB_ID}?api_key=${tmdbApiKey}&external_source=imdb_id`;
                const tmdbFindResponse = await axios.get(tmdbFindUrl);
                if (type === 'movie' && tmdbFindResponse.data.movie_results.length > 0) {
                    TMDB_ID = tmdbFindResponse.data.movie_results[0].id;
                    queryTitle = tmdbFindResponse.data.movie_results[0].title;
                    queryYear = (new Date(tmdbFindResponse.data.movie_results[0].release_date)).getFullYear();
                } else if (type === 'series' && tmdbFindResponse.data.tv_results.length > 0) {
                    TMDB_ID = tmdbFindResponse.data.tv_results[0].id;
                    queryTitle = tmdbFindResponse.data.tv_results[0].name;
                    queryYear = (new Date(tmdbFindResponse.data.tv_results[0].first_air_date)).getFullYear();
                }
            } catch (findError) { console.warn(`[Addon Log] TMDb Find error for IMDb ID ${IMDB_ID}: ${findError.message}.`); }
        }
        
        if (TMDB_ID && !queryTitle) {
            const directTmdbUrl = (type === 'movie') ? `https://api.themoviedb.org/3/movie/${TMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids` : `https://api.themoviedb.org/3/tv/${TMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
            try {
                const directTmdbResponse = await axios.get(directTmdbUrl);
                queryTitle = type === 'movie' ? directTmdbResponse.data.title : directTmdbResponse.data.name;
                queryYear = type === 'movie' ? (new Date(directTmdbResponse.data.release_date)).getFullYear() : (new Date(directTmdbResponse.data.first_air_date)).getFullYear();
                if (!IMDB_ID && directTmdbResponse.data.external_ids && directTmdbResponse.data.external_ids.imdb_id) {
                    IMDB_ID = directTmdbResponse.data.external_ids.imdb_id;
                }
            } catch (tmdbIdError) { console.warn(`[Addon Log] Direct TMDb lookup failed for TMDB ID ${TMDB_ID}: ${tmdbIdError.message}`); }
        }

        if (!queryTitle && IMDB_ID && omdbApiKey) {
            const omdbUrl = `http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${IMDB_ID}&plot=short&r=json`;
            try {
                const omdbResponse = await axios.get(omdbUrl);
                if (omdbResponse.data.Response === 'True') {
                    queryTitle = omdbResponse.data.Title;
                    queryYear = omdbResponse.data.Year ? parseInt(omdbResponse.data.Year.substring(0,4)) : '';
                }
            } catch (omdbError) { console.error(`[Addon Log] OMDb API error for IMDb ID ${IMDB_ID}: ${omdbError.message}`); }
        }

        if (queryTitle && !TMDB_ID) {
            try {
                const searchYear = queryYear ? queryYear.toString().substring(0, 4) : '';
                const searchUrl = `https://api.themoviedb.org/3/search/${type === 'movie' ? 'movie' : 'tv'}?api_key=${tmdbApiKey}&query=${encodeURIComponent(queryTitle)}&first_air_date_year=${searchYear}`;
                const searchResponse = await axios.get(searchUrl);
                if (searchResponse.data && searchResponse.data.results.length > 0) {
                    const bestMatch = searchResponse.data.results.find(r => (r.name || r.title) === queryTitle);
                    TMDB_ID = bestMatch ? bestMatch.id : searchResponse.data.results[0].id;
                }
            } catch (searchError) { console.warn(`[Addon Log] TMDb search fallback failed: ${searchError.message}`); }
        }

        if (!queryTitle) {
            console.log('[Addon Log] Failed to retrieve title. Cannot generate search link.');
            return { streams: [] };
        }

        if (type === 'series' && TMDB_ID && seasonNum && episodeNum) {
            try {
                const episodeUrl = `https://api.themoviedb.org/3/tv/${TMDB_ID}/season/${seasonNum}/episode/${episodeNum}?api_key=${tmdbApiKey}`;
                const episodeResponse = await axios.get(episodeUrl);
                if (episodeResponse.data && episodeResponse.data.name) {
                    episodeTitle = episodeResponse.data.name;
                }
            } catch (e) { /* Episode name is optional, so we ignore errors */ }
        }
        if (!episodeTitle && type === 'series' && IMDB_ID && seasonNum && episodeNum && omdbApiKey) {
            try {
                const omdbEpisodeUrl = `http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${IMDB_ID}&Season=${seasonNum}&Episode=${episodeNum}`;
                const omdbEpisodeResponse = await axios.get(omdbEpisodeUrl);
                if (omdbEpisodeResponse.data && omdbEpisodeResponse.data.Response === 'True' && omdbEpisodeResponse.data.Title) {
                    episodeTitle = omdbEpisodeResponse.data.Title;
                }
            } catch (e) { /* Also optional */ }
        }

        // --- NEW LOGIC STARTS HERE: SCRAPING FEATURE ---
        
        let googleSearchQuery;
        if (type === 'movie') {
            googleSearchQuery = `${queryTitle} ${queryYear || ''} full movie`;
        } else if (type === 'series' && seasonNum && episodeNum) {
            const paddedSeason = seasonNum.toString().padStart(2, '0');
            const paddedEpisode = episodeNum.toString().padStart(2, '0');
            // Use the most specific query available for scraping
            googleSearchQuery = `${queryTitle} S${paddedSeason} E${paddedEpisode} ${episodeTitle || ''}`.trim();
        } else {
            return { streams: [] };
        }

        const googleSearchLink = `https://www.google.com/search?q=${encodeURIComponent(googleSearchQuery)}&tbs=dur:l&tbm=vid`;
        let streams = [];

        try {
            console.log(`[Addon Log] Scraping Google for: "${googleSearchQuery}"`);
            const { data: html } = await axios.get(googleSearchLink, {
                headers: {
                    // Updated User-Agent for August 2025
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
                }
            });

            const $ = cheerio.load(html);
            const results = [];

            $('div.vt6azd').slice(0, 5).each((i, el) => {
                const titleEl = $(el).find('h3.LC20lb');
                const linkEl = $(el).find('a.VfSr4c');
                const citeEl = $(el).find('cite.tLk3Jb');
                const durationEl = $(el).find('.c8rnLc span');
                const title = titleEl.text();
                let url = linkEl.attr('href');
                
                if (url && url.startsWith('/url?q=')) {
                    const urlParams = new URLSearchParams(url.split('?')[1]);
                    url = urlParams.get('q');
                }

                const source = citeEl.first().text().split(' › ')[0].replace('www.', '');
                const duration = durationEl.text();

                if (title && url && url.startsWith('http')) {
                    results.push({ title, url, source, duration });
                }
            });

            if (results.length === 0) {
                throw new Error('Parsing failed; no video results found on page.');
            }

            console.log(`[Addon Log] Found ${results.length} streamable results.`);
            results.forEach(res => {
                streams.push({
                    title: `[${res.source || 'Stream'}] ${res.title}\n${res.duration ? `Duration: ${res.duration}` : ''}`,
                    externalUrl: res.url,
                    behaviorHints: { externalUrl: true }
                });
            });

        } catch (error) {
            // --- FALLBACK MECHANISM ---
            console.error(`[Addon Log] Scraping failed: ${error.message}. Reverting to simple search links.`);
            // Use your original, reliable link-generation logic as the fallback
            if (type === 'movie') {
                streams.push({ 
                    title: `[Scraping Failed] 🔍 Google Search`,
                    externalUrl: googleSearchLink, 
                    behaviorHints: { externalUrl: true }
                });
            } else if (type === 'series') {
                const paddedSeason = seasonNum.toString().padStart(2, '0');
                const paddedEpisode = episodeNum.toString().padStart(2, '0');
                const genericSearchQuery = `${queryTitle} S${paddedSeason} E${paddedEpisode}`;
                const genericSearchLink = `https://www.google.com/search?q=${encodeURIComponent(genericSearchQuery)}&tbs=dur:l&tbm=vid`;
                streams.push({
                    title: `[Scraping Failed] 🔍 Google (No Title)`,
                    externalUrl: genericSearchLink,
                    behaviorHints: { externalUrl: true }
                });
                if (episodeTitle) {
                    streams.unshift({ // Add the more specific one first
                        title: `[Scraping Failed] 🔍 Google (With Title)`,
                        externalUrl: googleSearchLink, // This already has the full title
                        behaviorHints: { externalUrl: true }
                    });
                }
            }
        }

        // Always add a "More Results" link at the end
        if (streams.length > 0) {
            streams.push({
                title: `🔍 See all results on Google...`,
                externalUrl: googleSearchLink,
                behaviorHints: { externalUrl: true }
            });
        }
        
        return { streams };

    } catch (error) {
        console.error(`[Addon Log] General error in getStreamsForContent:`, error.message);
        return { streams: [], error: 'Failed to retrieve streams due to an internal error.' };
    }
}


// --- Stremio Add-on API Routes ---
app.get('/:configString/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  const { tmdbApiKey, omdbApiKey } = parseConfigString(req.params.configString);
  const configuredManifest = { ...manifest };
  configuredManifest.id = configuredManifest.id + `_${tmdbApiKey.substring(0,5)}_${omdbApiKey.substring(0,5)}`; 
  configuredManifest.name = `Tube Search`; 
  configuredManifest.config = { tmdbApiKey, omdbApiKey };
  res.json(configuredManifest);
});

app.get('/:configString/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  const { tmdbApiKey, omdbApiKey } = parseConfigString(req.params.configString);
  const { type, id } = req.params;
  try {
    const config = { tmdbApiKey, omdbApiKey };
    const result = await getStreamsForContent(type, id, config); 
    res.json(result);
  } catch (error) {
    console.error('[Server Log] Stream handler error:', error);
    res.status(500).json({ err: 'Internal server error processing stream request.' });
  }
});

// --- Custom Configuration Page Route ---
app.get('/', (req, res) => {
    res.redirect('/configure');
});

app.get('/:configString?/configure', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.status(404).send('Not Found');
});

// Start the HTTP server
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
    console.log(`Tube Search add-on running on port ${PORT}`);
    console.log(`Manifest URL (example): http://localhost:${PORT}/tmdb=YOUR_TMDB_KEY|omdb=YOUR_OMDB_KEY/manifest.json`);
});
