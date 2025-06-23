const express = require('express');
const axios = require('axios');
const path = require('path');
const manifest = require('./manifest.json');

const app = express();

// --- Helper function for fetching TMDb data and Google Search ---
async function getStreamsForContent(type, id, config) {
    const { tmdbApiKey } = config; // Removed youtubeApiKey as it's no longer needed

    console.log('[Addon Log] Stream handler invoked with config:', {
        tmdbApiKey: tmdbApiKey ? 'Provided' : 'Missing'
    });

    if (!tmdbApiKey) {
        console.error('[Addon Log] Missing TMDb API key.');
        return { streams: [], error: 'TMDb API key is required.' };
    }

    let IMDB_ID = null;
    let TMDB_ID = null;
    let queryTitle = '';
    let queryYear = '';

    // Series specific parsing (season/episode numbers)
    let seasonNum, episodeNum;
    if (type === 'series') {
        const parts = id.split(':');
        IMDB_ID = parts[0].startsWith('tt') ? parts[0] : null;
        TMDB_ID = (parts[0] && !IMDB_ID) ? parts[0] : null; // If no tt, assume it's a TMDB ID
        seasonNum = parts[1];
        episodeNum = parts[2];
        console.log(`[Addon Log] Parsed Series ID: IMDB=${IMDB_ID}, TMDB=${TMDB_ID}, S:${seasonNum}, E:${episodeNum}`);
    } else if (type === 'movie') {
        IMDB_ID = id.startsWith('tt') ? id : null;
        TMDB_ID = (id && !IMDB_ID) ? id : null; // If no tt, assume it's a TMDB ID
        console.log(`[Addon Log] Parsed Movie ID: IMDB=${IMDB_ID}, TMDB=${TMDB_ID}`);
    }

    try {
        // --- Step 1: Get TMDb details based on provided ID ---
        if (IMDB_ID) {
            // Option 1: Try TMDb /find endpoint with IMDb ID (often good for cross-referencing)
            try {
                const tmdbFindUrl = `https://api.themoviedb.org/3/find/${IMDB_ID}?api_key=${tmdbApiKey}&external_source=imdb_id`;
                console.log(`[Addon Log] Trying TMDb find with IMDb ID: ${IMDB_ID}`);
                const tmdbFindResponse = await axios.get(tmdbFindUrl);

                if (type === 'movie' && tmdbFindResponse.data.movie_results.length > 0) {
                    TMDB_ID = tmdbFindResponse.data.movie_results[0].id;
                    queryTitle = tmdbFindResponse.data.movie_results[0].title;
                    queryYear = (new Date(tmdbFindResponse.data.movie_results[0].release_date)).getFullYear();
                    console.log(`[Addon Log] Found movie via TMDb Find: ${queryTitle}`);
                } else if (type === 'series' && tmdbFindResponse.data.tv_results.length > 0) {
                    TMDB_ID = tmdbFindResponse.data.tv_results[0].id;
                    queryTitle = tmdbFindResponse.data.tv_results[0].name;
                    queryYear = (new Date(tmdbFindResponse.data.tv_results[0].first_air_date)).getFullYear();
                    console.log(`[Addon Log] Found series via TMDb Find: ${queryTitle}`);
                } else {
                    console.log(`[Addon Log] TMDb Find did not return results for IMDb ID: ${IMDB_ID}. Trying direct lookup.`);
                }
            } catch (findError) {
                console.warn(`[Addon Log] TMDb Find error for IMDb ID ${IMDB_ID}: ${findError.message}. Trying direct lookup.`);
            }

            // Fallback for IMDb ID: Direct TMDb movie/tv endpoint if find failed or didn't provide enough.
            if (!queryTitle) {
                const directTmdbUrl = (type === 'movie') ?
                    `https://api.themoviedb.org/3/movie/${IMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids` :
                    `https://api.themoviedb.org/3/tv/${IMDB_ID}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
                
                try {
                    console.log(`[Addon Log] Trying direct TMDb lookup with IMDb ID: ${IMDB_ID}`);
                    const directTmdbResponse = await axios.get(directTmdbUrl);
                    if (type === 'movie') {
                        TMDB_ID = directTmdbResponse.data.id;
                        queryTitle = directTmdbResponse.data.title;
                        queryYear = (new Date(directTmdbResponse.data.release_date)).getFullYear();
                    } else { // series
                        TMDB_ID = directTmdbResponse.data.id;
                        queryTitle = directTmdbResponse.data.name;
                        queryYear = (new Date(directTmdbResponse.data.first_air_date)).getFullYear();
                    }
                    console.log(`[Addon Log] Found ${type} via direct TMDb lookup: ${queryTitle}`);
                } catch (directError) {
                    console.error(`[Addon Log] Direct TMDb lookup failed for IMDb ID ${IMDB_ID}: ${directError.message}`);
                }
            }
        } 
        
        // If we still don't have a title, but we have a TMDB_ID (e.g., from a TMDB catalog addon)
        if (TMDB_ID && !queryTitle) {
            const directTmdbUrl = (type === 'movie') ?
                `https://api.themoviedb.org/3/movie/${TMDB_ID}?api_key=${tmdbApiKey}` :
                `https://api.themoviedb.org/3/tv/${TMDB_ID}?api_key=${tmdbApiKey}`;
            
            try {
                console.log(`[Addon Log] Trying direct TMDb lookup with TMDB ID: ${TMDB_ID}`);
                const directTmdbResponse = await axios.get(directTmdbUrl);
                if (type === 'movie') {
                    queryTitle = directTmdbResponse.data.title;
                    queryYear = (new Date(directTmdbResponse.data.release_date)).getFullYear();
                } else { // series
                    queryTitle = directTmdbResponse.data.name;
                    queryYear = (new Date(directTmdbResponse.data.first_air_date)).getFullYear();
                }
                console.log(`[Addon Log] Found ${type} via direct TMDb ID lookup: ${queryTitle}`);
            } catch (tmdbIdError) {
                console.error(`[Addon Log] Direct TMDb lookup failed for TMDB ID ${TMDB_ID}: ${tmdbIdError.message}`);
            }
        }


        if (!queryTitle) {
            console.log('[Addon Log] Failed to retrieve title from TMDb using any method. Cannot generate search link.');
            return { streams: [] };
        }

        // --- Step 2: Enhance search query for series and movies ---
        let googleSearchQuery = `${queryTitle} ${queryYear || ''}`;
        if (type === 'movie') {
            googleSearchQuery += ' full movie';
        } else if (type === 'series' && seasonNum && episodeNum) {
            googleSearchQuery = `${queryTitle} S${seasonNum} E${episodeNum}`;
        }
        
        const streams = [];

        // --- NEW: Add Google Search Stream Result (only stream result) ---
        const googleSearchBaseUrl = "https://www.google.com/search?";
        const googleSearchLink = `${googleSearchBaseUrl}q=${encodeURIComponent(googleSearchQuery)}&tbs=dur:l&tbm=vid`;

        streams.unshift({ 
            title: `🔎 Google Search: "${googleSearchQuery}" (Long Videos)`,
            externalUrl: googleSearchLink, 
            behaviorHints: {
                externalUrl: true 
            }
        });
        console.log('[Addon Log] Added Google Search stream result.');
        // --- END NEW ---

        return { streams };

    } catch (error) {
        console.error(`[Addon Log] General error in getStreamsForContent:`, error.message);
        if (error.response) {
            console.error(`[Addon Log] API Error Status: ${error.response.status}, Data:`, error.response.data);
            if (error.response.status === 403) {
                return { streams: [], error: 'TMDb API Key (403): Quota Exceeded or Permissions Issue.' };
            }
            if (error.response.status === 401) {
                return { streams: [], error: 'TMDb API Key (401): Unauthorized. Check your API key.' };
            }
            if (error.response.status === 404) {
                return { streams: [], error: 'TMDb (404): Content not found.' };
            }
        }
        return { streams: [], error: 'Failed to retrieve streams due to an internal error.' };
    }
}


// --- Stremio Add-on API Routes ---

// Serve the manifest.json file directly
app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // Extract query parameters from the request to manifest.json
  const tmdbApiKey = req.query.tmdbApiKey || ''; // Removed youtubeApiKey
  // Other config parameters related to YouTube max streams, duration, sort are also removed
  // as they are no longer relevant without YouTube API searches.

  // Attach configuration to the manifest
  const configuredManifest = { ...manifest };
  // Update unique ID and name
  configuredManifest.id = configuredManifest.id + `_${tmdbApiKey.substring(0,5)}_(GoogleSearch)`; 
  configuredManifest.name = `Tube Search (Google Search)`; 
  configuredManifest.config = {
    tmdbApiKey
  };
  
  res.json(configuredManifest);
});

