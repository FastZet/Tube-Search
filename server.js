const express = require('express');
const { addonBuilder } = require('stremio-addon-sdk');
const path = require('path');
const manifest = require('./manifest.json');

// --- Temporarily REMOVE the import for youtubeAddon.js ---
// const { getTubeSearchHandlers } = require('./youtubeAddon'); 
// ---

// Initialize the addon builder with your manifest
const builder = new addonBuilder(manifest);
console.log('[Server Log] Builder initialized.');
console.log('[Server Log] Manifest resources:', manifest.resources); // Check resources from manifest file

// --- Directly define the stream handler here for diagnostic purposes ---
builder.defineStreamHandler(async (args) => {
    console.log('[Server Log] Direct stream handler executed inside defineStreamHandler.');
    // For now, we'll just return an empty array of streams to see if the handler registers
    return Promise.resolve({ streams: [] }); 
});
console.log('[Server Log] Direct defineStreamHandler called on builder.');

// After direct definition, inspect the builder's internal handlers
console.log('[Server Log] Builder _handlers (internal) AFTER direct define:', builder._handlers); 
if (builder._handlers && builder._handlers.stream) {
    console.log('[Server Log] Stream handler FOUND on builder._handlers after direct define.');
} else {
    console.error('[Server Log] ERROR: Stream handler NOT found on builder._handlers after direct define!');
}

// Get the addon interface from the builder
const addonInterface = builder.getInterface();
console.log('[Server Log] addonInterface obtained.');

// Check the structure of the obtained addonInterface
console.log('[Server Log] addonInterface keys:', Object.keys(addonInterface));
if (addonInterface.stream) {
    console.log('[Server Log] addonInterface.stream IS defined after getInterface().');
} else {
    console.error('[Server Log] ERROR: addonInterface.stream is UNDEFINED after getInterface()!');
}

const app = express();

// --- Stremio Add-on API Routes ---

// Serve the manifest.json file directly
app.get('/manifest.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.json(manifest);
});

// Handle Stream requests
app.get('/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  console.log(`[Server Log] Received stream request for Type: ${req.params.type}, ID: ${req.params.id}`); 
  try {
    const args = {
      type: req.params.type,
      id: req.params.id,
    };
    console.log(`[Server Log] Parsed stream arguments: ${JSON.stringify(args)}`); 
    
    // Check addonInterface.stream before calling get()
    if (!addonInterface.stream) {
        console.error('[Server Log] FATAL ERROR: addonInterface.stream is missing during request handling!');
        return res.status(500).json({ err: 'Add-on not fully initialized. Stream handler missing.' });
    }

    const result = await addonInterface.stream.get(args); 
    console.log(`[Server Log] Stream handler returned result: ${result.streams ? result.streams.length + ' streams' : result}`); 
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
    console.log(`Manifest URL: http://localhost:${PORT}/manifest.json`);
    console.log(`Configure URL: http://localhost:${PORT}/configure`);
});
