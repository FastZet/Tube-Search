// src/http-client.js
const axios = require('axios');
const { ProxyAgent } = require('proxy-agent');
const config = require('./config');

const defaultHeaders = { 'User-Agent': config.scraping.userAgent };
const proxyUrl = process.env.ADDON_PROXY;

let agent = undefined;
if (proxyUrl && proxyUrl.trim()) {
  agent = new ProxyAgent(proxyUrl.trim());
}

const http = axios.create({
  timeout: config.api.defaultTimeout,
  headers: defaultHeaders,
  proxy: false,           // when using Agents, disable Axios proxy layer
  httpAgent: agent,       // works for http URLs via the proxy
  httpsAgent: agent,      // works for https URLs via the proxy (CONNECT)
});

module.exports = http;