// Handle Stream requests
app.get('/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  const { type, id } = req.params;
  console.log(`[Server Log] Received stream request for Type: ${type}, ID: ${id}`); 

  try {
    // Extract configuration from the request URL
    const { tmdbApiKey } = req.query; // Removed youtubeApiKey

    const config = {
        tmdbApiKey
    };
    
    console.log(`[Server Log] Parsed stream arguments: ${JSON.stringify({ type, id })} with config: ${JSON.stringify(config)}`); 
    
    // Call the helper function to get streams
    const result = await getStreamsForContent(type, id, config); 
    
    console.log(`[Server Log] Stream handler returned result: ${result.streams ? result.streams.length + ' streams' : result.error}`); 
    res.json(result);

  } catch (error) {
    console.error('[Server Log] Stream handler error:', error);
    res.status(500).json({ err: 'Internal server error processing stream request.' });
  }
});

// --- Custom Configuration Page Route ---

// Redirect root path to /configure
app.get('/', (req, res) => {
    res.redirect('/configure');
});

// Explicitly serve configure.html for the /configure path
app.get('/configure', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

// Serve other static assets from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));


// Fallback for any other request not handled by specific routes
app.get('*', (req, res) => {
    res.status(404).send('Not Found');
});


// Start the HTTP server
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
    console.log(`Tube Search add-on running on port ${PORT}`);
    console.log(`Manifest URL (example): http://localhost:${PORT}/manifest.json?tmdbApiKey=YOUR_TMDB_KEY`);
    console.log(`Configure URL: http://localhost:${PORT}/configure`);
});
