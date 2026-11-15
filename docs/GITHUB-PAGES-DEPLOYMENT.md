# GitHub Pages deployment (https://tejaswase-glitch.github.io/edusphere/)

I have NOT pushed anything to your GitHub. Do these steps yourself.

1. Finish `docs/SUPABASE-SETUP.md` first (migrations, Edge Function, Auth URLs).
2. Open `config.js` and replace `YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY` with your **anon/publishable** key (Supabase > Project Settings > API). Never the service_role key.
3. Upload to repository `tejaswase-glitch/edusphere`, branch `main`, repository root:
   - **Upload:** `index.html`, `config.js`, `manifest.webmanifest`, `sw.js`, `.nojekyll`, folders `css/`, `js/`, `assets/`.
   - **Optional (docs/dev):** `docs/`, `supabase/`, `tests/`, `README.md`, `CHANGELOG.md`, reports. These are not needed by the live site.
   - **Do not upload** `backup/` publicly if you prefer to keep old versions private (it contains old code only, no secrets).
4. Settings > Pages > Source: *Deploy from a branch* > `main` / `(root)`.
5. Wait 1-2 minutes, open the URL, hard-refresh (Ctrl+F5).
6. Updating later: upload changed files. The service worker is network-first, so users get updates on next load.

All paths are relative (`./`), so the site works under `/edusphere/`. GitHub Pages ignores `_headers` (kept for Netlify/Cloudflare).
