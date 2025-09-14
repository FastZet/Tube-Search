// src/http-debug.js
const axios = require('axios');

const isProd = process.env.NODE_ENV === 'production';
const enable = (process.env.HTTP_DEBUG || '').toLowerCase() === 'true' || !isProd;

const redact = (obj) => {
  try {
    if (!obj) return obj;
    const copy = JSON.parse(JSON.stringify(obj));
    if (copy.headers) {
      const h = copy.headers;
      if (h.authorization) h.authorization = '[REDACTED]';
      if (h['x-api-key']) h['x-api-key'] = '[REDACTED]';
    }
    return copy;
  } catch { return {}; }
};

if (enable) {
  axios.interceptors.request.use(
    (cfg) => {
      cfg.metadata = { start: Date.now() };
      const method = (cfg.method || 'GET').toUpperCase();
      console.log(`[HTTP][REQ] ${method} ${cfg.url}`, redact({ headers: cfg.headers }));
      return cfg;
    },
    (err) => {
      console.error('[HTTP][REQ][ERR]', err.message);
      return Promise.reject(err);
    }
  );

  axios.interceptors.response.use(
    (res) => {
      const ms = res.config?.metadata ? Date.now() - res.config.metadata.start : -1;
      const method = (res.config?.method || 'GET').toUpperCase();
      console.log(`[HTTP][RES] ${res.status} ${method} ${res.config?.url} in ${ms}ms`);
      return res;
    },
    (err) => {
      const cfg = err.config || {};
      const ms = cfg.metadata ? Date.now() - cfg.metadata.start : -1;
      const method = (cfg.method || 'GET').toUpperCase();
      const status = err.response?.status;
      let body = err.response?.data;
      try { body = typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300); } catch { body = '[unserializable]'; }
      console.error(`[HTTP][ERR] ${status || 'NO_RESP'} ${method} ${cfg.url} in ${ms}ms :: ${err.message} :: ${body}`);
      return Promise.reject(err);
    }
  );
}

module.exports = {};
