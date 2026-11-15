# Known limitations and free-tier notes
**Limitations**
- YouTube Unlisted: anyone with the link can watch/share it. Not DRM, not absolute privacy.
- Google Meet: an approved student can forward the link; use host admission controls. Cancelled-class links remain readable by approved students at database level (button hidden).
- Recording: browser support varies; WebM usually; tab/system audio depends on browser and source; remote Meet audio not guaranteed; Chrome for Android lacks screen capture (use the phone recorder). Meet's own recording needs an eligible paid Workspace plan.
- Certificates: shown on the homepage as "Coming soon"; not implemented.
- Progress = completed lectures / published lectures; playback position is not tracked.
- Meet-only validation of class links is in the browser; the database only requires `https://`.
- If you delete a material and the browser closes mid-way, the stored file may remain (admin can delete it in Storage).
- The Supabase JS library loads from esm.sh (pinned version). Self-host it if you need independence from that CDN.
- Offline mode shows only the page shell.
**Supabase free tier (verify current numbers at supabase.com/pricing; they change)**
- Roughly 1 GB file storage, 500 MB database, a few GB monthly bandwidth, 50 MB max per file, built-in email limited to very few messages per hour (set custom SMTP), projects can **pause after about a week of inactivity** (restore from the dashboard).
- Keep PDFs small; host videos on YouTube (free) rather than in Storage; thumbnails are limited to 2 MB.
