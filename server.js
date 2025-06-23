const express = require('express');
const axios = require('axios');
const path = require('path');
const { exec } = require('child_process'); // NEW: Import exec for running shell commands
const manifest = require('./manifest.json');

const app = express();

// --- NEW: Helper function to get direct YouTube URL using yt-dlp ---
function getYtdlpDirectUrl(youtubeVideoId) {
    return new Promise((resolve, reject) => {
        // -f best: select the best quality format
        // --get-url: just print the URL to stdout
        const command = `yt-dlp -f best --get-url https://www.youtube.com/watch?v=${youtubeVideoId}`;
        console.log(`[Addon Log] Executing yt-dlp command: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`[Addon Log] yt-dlp error for ${youtubeVideoId}: ${error.message}`);
                // console.error(`[Addon Log] yt-dlp stderr: ${stderr}`); // Uncomment for detailed error debugging
                reject(new Error(`Failed to get direct URL: ${error.message}`));
                return;
            }
            if (stderr) {
                console.warn(`[Addon Log] yt-dlp stderr for ${youtubeVideoId}: ${stderr}`);
            }
            const directUrl = stdout.trim();
            if (directUrl) {
                console.log(`[Addon Log] yt-dlp successful for ${youtubeVideoId}. Direct URL obtained.`);
                resolve(directUrl);
            } else {
                console.warn(`[Addon Log] yt-dlp returned no URL for ${youtubeVideoId}.`);
                reject(new Error('yt-dlp returned no direct URL.'));
            }
        });
    });
}
// --- END NEW HELPER FUNCTION ---

// --- Helper function for fetching TMDb and YouTube data ---
async function getStreamsForContent(type, id, config) {
    const { youtubeApiKey, tmdbApiKey, maxStreams, videoDuration, videoSort } = config;

    console.log('[Addon Log] Stream handler invoked with config:', {
        maxStreams,
        videoDuration,
        videoSort,
        youtubeApiKey: youtubeApiKey ? 'Provided' : 'Missing',
        tmdbApiKey: tmdbApiKey ? 'Provided' : 'Missing'
    });

    if (!youtubeApiKey || !tmdbApiKey) {
        console.error('[Addon Log] Missing YouTube or TMDb API key.');
        return { streams: [], error: 'API keys are required.' };
    }

    let IMDB_ID = id; // Default for movies

    let queryTitle = '';
    let queryYear = '';
    // --- NEW: Series ID Parsing ---
    let seasonNum, episodeNum;
    if (type === 'series') {
        const parts = id.split(':');
        IMDB_ID = parts[0]; // tt7587890
        seasonNum = parts[1]; // 2
        episodeNum = parts[2]; // 1
        console.log(`[Addon Log] Parsed Series ID: ${IMDB_ID}, S:${seasonNum}, E:${episodeNum}`);
    }
    // --- END NEW: Series ID Parsing ---

    try {
        // Step 1: Get TMDb ID from IMDb ID
        const tmdbFindUrl = `https://api.themoviedb.org/3/find/${IMDB_ID}?api_key=${tmdbApiKey}&external_source=imdb_id`;
        const tmdbFindResponse = await axios.get(tmdbFindUrl);

        let tmdbId = null;
        if (type === 'movie' && tmdbFindResponse.data.movie_results.length > 0) {
            tmdbId = tmdbFindResponse.data.movie_results[0].id;
            queryTitle = tmdbFindResponse.data.movie_results[0].title;
            queryYear = (new Date(tmdbFindResponse.data.movie_results[0].release_date)).getFullYear();
            console.log(`[Addon Log] Found movie TMDb ID: ${tmdbId}, Title: ${queryTitle}, Year: ${queryYear}`);
        } else if (type === 'series' && tmdbFindResponse.data.tv_results.length > 0) {
            tmdbId = tmdbFindResponse.data.tv_results[0].id;
            queryTitle = tmdbFindResponse.data.tv_results[0].name;
            queryYear = (new Date(tmdbFindResponse.data.tv_results[0].first_air_date)).getFullYear();
            console.log(`[Addon Log] Found series TMDb ID: ${tmdbId}, Title: ${queryTitle}, Year: ${queryYear}`);

            // --- NEW: Enhance search query for series ---
            if (seasonNum && episodeNum) {
                // If we want specific episode title, uncomment the following block
                /*
                try {
                    const episodeDetailUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum}?api_key=${tmdbApiKey}`;
                    const episodeDetailResponse = await axios.get(episodeDetailUrl);
                    if (episodeDetailResponse.data.name) {
                        queryTitle = `${queryTitle} S${seasonNum} E${episodeNum} ${episodeDetailResponse.data.name}`;
                    } else {
                        queryTitle = `${queryTitle} Season ${seasonNum} Episode ${episodeNum}`;
                    }
                } catch (episodeError) {
                    console.warn(`[Addon Log] Could not fetch episode details for S${seasonNum} E${episodeNum}: ${episodeError.message}`);
                    queryTitle = `${queryTitle} Season ${seasonNum} Episode ${episodeNum}`;
                }
                */
                // For now, simpler: append S/E directly
                queryTitle = `${queryTitle} S${seasonNum} E${episodeNum}`;
            }
            // --- END NEW: Enhance search query for series ---

        } else {
            console.log(`[Addon Log] No TMDb results found for IMDb ID: ${IMDB_ID}`);
            return { streams: [] };
        }

        if (!queryTitle) {
            console.log('[Addon Log] No title extracted from TMDb. Cannot search YouTube.');
            return { streams: [] };
        }

        // Step 2: Search YouTube with title and year
        let youtubeSearchQuery = `${queryTitle} ${queryYear || ''}`;
        // --- NEW: Add "full movie" for movie searches ---
        if (type === 'movie') {
            youtubeSearchQuery += ' full movie';
        }
        // --- END NEW ---

        const youtubeUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(youtubeSearchQuery)}&key=${youtubeApiKey}&type=video&maxResults=${maxStreams}&videoDuration=${videoDuration}&order=${videoSort}`;
        
        console.log(`[Addon Log] Searching YouTube for: "${youtubeSearchQuery}" with maxResults=${maxStreams}, videoDuration=${videoDuration}, order=${videoSort}`);
        const youtubeResponse = await axios.get(youtubeUrl);

        if (!youtubeResponse.data.items || youtubeResponse.data.items.length === 0) {
            console.log('[Addon Log] No YouTube results found.');
            return { streams: [] };
        }

        const streams = [];
        for (const item of youtubeResponse.data.items) {
            // --- NEW: Try to get direct URL using yt-dlp ---
            let directUrl = null;
            try {
                directUrl = await getYtdlpDirectUrl(item.id.videoId);
            } catch (ytDlpError) {
                console.warn(`[Addon Log] Failed to get yt-dlp direct URL for ${item.id.videoId}: ${ytDlpError.message}`);
                // If yt-dlp fails, we still add the stream but without a direct 'url'
                // Stremio will then fallback to externalUrl as its primary option.
            }
            // --- END NEW ---

            streams.push({
                title: `▶️ ${item.snippet.title} (Open on YouTube)`, 
                // Add the direct URL if successfully obtained
                url: directUrl, 
                externalUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`, 
                ytId: item.id.videoId, 
                thumbnail: item.snippet.thumbnails.high.url,
                behaviorHints: {
                    externalUrl: true // Still hint for external playback
                }
            });
        }

        console.log(`[Addon Log] Found ${streams.length} YouTube streams.`);
        return { streams };

    } catch (error) {
        console.error(`[Addon Log] Error fetching data:`, error.message);
        if (error.response) {
            console.error(`[Addon Log] API Error Status: ${error.response.status}, Data:`, error.response.data);
            if (error.response.status === 403) {
                return { streams: [], error: 'YouTube API Key (403): Quota Exceeded or Permissions Issue.' };
            }
            if (error.response.status === 401) {
                return { streams: [], error: 'TMDb/YouTube API Key (401): Unauthorized. Check your API keys.' };
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
  const youtubeApiKey = req.query.youtubeApiKey || '';
  const tmdbApiKey = req.query.tmdbApiKey || '';
  const maxStreams = req.query.maxStreams || '5';
  const videoDuration = req.query.videoDuration || 'any';
  const videoSort = req.query.videoSort || 'relevance';

  // Attach configuration to the manifest (this is how Stremio sends it to streams)
  const configuredManifest = { ...manifest };
  // Create unique ID for Stremio caching based on config
  configuredManifest.id = configuredManifest.id + `_${youtubeApiKey.substring(0,5)}_${tmdbApiKey.substring(0,5)}_${maxStreams}_${videoDuration}_(YT)`; 
  // --- UPDATED: Add-on Name ---
  configuredManifest.name = `Tube Search (YT)`; // Set name directly
  // --- END UPDATED ---
  configuredManifest.config = {
    youtubeApiKey,
    tmdbApiKey,
    maxStreams: parseInt(maxStreams, 10),
    videoDuration,
    videoSort
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
    // Extract configuration from the request URL (these parameters come from the manifest URL)
    const { youtubeApiKey, tmdbApiKey, maxStreams, videoDuration, videoSort } = req.query;

    const config = {
        youtubeApiKey,
        tmdbApiKey,
        maxStreams: parseInt(maxStreams, 10) || 5, // Default to 5 if not valid
        videoDuration: videoDuration || 'any',
        videoSort: videoSort || 'relevance'
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
    console.log(`Manifest URL (example): http://localhost:${PORT}/manifest.json?youtubeApiKey=YOUR_YOUTUBE_KEY&tmdbApiKey=YOUR_TMDB_KEY`);
    console.log(`Configure URL: http://localhost:${PORT}/configure`);
});
