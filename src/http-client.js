// src/http-client.js
const axios = require('axios');
const { ProxyAgent } = require('proxy-agent');
const config = require('./config');

const proxyUrl = process.env.ADDON_PROXY && process.env.ADDON_PROXY.trim();
const agent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

const http = axios.create({
  timeout: config.api.defaultTimeout,
  proxy: false,          // prevent env HTTPS_PROXY interference; rely on agents
  httpAgent: agent,
  httpsAgent: agent,
  headers: { 'User-Agent': config.scraping.userAgent },
});

module.exports = http;
