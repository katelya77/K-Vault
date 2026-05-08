<div align="center">

<img src="logo.png" alt="K-Vault Logo" width="140">

# K-Vault

> Free image/file hosting solution with dual deployment modes (Cloudflare Pages + Docker), supporting multiple storage backends.

**English** | [中文](README.md)

<br>

![GitHub stars](https://img.shields.io/github/stars/katelya77/K-Vault?style=flat-square)
![GitHub forks](https://img.shields.io/github/forks/katelya77/K-Vault?style=flat-square)
![GitHub license](https://img.shields.io/github/license/katelya77/K-Vault?style=flat-square)

</div>

---

## Screenshots

<p align="center">
   <img src="demo/登录页面.webp" alt="Login Page" width="300" />
   <img src="demo/首页上传页面.webp" alt="Home Upload Page" width="300" />
   <img src="demo/后台管理页面.webp" alt="Admin Page" width="300" />
</p>
<p align="center">
   <img src="demo/图片浏览页面.webp" alt="Image Browse Page" width="300" />
   <img src="demo/WebDAV页面.webp" alt="WebDAV Page" width="300" />
</p>

## Features

- **Unlimited Storage** - Upload unlimited images and files
- **Completely Free** - Hosted on Cloudflare, zero cost within the free quota
- **Free Domain** - Uses `*.pages.dev` subdomain, and also supports custom domains
- **Multiple Storage Backends** - Supports Telegram, Cloudflare R2, S3-compatible storage, Discord, and HuggingFace
- **Telegram Webhook Backlink** - Bot can automatically reply with direct links after receiving files in channels/groups
- **KV Write Optimization** - Telegram can use signed direct links to significantly reduce KV read/write usage
- **Content Moderation** - Optional image moderation API to automatically block inappropriate content
- **Multi-format Support** - Images, videos, audio, documents, archives, and more
- **Online Preview** - Supports preview for images, videos, audio, and documents (pdf, docx, txt)
- **Chunked Upload** - Supports files up to 100MB (with R2/S3)
- **Guest Upload** - Optional guest upload with file size and daily upload limits
- **Multiple Views** - Grid, list, and waterfall management views
- **Storage Classification** - Clearly distinguishes files from different storage backends
- **Dual Deployment Modes** - Keep Cloudflare Pages deployment, and add Docker self-host deployment (`docker compose up -d`)
- **Dynamic Storage Config Management** - Add/Edit/Delete/Test storage configs and switch default storage via admin API
- **Pluggable Settings Store (Docker)** - Basic app settings can use `sqlite` (default) or Redis protocol backends (Upstash / Redis / KVrocks)
- **Simplified Frontend** - Root pages remain the primary UX for upload/admin deployment.
- **GitHub Actions Docker Build** - Auto-build/push `api` + `web` images on main/tag push

### 2026-03 Product Update

- Admin and folder console are now on root page (`/admin.html`) with:
  - folder tree + breadcrumbs
  - file/folder operations (create, rename, move, delete, batch actions)
  - drag upload queue (progress, retry, cancel)
  - direct link + signed share link copy
- Storage capability cards now keep all adapters visible (configured or not) with explicit status/hints.
- Existing direct links (`/file/:id`) remain compatible.

### Cloudflare Pages (No Dashboard Build Setting Changes)

A lightweight workflow note is included in `.github/workflows/pages-deploy.yml`.

- No Cloudflare API secrets are required in this repository by default.
- Recommended deployment path is Cloudflare Pages Git integration (connect your fork directly in Cloudflare Dashboard).
- If you want CLI deployment, run Wrangler locally with your own credentials.

Recommended architecture for multi-cloud mounts:

- Use `WebDAV` adapter in K-Vault as a mounted entry.
- Use `alist/openlist` as aggregation layer for other providers.
- This keeps K-Vault focused on UX/link/auth while reducing adapter maintenance complexity.

---

## Quick Deployment

### Prerequisites

- Cloudflare account
- Telegram account (if using Telegram storage)
- Docker + Docker Compose (optional, for self-host deployment)

### Step 1: Get Telegram Credentials

1. **Get Bot Token**
   - Send `/newbot` to [@BotFather](https://t.me/BotFather)
   - Follow the prompts to create a bot and get `BOT_TOKEN`

2. **Create a Channel and Add the Bot**
   - Create a new Telegram channel
   - Add the bot as a channel administrator

3. **Get Chat ID**
   - Send a message to [@VersaToolsBot](https://t.me/VersaToolsBot) or [@GetTheirIDBot](https://t.me/GetTheirIDBot) to get the channel ID

### Step 2: Deploy to Cloudflare

1. **Fork this repository**

2. **Create a Pages project**
   - Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
   - Go to `Workers and Pages` 鈫?`Create Application` 鈫?`Pages` 鈫?`Connect to Git`
   - Select the forked repository and deploy

3. **Configure environment variables**
   - Go to project `Settings` 鈫?`Environment variables`
   - Add required variables:

| Variable | Description | Required |
| :--- | :--- | :---: |
| `TG_Bot_Token` | Telegram Bot Token | 鉁?|
| `TG_Chat_ID` | Telegram channel ID | 鉁?|
| `TG_BOT_TOKEN` | Telegram Bot Token (Docker/self-host naming) | Optional |
| `TG_CHAT_ID` | Telegram channel ID (Docker/self-host naming) | Optional |
| `BASIC_USER` | Admin username | Optional |
| `BASIC_PASS` | Admin password | Optional |

**Redeploy** - Changes to environment variables require redeployment to take effect

### Step 3: Docker Self-host Deployment (Optional)

If you want to run K-Vault on your own VPS/NAS without Cloudflare Pages runtime:

1. Copy environment template:

```bash
cp .env.example .env
```

2. Fill at least these keys in `.env`:
   - `CONFIG_ENCRYPTION_KEY`
   - `SESSION_SECRET`
   - one bootstrap storage config (for example `TG_BOT_TOKEN` + `TG_CHAT_ID`)
   - optional settings store:
     - default: `SETTINGS_STORE=sqlite`
     - Redis mode: `SETTINGS_STORE=redis` and `SETTINGS_REDIS_URL`

3. Start services:

```bash
docker compose up -d --build
```

Optional local Redis profile (for settings store):

```bash
docker compose --profile redis up -d --build
```

4. Access:
   - Legacy UI: `http://<host>:8080/`
   - WebDAV page: `http://<host>:8080/webdav.html`

For full Docker guide, see [README-DOCKER.md](README-DOCKER.md).

### WebDAV Regression Validation (Works for Pages and Docker)

After deployment, run at least one WebDAV smoke check to verify the full flow: config test -> upload -> download -> delete.

Example:

```bash
BASE_URL=https://your-domain \
BASIC_USER=admin BASIC_PASS=your_password \
SMOKE_STORAGE_TYPE=webdav \
SMOKE_STORAGE_CONFIG_JSON='{"baseUrl":"https://dav.example.com","username":"u","password":"p","rootPath":"uploads"}' \
node scripts/storage-regression.js
```

Validation criteria:

- `webdav.connected` in `/api/status` must be `true`
- `/api/storage/:id/test` must return `connected=true`
- WebDAV `upload / download / delete` in the regression script must all pass

For Docker deployment, simply change `BASE_URL` to your self-hosted address, for example `http://localhost:8080`.

---

## Storage Configuration

### Telegram Enhanced Mode (Self-hosted Bot API + Webhook)

This project supports switching the Telegram API base URL to a self-hosted Bot API and replying with direct links automatically via Webhook when files are received in groups/channels.

**Key environment variables:**

| Variable | Description | Example |
| :--- | :--- | :--- |
| `CUSTOM_BOT_API_URL` | Self-hosted Bot API URL (defaults to `https://api.telegram.org` if not set) | `http://127.0.0.1:8081` |
| `PUBLIC_BASE_URL` | Public domain used for Webhook backlink replies (recommended) | `https://img.example.com` |
| `TG_WEBHOOK_SECRET` | Webhook secret, verified by header `X-Telegram-Bot-Api-Secret-Token` | `your-secret` |
| `TELEGRAM_LINK_MODE` | Telegram link mode; set `signed` to enable signed direct links | `signed` |
| `MINIMIZE_KV_WRITES` | Set `true` to enable low-KV-write mode (also enables signed direct links) | `true` |
| `TELEGRAM_METADATA_MODE` | Telegram metadata write mode: `off` disables admin index writes; lightweight index is default | `off` |
| `TG_UPLOAD_NOTIFY` | Whether to send extra "direct link + File ID" notification after web upload succeeds | `true` |
| `FILE_URL_SECRET` | Signed direct-link secret (falls back to `TG_Bot_Token` if unset) | `random-long-secret` |

**Webhook deployment steps:**

1. Add the bot to the target channel/group on Telegram and grant permission to post (admin recommended for channels).
2. Set `TG_Bot_Token`, `PUBLIC_BASE_URL`, and `TG_WEBHOOK_SECRET` in Cloudflare Pages, then redeploy.
3. Call `setWebhook` and point to this project endpoint: `https://your-domain/api/telegram/webhook`.
4. Send images/files in the channel/group, and the bot will auto-reply with `/file/...` direct links.

**`setWebhook` example (official API):**

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://img.example.com/api/telegram/webhook\",\"secret_token\":\"<YOUR_SECRET>\",\"allowed_updates\":[\"message\",\"channel_post\"]}"
```

**`setWebhook` example (self-hosted Bot API):**

```bash
curl -X POST "http://127.0.0.1:8081/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://img.example.com/api/telegram/webhook\",\"secret_token\":\"<YOUR_SECRET>\",\"allowed_updates\":[\"message\",\"channel_post\"]}"
```

> **About 2GB files:**  
> With a self-hosted Bot API (`CUSTOM_BOT_API_URL`), when files are sent directly from a Telegram client to a group/channel and returned via Webhook links, you can use the Bot API large-file capability (commonly up to 2GB).  
> But the web upload path is still constrained by current frontend strategy and Cloudflare request size limits (see "Usage Limits" below), so it is not equivalent to direct 2GB upload from the web UI.
>
> **Note:** Downloading files through a self-hosted Bot API first caches files on local disk. Reserve enough space and monitor I/O.

### Telegram Low-KV-Write Mode (Optional)

If you are concerned about Cloudflare KV daily quota usage, you can enable:

- `TELEGRAM_LINK_MODE=signed` (signed direct links for Telegram files only)
- Or `MINIMIZE_KV_WRITES=true` (also affects chunked upload task write strategy)

After enabling this, Telegram files still write a lightweight KV index by default (for admin list and management operations). Downloads resolve `file_id` through signed parameters, reducing KV read/write pressure.

> **Optional tradeoff:** If you want Telegram files to skip KV writes entirely, also set `TELEGRAM_METADATA_MODE=off`. In this mode, files will not appear in the admin list, and tag/allowlist/denylist/delete flows that rely on KV metadata will be unavailable.

### KV Storage (Required for Image Management)

To enable image management, configure KV:

1. Go to Cloudflare Dashboard 鈫?`Workers and Pages` 鈫?`KV`
2. Click `Create namespace`, name it `k-vault`
3. Go to your Pages project 鈫?`Settings` 鈫?`Functions` 鈫?`KV namespace bindings`
4. Add binding: variable name `img_url`, choose the namespace you created
5. Redeploy the project

### R2 Storage (Large File Support, Optional)

Configure R2 to support uploads up to 100MB:

1. **Create a bucket**
   - Cloudflare Dashboard 鈫?`R2 Object Storage` 鈫?`Create bucket`
   - Name it `k-vault-files`

2. **Bind to the project**
   - Pages project 鈫?`Settings` 鈫?`Functions` 鈫?`R2 bucket bindings`
   - Variable name `R2_BUCKET`, choose your bucket

3. **Enable R2**
   - `Settings` 鈫?`Environment variables` 鈫?add `USE_R2` = `true`
   - Redeploy

> If redeploy fails with `binding R2_BUCKET of type r2_bucket contains an invalid jurisdiction`, Cloudflare Pages is rejecting the R2 binding metadata before K-Vault code runs. Normal R2 buckets should not set `jurisdiction`; only residency-restricted buckets use `eu` or `fedramp`. Follow [Cloudflare Pages R2 binding troubleshooting](docs/cloudflare-pages-r2.md) to rebuild Production/Preview bindings, or run `npm run pages:r2:doctor -- --check` to validate `wrangler.jsonc`.

### S3-Compatible Storage (Optional)

Supports any S3-compatible object storage service, including AWS S3, MinIO, BackBlaze B2, Alibaba Cloud OSS, etc.

**Environment variables:**

| Variable | Description | Example |
| :--- | :--- | :--- |
| `S3_ENDPOINT` | S3 service endpoint URL | `https://s3.us-east-1.amazonaws.com` |
| `S3_REGION` | Region | `us-east-1` |
| `S3_ACCESS_KEY_ID` | Access Key ID | `AKIA...` |
| `S3_SECRET_ACCESS_KEY` | Secret Access Key | `wJalr...` |
| `S3_BUCKET` | Bucket name | `my-filebed` |

**Endpoint examples by provider:**

| Provider | Endpoint format | Region |
| :--- | :--- | :--- |
| AWS S3 | `https://s3.{region}.amazonaws.com` | `us-east-1` etc. |
| MinIO | `https://minio.example.com:9000` | `us-east-1` |
| BackBlaze B2 | `https://s3.{region}.backblazeb2.com` | `us-west-004` etc. |
| Alibaba Cloud OSS | `https://oss-{region}.aliyuncs.com` | `cn-hangzhou` etc. |
| Cloudflare R2 | `https://{account_id}.r2.cloudflarestorage.com` | `auto` |

**Deployment steps:**

1. Create a bucket in your S3 provider
2. Get Access Key ID and Secret Access Key
3. Add the environment variables above in your Cloudflare Pages project
4. Redeploy, and the frontend will automatically show S3 storage options

### Discord Storage (Optional)

Store files through a Discord channel, supporting both Webhook and Bot modes.

> **Note:** Discord attachment URLs expire after about 24 hours. This project provides downloads through a proxy and refreshes URLs automatically per request. The current version prioritizes Bot message lookup and falls back to Webhook lookup on failure. If both Bot and Webhook are configured, ensure the Bot has read access to the Webhook channel.

**Environment variables:**

| Variable | Description | Required |
| :--- | :--- | :---: |
| `DISCORD_WEBHOOK_URL` | Discord Webhook URL (recommended for uploads) | One of two |
| `DISCORD_BOT_TOKEN` | Discord Bot Token (for fetching and deleting files) | Recommended |
| `DISCORD_CHANNEL_ID` | Discord channel ID (required for Bot-mode upload) | Bot mode |

**Webhook deployment (recommended):**

1. In your Discord server, go to channel settings 鈫?Integrations 鈫?Webhooks
2. Create a new Webhook and copy the Webhook URL
3. Add environment variable `DISCORD_WEBHOOK_URL` in Cloudflare Pages
4. (Recommended) Also create a Discord Bot and set `DISCORD_BOT_TOKEN` for file retrieval and deletion
5. Redeploy

**Bot deployment:**

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) and create an application
2. Create a Bot in the Bot tab and get the token
3. In OAuth2 鈫?URL Generator, select `bot` scope and grant `Administrator` permission to the Bot
4. Use the generated URL to invite the Bot to your server
5. Add `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` in Cloudflare Pages
6. Redeploy

**Troubleshooting (`File not found on Discord`):**

1. Ensure the channel pointed to by `DISCORD_WEBHOOK_URL` is also accessible by the Bot (channel mismatch can cause upload success but direct link failure).
2. Grant the Bot `Administrator` permission directly to avoid read failures from missing channel permissions.
3. You must redeploy Cloudflare Pages after changing environment variables (saving variables alone does not apply immediately).
4. Open `/api/status` and check whether Discord status is `bot`, `webhook`, or `bot+webhook`.

**Limits:**
- Non-Boosted server: 25MB/file
- Level 2 Boost: 50MB/file
- Level 3 Boost: 100MB/file

### HuggingFace Storage (Optional)

Use HuggingFace Datasets API to store files. Files are saved to a Dataset repository as git commits.

**Environment variables:**

| Variable | Description | Example |
| :--- | :--- | :--- |
| `HF_TOKEN` | HuggingFace token with write access | `hf_xxxxxxxxxxxx` |
| `HF_REPO` | Dataset repository ID | `username/my-filebed` |

**Deployment steps:**

1. Register a [HuggingFace](https://huggingface.co) account
2. Create a new Dataset repository (Settings 鈫?New Dataset)
3. Go to [Settings 鈫?Access Tokens](https://huggingface.co/settings/tokens) and create a token (requires Write permission)
4. Add `HF_TOKEN` and `HF_REPO` environment variables in Cloudflare Pages
5. Redeploy

**Limits:**
- Regular upload (base64): about 35MB/file
- LFS upload: up to 50GB/file
- Total free-tier repository size: about 50GB

---

## Guest Upload Feature

Allows non-logged-in users to upload files. Site owners can configure whether it is enabled and apply restriction rules.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `GUEST_UPLOAD` | Enable guest upload | `false` |
| `GUEST_MAX_FILE_SIZE` | Max guest single-file size (bytes) | `5242880` (5MB) |
| `GUEST_DAILY_LIMIT` | Guest daily upload limit (by IP) | `10` |

**How to enable:**

1. Set `GUEST_UPLOAD` = `true` in environment variables
2. Adjust `GUEST_MAX_FILE_SIZE` and `GUEST_DAILY_LIMIT` as needed
3. Ensure `BASIC_USER` and `BASIC_PASS` are configured (otherwise guest/admin cannot be distinguished)
4. Redeploy

**Feature behavior:**
- Guests can upload directly from the homepage without login
- Guest uploads are limited by single-file size and daily count
- Guests cannot use chunked uploads or advanced storage options (S3/Discord/HuggingFace)
- Guests cannot access the admin panel or gallery page
- Limits are based on guest IP address and reset daily

---

## Advanced Configuration

| Variable | Description | Default |
| :--- | :--- | :--- |
| `ModerateContentApiKey` | Image moderation API key (from [moderatecontent.com](https://moderatecontent.com)) | - |
| `WhiteList_Mode` | Whitelist mode, only whitelisted images can be loaded | `false` |
| `USE_R2` | Enable R2 storage | `false` |
| `CUSTOM_BOT_API_URL` | Telegram API base URL (supports self-hosted Bot API) | `https://api.telegram.org` |
| `PUBLIC_BASE_URL` | Public domain used for Webhook backlinks | Current request domain |
| `TG_WEBHOOK_SECRET` | Telegram Webhook secret (also compatible with `TELEGRAM_WEBHOOK_SECRET`) | - |
| `TELEGRAM_LINK_MODE` | Telegram link mode (`signed` for signed direct links) | - |
| `MINIMIZE_KV_WRITES` | Reduce KV writes (also enables signed direct links) | `false` |
| `TELEGRAM_METADATA_MODE` | Telegram metadata write mode (`off` disables admin index writes) | `on` |
| `TG_UPLOAD_NOTIFY` | Send "direct link + File ID" notification after web upload succeeds | `true` |
| `FILE_URL_SECRET` | Signed direct-link secret (also compatible with `TG_FILE_URL_SECRET`) | `TG_Bot_Token` |
| `CHUNK_BACKEND` | Chunk temporary storage backend (`auto`/`r2`/`kv`) | `auto` |
| `disable_telemetry` | Disable telemetry | - |

### Docker Runtime Variables (Self-host Mode)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | API service port inside container | `8787` |
| `DATA_DIR` | Data directory | `/app/data` |
| `DB_PATH` | SQLite database path | `/app/data/k-vault.db` |
| `CHUNK_DIR` | Chunk temp directory | `/app/data/chunks` |
| `CONFIG_ENCRYPTION_KEY` | Required key for encrypting storage config secrets | - |
| `SESSION_SECRET` | Session/signing secret (recommended, separate from encryption key) | - |
| `UPLOAD_MAX_SIZE` | Max upload size in bytes | `104857600` |
| `UPLOAD_SMALL_FILE_THRESHOLD` | Threshold for direct upload vs chunk strategy | `20971520` |
| `CHUNK_SIZE` | Chunk upload size in bytes | `5242880` |
| `DEFAULT_STORAGE_TYPE` | Bootstrap default storage type (`telegram`/`r2`/`s3`/`discord`/`huggingface`) | `telegram` |
| `SETTINGS_STORE` | Basic app settings backend (`sqlite` or `redis`) | `sqlite` |
| `SETTINGS_REDIS_URL` | Redis URL for Upstash/Redis/KVrocks (required when `SETTINGS_STORE=redis`) | - |
| `SETTINGS_REDIS_PREFIX` | Redis key prefix for settings hash | `k-vault` |
| `SETTINGS_REDIS_CONNECT_TIMEOUT_MS` | Redis connect/ping timeout in milliseconds | `5000` |
| `WEB_PORT` | Public web port for `docker compose` | `8080` |

---

## Pages

| Page | Path | Description |
| :--- | :--- | :--- |
| Home/Upload | `/` | Batch upload, drag-and-drop, paste upload |
| WebDAV Page | `/webdav.html` | Dedicated WebDAV upload page with root-style UI |
| Gallery | `/gallery.html` | Image grid browsing |
| Admin Panel | `/admin.html` | File management, blacklist/whitelist |
| File Preview | `/preview.html` | Multi-format file preview |
| Login Page | `/login.html` | Admin login |

---

## Usage Limits

**Cloudflare free quota:**

- 100,000 requests/day
- KV: 1,000 writes/day, 100,000 reads/day, 1,000 list operations/day
- Upgrade to a paid plan if exceeded (starting from $5/month)
- For Telegram-heavy scenarios, signed direct links or low-KV-write mode are recommended to reduce quota pressure
- In Docker self-host mode, these Cloudflare quotas do not apply to the Node runtime itself (limits depend on your server/storage backend)

**File size limits by storage backend:**

| Storage backend | Max single-file size |
| :--- | :--- |
| Telegram (web direct upload) | Small-file direct upload 20MB; current chunked flow limit 100MB |
| Telegram (self-hosted Bot API + Telegram client + Webhook) | Depends on Bot API and deployment environment, commonly up to 2GB |
| Cloudflare R2 | 100MB (chunked upload) |
| S3-compatible storage | 100MB (chunked upload) |
| Discord (non-Boosted) | 25MB |
| Discord (Level 2+) | 50-100MB |
| HuggingFace | 35MB (regular) / 50GB (LFS) |

> Note: `/api/upload-from-url` currently still applies a 20MB limit for Telegram uploads.

---

## Full Environment Variable Reference

| Variable | Description | Required |
| :--- | :--- | :---: |
| `TG_Bot_Token` | Telegram Bot Token | 鉁?|
| `TG_Chat_ID` | Telegram channel ID | 鉁?|
| `CUSTOM_BOT_API_URL` | Self-hosted Telegram Bot API URL | Optional |
| `PUBLIC_BASE_URL` | Webhook backlink domain | Optional |
| `TG_WEBHOOK_SECRET` | Telegram Webhook secret | Optional |
| `TELEGRAM_WEBHOOK_SECRET` | Same as above (compatible variable name) | Optional |
| `TELEGRAM_LINK_MODE` | Telegram link mode (`signed`) | Optional |
| `MINIMIZE_KV_WRITES` | Reduce KV writes and enable signed direct links | Optional |
| `TELEGRAM_METADATA_MODE` | Telegram metadata write mode (`off` disables admin index writes) | Optional |
| `TG_UPLOAD_NOTIFY` | Send "direct link + File ID" notification after web upload succeeds | Optional |
| `FILE_URL_SECRET` | Signed direct-link secret | Optional |
| `TG_FILE_URL_SECRET` | Same as above (compatible variable name) | Optional |
| `BASIC_USER` | Admin username | Optional |
| `BASIC_PASS` | Admin password | Optional |
| `USE_R2` | Enable R2 storage | Optional |
| `CHUNK_BACKEND` | Chunk temporary storage backend (`auto`/`r2`/`kv`) | Optional |
| `S3_ENDPOINT` | S3 endpoint URL | Optional |
| `S3_REGION` | S3 region | Optional |
| `S3_ACCESS_KEY_ID` | S3 access key | Optional |
| `S3_SECRET_ACCESS_KEY` | S3 secret key | Optional |
| `S3_BUCKET` | S3 bucket name | Optional |
| `DISCORD_WEBHOOK_URL` | Discord Webhook URL | Optional |
| `DISCORD_BOT_TOKEN` | Discord Bot Token | Optional |
| `DISCORD_CHANNEL_ID` | Discord channel ID | Optional |
| `HF_TOKEN` | HuggingFace token | Optional |
| `HF_REPO` | HuggingFace repository ID | Optional |
| `GUEST_UPLOAD` | Enable guest upload | Optional |
| `GUEST_MAX_FILE_SIZE` | Guest file size limit (bytes) | Optional |
| `GUEST_DAILY_LIMIT` | Guest daily upload count | Optional |
| `ModerateContentApiKey` | Image moderation API key | Optional |
| `WhiteList_Mode` | Whitelist mode | Optional |
| `disable_telemetry` | Disable telemetry | Optional |
| `PORT` | API port in Docker self-host mode | Optional |
| `DATA_DIR` | Data directory in Docker self-host mode | Optional |
| `DB_PATH` | SQLite database path in Docker self-host mode | Optional |
| `CHUNK_DIR` | Chunk temp directory in Docker self-host mode | Optional |
| `CONFIG_ENCRYPTION_KEY` | Encryption key for storage config secrets (required in Docker mode) | Optional |
| `SESSION_SECRET` | Session/signing secret in Docker self-host mode | Optional |
| `UPLOAD_MAX_SIZE` | Max upload size (bytes) in Docker self-host mode | Optional |
| `UPLOAD_SMALL_FILE_THRESHOLD` | Direct-upload threshold (bytes) in Docker self-host mode | Optional |
| `CHUNK_SIZE` | Chunk size (bytes) in Docker self-host mode | Optional |
| `DEFAULT_STORAGE_TYPE` | Bootstrap default storage type in Docker self-host mode | Optional |
| `SETTINGS_STORE` | Basic app settings backend in Docker mode (`sqlite`/`redis`) | Optional |
| `SETTINGS_REDIS_URL` | Redis URL in Docker mode (Upstash/Redis/KVrocks) | Optional |
| `SETTINGS_REDIS_PREFIX` | Redis key prefix for Docker settings store | Optional |
| `SETTINGS_REDIS_CONNECT_TIMEOUT_MS` | Redis connect/ping timeout in Docker mode (ms) | Optional |
| `WEB_PORT` | Exposed web port for `docker compose` | Optional |

---

## Related Links

- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
- [Docker Deployment Guide](README-DOCKER.md)
- [Docker Image Workflow](.github/workflows/docker-image.yml)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Bot API Server (Self-hosted)](https://github.com/tdlib/telegram-bot-api)
- [Issue Tracker](https://github.com/katelya77/K-Vault/issues)

---

## Acknowledgements

This project references the following open-source project:

- [Telegraph-Image](https://github.com/cf-pages/Telegraph-Image) - Original inspiration

---

## License & Credits

This project is a deep refactor and secondary development based on [K-Vault (katelya77)](https://github.com/katelya77/K-Vault).

- **License Transition**: The original code (up to commit `decdb04`) was licensed under the **CC0 1.0 Universal** license.
- **Current License**: Starting from commit `decdb04`, this project has officially transitioned to the **MIT License**.
- **Refactoring Highlights**: This project introduces significant changes to the original codebase, including:
  - Migrated core storage architecture to **Cloudflare D1** database.
  - Completely rewritten **UI/UX** for a more intuitive cloud drive experience.
  - Added new **file sharing** and permission management systems.
  - Removed automatic download link generation to enhance privacy and security.

All subsequent features and code refactoring are protected under the **MIT License**. Please ensure that the copyright notice and permission notice are included in all copies or substantial portions of the software.

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=katelya77/K-Vault&type=Date)](https://star-history.com/#katelya77/K-Vault&Date)

