const axios = require('axios'); // For making HTTP requests to YouTube and TMDb APIs

// Constants for YouTube stream handling
const YOUTUBE_STREAM_SERVER = 'https://www.youtube.com/watch?v=VIDEO_ID'; // Used for direct playback in Stremio

/**
 * Maps Stremio's duration filter options to YouTube Data API's videoDuration values.
 * @param {string} stremioDuration
 * @returns {string|undefined} YouTube API videoDuration value or undefined if 'any'
 */
function mapDuration(stremioDuration) {
    switch (stremioDuration) {
        case 'short':
            return 'short'; // < 4 minutes
        case 'medium':
            return 'medium'; // 4 - 20 minutes
        case 'long':
            return 'long'; // > 20 minutes
        case 'any':
        default:
            return undefined; // No specific duration filter
    }
}

/**
 * Maps custom sort options to YouTube Data API's 'order' parameter.
 * @param {string} stremioSort
 * @returns {string} YouTube API 'order' value
 */
function mapSortOrder(stremioSort) {
    switch (stremioSort) {
        case 'date':
            return 'date'; // Most recently uploaded
        case 'viewCount':
            return 'viewCount'; // Most views
        case 'relevance':
        default:
            return 'relevance'; // Default, most relevant
    }
}

/**
 * Fetches movie/series details from TMDb using an IMDb ID.
 * @param {string} imdbId - The IMDb ID (e.g., 'tt0133093')
 * @param {string} tmdbApiKey - Your TMDb API key
 * @returns {Promise<object|null>} Object containing title/name, or null if not found
 */
async function getTmdbDetails(imdbId, tmdbApiKey) {
    const tmdbFindUrl = `https://api.themoviedb.org/3/find/${imdbId}`;
    try {
        const response = await axios.get(tmdbFindUrl, {
            params: {
                api_key: tmdbApiKey,
                external_source: 'imdb_id'
            }
        });

        const data = response.data;

        // TMDb find API returns results in different arrays
        if (data.movie_results && data.movie_results.length > 0) {
            return { type: 'movie', title: data.movie_results[0].title, year: data.movie_results[0].release_date ? new Date(data.movie_results[0].release_date).getFullYear() : undefined };
        } else if (data.tv_results && data.tv_results.length > 0) {
            return { type: 'series', title: data.tv_results[0].name, year: data.tv_results[0].first_air_date ? new Date(data.tv_results[0].first_air_date).getFullYear() : undefined };
        }
        // Episode results are complex and often require TV show ID + season/episode number lookup
        // For simplicity, we won't directly map episode IMDb IDs to Youtube for now.
        // If args.type is 'episode', we should attempt to get series title instead if possible.
        // For this version, we'll focus on movie/series titles.

        return null; // No movie or TV show found
    } catch (error) {
        console.error(`[Addon Log] TMDb API Error for IMDb ID ${imdbId}:`, error.message);
        if (error.response && error.response.data) {
            console.error('TMDb Error Details:', error.response.data);
        }
        return null;
    }
}


function getTubeSearchHandlers(builder) {

    // Removed defineCatalogHandler as this is a stream provider now

    builder.defineStreamHandler(async (args) => {
        // Get API keys and configurations from the Stremio install URL
        const { id, type, config } = args;
        const { youtubeApiKey, tmdbApiKey, maxStreams, videoDuration, videoSort } = config || {};

        console.log(`[Addon Log] Stream handler invoked. Args: ${JSON.stringify(args)}`);
        console.log(`[Addon Log] Configured keys/params: YouTube Key: ${youtubeApiKey ? 'Available' : 'Missing'}, TMDb Key: ${tmdbApiKey ? 'Available' : 'Missing'}, Max Streams: ${maxStreams}, Duration: ${videoDuration}, Sort: ${videoSort}`);

        // --- 1. Validate Configuration ---
        if (!youtubeApiKey || !tmdbApiKey) {
            console.warn('API Keys not provided by user in Stremio configuration.');
            return Promise.resolve({ streams: [], err: 'YouTube or TMDb API Key is missing. Please configure the add-on.' });
        }

        // --- 2. Get Movie/Show Title from TMDb using IMDb ID ---
        let searchQuery = '';
        if (id.startsWith('tt')) { // Check if it's an IMDb ID
            const tmdbDetails = await getTmdbDetails(id, tmdbApiKey);
            if (tmdbDetails) {
                searchQuery = tmdbDetails.title;
                // Append year to make search more accurate if available
                if (tmdbDetails.year) {
                    searchQuery += ` ${tmdbDetails.year}`;
                }
                console.log(`[Addon Log] TMDb lookup successful. Search query for YouTube: "${searchQuery}"`);
            } else {
                console.warn(`[Addon Log] TMDb lookup failed for IMDb ID: ${id}. Cannot find title.`);
                return Promise.resolve({ streams: [], err: `Could not find details for ${id} on TMDb.` });
            }
        } else {
            console.warn(`[Addon Log] Received non-IMDb ID: ${id}. Cannot process without IMDb ID.`);
            return Promise.resolve({ streams: [], err: `Only IMDb IDs are supported for stream lookup.` });
        }

        // --- 3. Search YouTube ---
        const youtubeApiUrl = 'https://www.googleapis.com/youtube/v3/search';
        const params = {
            key: youtubeApiKey,
            part: 'snippet',
            q: `${searchQuery} trailer OR full movie OR official clip`, // Broaden search to find relevant video types
            type: 'video', // Only search for videos
            maxResults: parseInt(maxStreams, 10) || 5, // Use configurable maxStreams, default to 5
            videoDuration: mapDuration(videoDuration),
            order: mapSortOrder(videoSort)
        };

        // Clean up undefined params
        Object.keys(params).forEach(key => params[key] === undefined && delete params[key]);

        console.log(`[Addon Log] Attempting YouTube API call with params (key excluded): ${JSON.stringify({ ...params, key: youtubeApiKey ? '********' : undefined })}`);
        try {
            const response = await axios.get(youtubeApiUrl, { params });
            console.log(`[Addon Log] YouTube API call successful. Items received: ${response.data.items ? response.data.items.length : 0}`);
            const items = response.data.items || [];

            const streams = items.map(item => ({
                name: `YouTube: ${item.snippet.title}`,
                description: item.snippet.description || 'No description available.',
                url: `${YOUTUBE_STREAM_SERVER}/${item.id.videoId}`, // For direct playback in Stremio
                externalUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`, // For opening in YouTube app
                yt_video_id: item.id.videoId, // Custom field for potential future use or debugging
                published: item.snippet.publishedAt // Optional: can be used for sorting/display
            }));

            if (streams.length === 0) {
                console.log(`[Addon Log] No YouTube streams found for "${searchQuery}".`);
                return Promise.resolve({ streams: [], err: `No YouTube streams found for "${searchQuery}".` });
            }

            console.log(`[Addon Log] Returning ${streams.length} streams.`);
            return Promise.resolve({ streams });

        } catch (error) {
            console.error('[Addon Log] Error fetching from YouTube API:', error.message);
            if (error.response && error.response.data && error.response.data.error) {
                console.error('[Addon Log] YouTube API Error Details:', error.response.data.error);
                if (error.response.data.error.code === 403 || error.response.data.error.code === 400) {
                     return Promise.resolve({ streams: [], err: 'YouTube API Error: Please check your API key (invalid or quota exceeded).' });
                }
            }
            return Promise.resolve({ streams: [], err: 'Failed to search YouTube streams. Please try again later.' });
        }
    });
}

module.exports = { getTubeSearchHandlers };
