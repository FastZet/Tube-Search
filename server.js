const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio'); // The library for parsing HTML
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

// --- Main function for fetching metadata and streams ---
async function getStreamsForContent(type, id, config) {
    const { tmdbApiKey, omdbApiKey } = config;

    console.log('[Addon Log] Stream handler invoked with config:', {
        tmdbApiKey: tmdbApiKey ? 'Provided' : 'Missing',
        omdbApiKey: omdbApiKey ? 'Provided' : 'Missing'
    });

    if (!tmdbApiKey) { return { streams: [], error: 'TMDb API key is required.' }; }

    let IMDB_ID = null, TMDB_ID = null, queryTitle = '', queryYear = '', seasonNum, episodeNum, episodeTitle = '';

    // --- (This is your existing, robust metadata fetching logic. No changes needed here.) ---
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
                if (!IMDB_ID && directTmdbResponse.data.external_ids && directTmdbResponse.data.external_ids.imdb_id) { IMDB_ID = directTmdbResponse.data.external_ids.imdb_id; }
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

        if (!queryTitle) { throw new Error('Failed to retrieve title.'); }

        if (type === 'series' && TMDB_ID) {
            try {
                const epUrl = `https://api.themoviedb.org/3/tv/${TMDB_ID}/season/${seasonNum}/episode/${episodeNum}?api_key=${tmdbApiKey}`;
                episodeTitle = (await axios.get(epUrl)).data.name;
            } catch (e) { /* Optional */ }
        }
        if (!episodeTitle && type === 'series' && IMDB_ID && omdbApiKey) {
            try {
                const omdbEpUrl = `http://www.omdbapi.com/?apikey=${omdbApiKey}&i=${IMDB_ID}&Season=${seasonNum}&Episode=${episodeNum}`;
                const omdbEpRes = await axios.get(omdbEpUrl);
                if (omdbEpRes.data && omdbEpRes.data.Response === 'True') { episodeTitle = omdbEpRes.data.Title; }
            } catch (e) { /* Optional */ }
        }
        
        // --- UPGRADED SCRAPING LOGIC STARTS HERE ---
        let googleSearchQuery;
        if (type === 'movie') {
            googleSearchQuery = `${queryTitle} ${queryYear || ''} full movie`;
        } else { // series
            const paddedSeason = seasonNum.toString().padStart(2, '0');
            const paddedEpisode = episodeNum.toString().padStart(2, '0');
            googleSearchQuery = `${queryTitle} S${paddedSeason} E${paddedEpisode} ${episodeTitle || ''}`.trim();
        }

        const googleSearchLink = `https://www.google.com/search?q=${encodeURIComponent(googleSearchQuery)}&tbs=dur:l&tbm=vid`;
        let streams = [];
        let html = ''; // Define html here to be available in the catch block

        try {
            console.log(`[Addon Log] Scraping Google for: "${googleSearchQuery}"`);
            const response = await axios.get(googleSearchLink, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36' }
            });
            html = response.data;

            const $ = cheerio.load(html);
            const results = [];
            const seenUrls = new Set();
            const videoDomains = ['youtube.com', 'dailymotion.com', 'vimeo.com', 'archive.org', 'vk.com', 'ok.ru']; // Added vk.com as another potential source

            // New Strategy: Find all links and filter them by known video domains
            $('a').each((i, el) => {
                if (results.length >= 5) return false;

                let url = $(el).attr('href');
                if (!url) return;

                if (url.startsWith('/url?q=')) {
                    const urlParams = new URLSearchParams(url.split('?')[1]);
                    url = urlParams.get('q');
                }

                if (!url || !url.startsWith('http') || seenUrls.has(url)) return;

                const domainMatch = videoDomains.some(domain => url.includes(domain));
                if (domainMatch) {
                    const resultBlock = $(el).closest('div.vt6azd, div.MjjYud'); // Look for the parent container
                    if (resultBlock.length > 0) {
                        const title = resultBlock.find('h3.LC20lb').text();
                        const source = resultBlock.find('cite').first().text().split(' › ')[0].replace('www.', '');
                        const duration = resultBlock.find('.c8rnLc span, .O1CVkc').text();

                        if (title) {
                            results.push({ title, url, source, duration });
                            seenUrls.add(url);
                        }
                    }
                }
            });

            if (results.length === 0) {
                throw new Error('Parsing failed; no known video links found on the page.');
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
            console.error(`[Addon Log] Scraping failed: ${error.message}. Reverting to simple search links.`);
            if (html) {
                console.error('[Addon Log] Full HTML of failed page received from Google. Check for CAPTCHA or layout changes.');
                // For privacy and log neatness, we don't print the whole HTML by default.
                // To debug, you can temporarily uncomment the next line on your own server.
                // require('fs').writeFileSync('debug_page.html', html); // This would save the file for inspection
            } else {
                console.error('[Addon Log] Could not retrieve HTML from Google. Possible network issue or block.');
            }
            
            // Fallback to the reliable link-generation logic
            streams.push({ 
                title: `[Scraping Failed] 🔍 Google Search`,
                externalUrl: googleSearchLink, 
                behaviorHints: { externalUrl: true }
            });
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

// --- (The rest of the file is for the server and remains unchanged) ---
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
