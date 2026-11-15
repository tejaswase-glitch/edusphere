# EduSphere

Static website (GitHub Pages) + your existing Supabase project. No build step.

- **Public homepage** - redesigned (lavender/blue-purple), 4 subject cards, registration banner, safe lecture previews.
- **Student dashboard** - navy sidebar, welcome banner, learning stats, Continue Learning, My Courses, Upcoming Live Class, Recent Activity.
- **Admin** - statistics, student approval (approve / reject / suspend), teacher accounts (via Edge Function), courses + subjects, all materials/lectures/classes, audit log.
- **Teacher** - own courses, material upload, YouTube Unlisted lectures, Google Meet classes (edit / reschedule / cancel), screen + voice recorder.
- **Security** - Supabase Auth sessions, status re-check, RLS + Storage policies, ownership-based delete, audit log.

## Folder map
| Path | Purpose |
|---|---|
| `index.html`, `css/`, `js/`, `assets/` | the website |
| `config.js` | **the only file you edit** (anon key etc.) |
| `supabase/migrations/001_upgrade.sql`, `002_complete_platform.sql` | incremental SQL, run in this order |
| `supabase/functions/admin-users/index.ts` | Edge Function: secure teacher creation |
| `docs/` | GitHub Pages + Supabase guides, manuals, Android/PWA guide, limits and free-tier notes, security notes |
| `BUG_FIX_REPORT.md`, `TESTING_REPORT.md`, `CHANGELOG.md` | what was found/fixed and what was tested (read first) |
| `tests/` | mock-backend UI tests (`node tests/e2e.mjs`) + screenshots |
| `backup/` | untouched copies of both previous projects; `supabase-schema.original.sql` |

Start with `BUG_FIX_REPORT.md` and `TESTING_REPORT.md`, then `docs/SUPABASE-SETUP.md` and `docs/GITHUB-PAGES-DEPLOYMENT.md`. Live site: https://tejaswase-glitch.github.io/edusphere/
