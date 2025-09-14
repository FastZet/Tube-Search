# Tube Search — Stremio Add-on 🚀

The add-on uses server-side TMDb/OMDb API keys from environment variables and exposes a password-protected manifest at `/:password/manifest.json` to keep install URLs clean and compatible with Stremio on all platforms.

## Install

1. Set env vars on the server/container:
   - TMDB_API_KEY=<your tmdb key>
   - OMDB_API_KEY=<your omdb key>
   - ADDON_PASSWORD=<base64 string you choose>
2. Install in Stremio using:
   - https://<your-host>/<ADDON_PASSWORD>/manifest.json

Optional: Set `ADDON_PROXY` to route outbound HTTP(S) via proxy (http, https, or socks5), e.g. `socks5://proxy:1080`.

## Routes

- GET `/:password/manifest.json` — Manifest (requires ADDON_PASSWORD).
- GET `/:password/stream/:type/:id.json` — Streams (requires ADDON_PASSWORD).
- GET `/configure` — Generates the Stremio install link.

## Debugging

- Set `HTTP_DEBUG=true` to log outbound HTTP request/response summary.
- Container logs show request lines via Morgan and detailed server errors.
