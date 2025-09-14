// server.js

const express = require('express');
const path = require('path');
const manifest = require('./manifest.json');
const config = require('./src/config');
const streamHandler = require('./src/stream-handler');

const app = express();

// --- Middleware for CORS ---
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.server.corsOrigins.join(', '));
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// Authorization helper using ADDON_PASSWORD
const requirePassword = (req, res, next) => {
    const expected = process.env.ADDON_PASSWORD || '';
    const supplied = req.params.password || '';
    if (!expected) {
        return res.status(500).json({ err: 'Server not configured: missing ADDON_PASSWORD env var.' });
    }
    if (supplied !== expected) {
        return res.status(401).json({ err: 'Unauthorized: invalid addon password.' });
    }
    next();
};

// --- Route Definitions ---

// Manifest route: Provides the addon configuration to Stremio
app.get('/:password/manifest.json', requirePassword, (req, res) => {
    const tmdbKey = process.env.TMDB_API_KEY || '';
    if (!tmdbKey) {
        return res.status(500).json({ err: 'Server not configured: missing TMDB_API_KEY env var.' });
    }

    const password = req.params.password;
    const dynamicId = `${manifest.id}_${password.substring(0, 5)}`;
    const configuredManifest = { ...manifest, id: dynamicId, name: 'Tube Search' };
    
    res.json(configuredManifest);
});

// Stream route: The main endpoint for finding content
app.get('/:password/stream/:type/:id.json', requirePassword, async (req, res) => {
    try {
        const { type, id } = req.params;
        const result = await streamHandler.getStreams(type, id);
        res.json(result);
    } catch (error) {
        console.error(`[SERVER] Unhandled error in stream handler: ${error.message}`);
        res.status(500).json({ err: 'An internal server error occurred.' });
    }
});

// Root -> configure
app.get('/', (req, res) => {
    res.redirect('/configure');
});

// Configuration UI routes (explicit, no optional token)
app.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

app.get('/:anything/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

// Liveness/health route for Docker healthcheck
app.get('/health', (req, res) => {
    res.json({ ok: true });
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// 404 handler for any unhandled routes (compatible with path-to-regexp)
app.use((req, res) => {
    res.status(404).send('Not Found');
});

// --- Server Initialization ---
const PORT = config.server.port;
app.listen(PORT, () => {
    console.log(`[SERVER] Tube Search add-on running on port ${PORT}`);
    console.log(`[SERVER] To configure, visit: http://localhost:${PORT}/configure`);
});
