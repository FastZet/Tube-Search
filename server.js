// server.js

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express  = require('express');
const path     = require('path');
const morgan   = require('morgan');
const manifest = require('./manifest.json');
const config   = require('./src/config');
const streamHandler = require('./src/stream-handler');
const { checkGoogleAccess } = require('./src/diagnostics');

require('./src/http-debug');

const app = express();
app.set('trust proxy', true);

morgan.token('req-id',  (req) => req.headers['x-request-id'] || '-');
morgan.token('real-ip', (req) => (req.headers['x-forwarded-for'] || req.ip || '').toString());
app.use(morgan(':date[iso] :req-id :method :url :status :res[content-length] - :response-time ms :real-ip ":user-agent"'));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin',
        config.server.corsOrigins.includes('*') ? '*' : config.server.corsOrigins || '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

const requirePassword = (req, res, next) => {
    const expected = process.env.ADDON_PASSWORD || '';
    const supplied  = req.params.password || '';
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

app.get('/:password/stream/:type/:id.json', requirePassword, async (req, res, next) => {
    try {
        const { type, id } = req.params;
        console.log('[SERVER] Stream request', { type, id });
        const result = await streamHandler.getStreams(type, id);
        console.log('[SERVER] Stream response', { streams: result?.streams?.length || 0 });
        res.json(result);
    } catch (err) { next(err); }
});

app.get('/health',      (req, res) => res.json({ ok: true }));
app.get('/diagnostics', async (req, res) => { const r = await checkGoogleAccess(); res.json(r); });

app.get('/',                    (req, res) => res.redirect('/configure'));
app.get('/configure',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'configure.html')));
app.get('/:anything/configure', (req, res) => res.sendFile(path.join(__dirname, 'public', 'configure.html')));

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.status(404).send('Not Found'));

app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    console.error('[SERVER][ERROR]', {
        status, message: err.message, stack: err.stack,
        path: req.originalUrl, ip: req.ip, ua: req.headers['user-agent'],
    });
    if (res.headersSent) return next(err);
    res.status(status).json({ err: err.message || 'Internal Server Error' });
});

const PORT = config.server.port;
app.listen(PORT, () => {
    console.log(`[SERVER] Tube Search add-on running on port ${PORT}`);
    console.log(`[SERVER] To configure, visit: http://localhost:${PORT}/configure`);

    if (!process.env.SERPER_API_KEY) {
        console.warn('[SERVER] ⚠️  SERPER_API_KEY is not set — Google video search will fail');
        console.warn('[SERVER]    Get a free key at https://serper.dev');
    } else {
        console.log('[SERVER] ✅ SERPER_API_KEY detected');
    }

    // Run Serper diagnostic on startup
    checkGoogleAccess().catch(() => {});
});

process.on('SIGTERM', async () => {
    console.log('[SERVER] SIGTERM received — shutting down gracefully');
    process.exit(0);
});
