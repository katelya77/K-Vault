# K-Vault Docker Deployment Guide

Chinese version: [README-DOCKER.md](README-DOCKER.md)

## Summary

Docker now uses one image:

```text
ghcr.io/katelya77/k-vault:latest
```

The image includes:

- Root static pages: `/`, `/admin.html`, `/gallery.html`, `/webdav.html`
- Node.js/Hono API
- Nginx entrypoint and reverse proxy
- SQLite database and chunk temp directory, persisted under `/app/data`

The old two-image `k-vault-api` plus `k-vault-web` deployment is deprecated. GitHub Actions builds and publishes only the `k-vault` GHCR package.

## Simplest Deployment

No repository checkout and no local Node/npm installation are required:

```bash
docker volume create kvault_data
docker run -d \
  --name kvault \
  --restart unless-stopped \
  -p 8080:8080 \
  -v kvault_data:/app/data \
  ghcr.io/katelya77/k-vault:latest
```

Open:

- Upload UI: `http://<host>:8080/`
- Admin console: `http://<host>:8080/admin.html`
- WebDAV page: `http://<host>:8080/webdav.html`
- Health check: `http://<host>:8080/api/health`

On first start, if `CONFIG_ENCRYPTION_KEY` and `SESSION_SECRET` are not provided, the container generates persistent values in `/app/data/runtime.env`. Recreating the container keeps them as long as the `kvault_data` volume is kept.

**Set a unique strong admin password before public deployment.** The credential-free quick start above is for isolated local testing only:

```bash
export BASIC_PASS="$(openssl rand -base64 32)"
docker rm -f kvault
docker run -d \
  --name kvault \
  --restart unless-stopped \
  -p 8080:8080 \
  -v kvault_data:/app/data \
  -e BASIC_USER=admin \
  -e BASIC_PASS \
  ghcr.io/katelya77/k-vault:latest
```

## Docker Compose

If you cloned the repository:

```bash
docker compose up -d
```

`docker-compose.yml` pulls `ghcr.io/katelya77/k-vault:latest` by default and persists data in the `kvault_data` volume. `.env` is optional.

Create `.env` only when you want fixed credentials, domain, default storage, or upload limits:

```bash
cp .env.example .env
# Set a unique strong BASIC_PASS in .env before starting publicly.
docker compose up -d
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
# Set a unique strong BASIC_PASS in .env before starting publicly.
docker compose up -d
```

Check status:

```bash
docker compose ps
docker compose logs -f k-vault
```

Expected: `kvault` is `Up ... (healthy)`.

## Storage Backends

Docker supports two configuration styles:

1. **Dynamic admin configuration**: start the container, open `/admin.html`, then add, test, and switch storage profiles.
2. **Environment bootstrap configuration**: set default storage variables in `.env` or with `docker run -e`; the container writes them into SQLite on startup.

Common variables:

| Variable | Description |
| :--- | :--- |
| `BASIC_USER` / `BASIC_PASS` | Admin login credentials, recommended for public deployments |
| `PUBLIC_BASE_URL` | External URL for direct links, share links, and webhooks |
| `DEFAULT_STORAGE_TYPE` | Default storage: `telegram` / `r2` / `s3` / `discord` / `huggingface` / `webdav` / `github` |
| `TG_BOT_TOKEN` + `TG_CHAT_ID` | Telegram |
| `R2_ENDPOINT` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare R2 |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3-compatible storage |
| `WEBDAV_BASE_URL` / `WEBDAV_USERNAME` / `WEBDAV_PASSWORD` / `WEBDAV_BEARER_TOKEN` / `WEBDAV_ROOT_PATH` | WebDAV |
| `GITHUB_REPO` / `GITHUB_TOKEN` / `GITHUB_MODE` / `GITHUB_PREFIX` | GitHub |
| `HF_TOKEN` / `HF_REPO` | HuggingFace |
| `UPLOAD_MAX_SIZE` / `UPLOAD_SMALL_FILE_THRESHOLD` / `CHUNK_SIZE` | Upload limits and chunk settings |
| `WEB_PORT` | Public Compose port, default `8080` |

After WebDAV, GitHub, HuggingFace, S3/R2, or another backend is configured, the upload page storage buttons, `/webdav.html`, admin console, and `/api/status` show the same state. API Token uploads use `/api/v1/upload`; browser uploads use `POST /upload`.

## Cloudflare Pages Parity

Docker and Cloudflare Pages use the same root static UI and main routes:

- `/`: upload UI
- `/admin.html`: admin, storage profiles, API Token management
- `/webdav.html`: WebDAV upload/test page
- `/api/*`: admin, status, auth, storage tests, API v1
- `POST /upload`: browser upload
- `/api/v1/upload`: API Token upload
- `/file/*`, `/share/*`, `/s/*`: direct links, share links, short links

Runtime difference:

- Cloudflare Pages uses Pages Functions and KV/R2 bindings.
- Docker uses the containerized Node API, SQLite, and the `/app/data` volume.

The UI, main workflows, multi-storage backends, WebDAV page, API Token upload, and share links should behave the same for users.

## Optional Redis Settings Store

SQLite is the default. To store basic settings in Redis:

```dotenv
SETTINGS_STORE=redis
SETTINGS_REDIS_URL=redis://redis:6379
```

Start the Redis profile:

```bash
docker compose --profile redis up -d
```

File metadata and dynamic storage profiles still stay in `/app/data/k-vault.db`.

## Upgrade

Docker Run:

```bash
docker pull ghcr.io/katelya77/k-vault:latest
docker rm -f kvault
docker run -d --name kvault --restart unless-stopped -p 8080:8080 -v kvault_data:/app/data ghcr.io/katelya77/k-vault:latest
```

Docker Compose:

```bash
docker compose pull
docker compose up -d
```

Do not delete the `kvault_data` volume unless you intentionally want to remove the database, upload records, dynamic storage profiles, and generated runtime secrets.

## Build From Local Source

For local validation:

```bash
docker build -t k-vault:local .
```

Run Compose with the local image:

```bash
KVAULT_IMAGE=k-vault:local docker compose up -d
```

PowerShell:

```powershell
$env:KVAULT_IMAGE = "k-vault:local"
docker compose up -d
```

## Troubleshooting

Check the public entrypoint:

```bash
curl http://localhost:8080/api/health
curl http://localhost:8080/
```

Container logs:

```bash
docker logs -f kvault
```

Compose logs:

```bash
docker compose logs -f k-vault
```

Inspect container env vars:

```bash
docker compose exec k-vault sh -lc "env | grep -E 'DEFAULT_STORAGE_TYPE|TG_|R2_|S3_|HF_|GITHUB_|WEBDAV_|BASIC_|PUBLIC_BASE_URL'"
```

Inspect storage profiles in SQLite:

```bash
docker compose exec k-vault sh -lc "cd /app/server && node -e \"const { createContainer }=require('./lib/container'); const c=createContainer(process.env); console.log(JSON.stringify(c.storageRepo.list(false), null, 2));\""
```

Run the storage doctor:

```bash
npm run docker:doctor
```

Only remove volumes when you intentionally want to delete all Docker data:

```bash
docker compose down -v
```
