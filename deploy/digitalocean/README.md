# DigitalOcean App Platform Deployment

This folder now targets **DigitalOcean App Platform** (not Droplet/Compose).

## What changed
- Droplet-specific files (`docker-compose.yml`, `Caddyfile`, `bootstrap.sh`, `.env.backend.example`) were removed.
- Deployment now uses App Platform spec at [.do/app.yaml](../../.do/app.yaml).
- Backend now supports `DATABASE_URL` for Managed Postgres and configurable `CORS_ALLOWED_ORIGINS`.

## 1) Prepare prerequisites
- Push this repo to GitHub.
- Create a DigitalOcean account + project.
- Create a Managed Postgres database (or plan to create during app setup).
- Create Auth0 app and Gemini API key.

## 2) Configure app spec
Edit [.do/app.yaml](../../.do/app.yaml):
- Replace `YOUR_GITHUB_OWNER/YOUR_GITHUB_REPO`.
- Replace `https://BACKEND_APP_DOMAIN` and `https://FRONTEND_APP_DOMAIN`.
- Replace all `REPLACE_ME` values.
- Set `DATABASE_URL` to your Managed Postgres connection string.

## 3) Create App Platform app
In DigitalOcean App Platform:
- Choose **Create App**.
- Choose GitHub repo (or upload app spec).
- If using app spec file, select [.do/app.yaml](../../.do/app.yaml).

## 4) Verify routes and env
- Frontend and backend each have their own public App Platform URL.
- Frontend build env: `VITE_API_BASE_URL=https://BACKEND_APP_DOMAIN`
- Backend runtime env includes:
  - `SESSION_SECRET`
  - `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`
  - `APP_BASE_URL`, `FRONTEND_BASE_URL`
  - `GEMINI_API_KEY`
  - `DATABASE_URL`
  - `CORS_ALLOWED_ORIGINS`

## 5) Configure Auth0 URLs
Use your final frontend/backend domains:
- Allowed Callback URLs: `https://<BACKEND_APP_DOMAIN>/auth/callback`
- Allowed Logout URLs: `https://<FRONTEND_APP_DOMAIN>/dashboard`
- Allowed Web Origins: `https://<FRONTEND_APP_DOMAIN>`

## 6) Deploy and validate
- Deploy from App Platform UI.
- Validate:
  - login/logout
  - canvas CRUD
  - Gemini node calls
  - data writes in Postgres

## Notes
- App Platform is managed and simpler ops than a Droplet.
- For lowest cost, Droplet can be cheaper; App Platform trades extra cost for less maintenance.
