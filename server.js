// server.js

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const path = require('path');
const morgan = require('morgan');
const manifest = require('./manifest.json');
const config = require('./src/config');
const streamHandler = require('./src/stream-handler');

// Attach global Axios debug interceptors (enable with HTTP_DEBUG=true)
require('./src/http-debug');

const app = express();

// Trust reverse proxies for accurate logging
app.set('trust proxy', true);

// Request logging
morgan.token('req-id', (req) => req.headers['x-request-id'] || '-');
morgan.token('real-ip', (req) => (req.headers['x-forwarded-for'] || req.ip || '').toString());
app.use(morgan(':date[iso] :req-id :method :url :status :res[content-length] - :response-time ms :real-ip ":user-agent"'));

// --- CORS ---
app.use((req, res, next) => {
    // Keep permissive default for Stremio compatibility; tune in production if needed
    res.setHeader('Access-Control-Allow-Origin', config.server.corsOrigins.includes('*') ? '*' : config.server.corsOrigins || '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// --- Auth middleware using ADDON_PASSWORD ---
const requirePassword = (req, res, next) => {
    const expected = process.env.ADDON_PASSWORD || '';
    const supplied = req.params.password || '';
    if (!expected) {
        console.error('[SERVER] Missing ADDON_PASSWORD env var');
        return res.status(500).json({ err: 'Server missing ADDON_PASSWORD.' });
    }
    if (supplied !== expected) {
        console.warn('[SERVER] Invalid addon password', { path: req.originalUrl });
        return res.status(401).json({ err: 'Unauthorized.' });
    }
    next();
};

// --- Routes ---

// Manifest: /:password/manifest.json
app.get('/:password/manifest.json', requirePassword, (req, res) => {
    const tmdbKey = process.env.TMDB_API_KEY || '';
    if (!tmdbKey) {
        console.error('[SERVER] Missing TMDB_API_KEY env var');
        return res.status(500).json({ err: 'Server missing TMDB_API_KEY.' });
    }
    const pwd = req.params.password;
    const dynamicId = `${manifest.id}_${pwd.substring(0, 5)}`;
    const configuredManifest = { ...manifest, id: dynamicId, name: 'Tube Search' };
    console.log('[SERVER] Served manifest', { path: req.originalUrl });
    res.json(configuredManifest);
});

// Streams: /:password/stream/:type/:id.json
app.get('/:password/stream/:type/:id.json', requirePassword, async (req, res, next) => {
    try {
        const { type, id } = req.params;
        console.log('[SERVER] Stream request', { type, id });
        const result = await streamHandler.getStreams(type, id);
        console.log('[SERVER] Stream response', { streams: result?.streams?.length || 0 });
        res.json(result);
    } catch (err) {
        next(err);
    }
});

// Healthcheck for Docker
app.get('/health', (req, res) => res.json({ ok: true }));

// Configure UI routes
app.get('/', (req, res) => res.redirect('/configure'));
app.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});
app.get('/:anything/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// 404 catch-all (avoid "*" which can break on some path parsers)
app.use((req, res) => res.status(404).send('Not Found'));

// Global error handler
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    console.error('[SERVER][ERROR]', {
        status,
        message: err.message,
        stack: err.stack,
        path: req.originalUrl,
        ip: req.ip,
        ua: req.headers['user-agent']
    });
    if (res.headersSent) return next(err);
    res.status(status).json({ err: err.message || 'Internal Server Error' });
});

// Start server
const PORT = config.server.port;
app.listen(PORT, () => {
    console.log(`[SERVER] Tube Search add-on running on port ${PORT}`);
    console.log(`[SERVER] To configure, visit: http://localhost:${PORT}/configure`);
});
