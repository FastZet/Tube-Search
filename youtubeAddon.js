const axios = require('axios'); // For making HTTP requests to YouTube API

const YOUTUBE_EMBED_URL_PREFIX = 'https://www.youtube.com/watch?v=';
const YOUTUBE_STREAM_SERVER = 'https://www.youtube.com/watch?v=VIDEO_ID';

function mapDuration(stremioDuration) {
    switch (stremioDuration) {
        case 'short':
            return 'short';
        case 'medium':
            return 'medium';
        case 'long':
            return 'long';
        case 'any':
        default:
            return undefined;
    }
}

function mapResolution(stremioResolution) {
    switch (stremioResolution) {
        case 'sd':
            return 'standard';
        case 'hd':
        case 'fullhd':
            return 'high';
        case 'any':
        default:
            return undefined;
    }
}

function getTubeSearchHandlers(builder) {

    builder.defineCatalogHandler(async (args) => {
        // Read the YouTube API key from args.config (provided by Stremio after user input)
        const { config } = args;
        const { youtubeApiKey } = config || {};

        // Check if API key is provided
        if (!youtubeApiKey) {
            console.warn('YouTube API Key not provided by user in Stremio configuration.');
            // Stremio might show a more user-friendly error if this is returned as 'err'
            return Promise.resolve({ metas: [], err: 'YouTube API Key is missing. Please configure the add-on.' });
        }

        const { search } = args;

        const durationFilter = mapDuration(args.extra && args.extra.duration);
        const resolutionFilter = mapResolution(args.extra && args.extra.resolution);

        const youtubeApiUrl = 'https://www.googleapis.com/youtube/v3/search';
        const params = {
            key: youtubeApiKey,
            part: 'snippet',
            q: search,
            type: 'video',
            maxResults: 20
        };

        if (durationFilter) {
            params.videoDuration = durationFilter;
        }
        if (resolutionFilter) {
            params.videoDefinition = resolutionFilter;
        }

        try {
            console.log(`Searching YouTube for: "${search}" with filters: ${JSON.stringify({duration: durationFilter, resolution: resolutionFilter})}`);
            const response = await axios.get(youtubeApiUrl, { params });
            const items = response.data.items || [];

            const metas = items.map(item => ({
                id: `yt_${item.id.videoId}`,
                type: 'movie',
                name: item.snippet.title,
                poster: item.snippet.thumbnails.high.url,
                description: item.snippet.description || 'No description available.',
                background: item.snippet.thumbnails.maxres ? item.snippet.thumbnails.maxres.url : item.snippet.thumbnails.high.url,
                releaseInfo: item.snippet.publishTime ? new Date(item.snippet.publishTime).getFullYear().toString() : undefined
            }));

            return Promise.resolve({ metas });

        } catch (error) {
            console.error('Error fetching from YouTube API:', error.message);
            if (error.response && error.response.data && error.response.data.error) {
                console.error('YouTube API Error Details:', error.response.data.error);
                // Specific errors for user
                if (error.response.data.error.code === 403 || error.response.data.error.code === 400) {
                     return Promise.resolve({ metas: [], err: 'YouTube API Error: Please check your API key (invalid or quota exceeded).' });
                }
            }
            return Promise.resolve({ metas: [], err: 'Failed to search YouTube. Please try again later.' });
        }
    });

    builder.defineStreamHandler(async (args) => {
        const { id } = args;
        const videoId = id.replace('yt_', '');

        if (!videoId) {
            return Promise.resolve({ streams: [] });
        }

        const streams = [{
            url: `${YOUTUBE_STREAM_SERVER}/${videoId}`,
            title: 'YouTube Stream',
            description: `Plays directly from YouTube.`
        }];

        return Promise.resolve({ streams });
    });
}

module.exports = { getTubeSearchHandlers };
