# Values you must enter / set

| Where | Value | Notes |
|---|---|---|
| `config.js` -> `SUPABASE_ANON_KEY` | your **anon / publishable** key | Supabase > Project Settings > API. Public by design. NEVER the service_role key. |
| `config.js` -> `SUPABASE_URL` | prefilled `https://jupcjqbvnrafadlkbqns.supabase.co` | change only if the project changes |
| `config.js` -> `CONTACT_EMAIL / PHONE / ADDRESS` | optional | shown in Contact section |
| `config.js` -> `YOUTUBE_URL / FACEBOOK_URL / TELEGRAM_URL` | optional `https://...` | footer icons; hidden when empty |
| Supabase > Auth > URL Configuration | Site URL + Redirect URL = your GitHub Pages address (with trailing `/`) | needed for teacher password-setup and reset emails |
| Supabase > Auth > Providers > Email | decide "Confirm email" on/off | on = students must confirm email AND be approved |
| Supabase > Auth > SMTP | custom SMTP recommended | the built-in mailer is heavily rate-limited |
| Edge Function secret (optional) | `ALLOWED_REDIRECT_ORIGINS=https://<you>.github.io` | restricts reset-link redirects |
| SQL Editor | run `001`, then `002`; make your first admin (see guide) | |
