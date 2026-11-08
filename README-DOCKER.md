# K-Vault Docker 部署指南

English version: [README-DOCKER-EN.md](README-DOCKER-EN.md)

## 结论

Docker 部署现在只有一个镜像：

```text
ghcr.io/katelya77/k-vault:latest
```

这个镜像内置：

- 仓库根目录静态页面：`/`、`/admin.html`、`/gallery.html`、`/webdav.html`
- Node.js/Hono API
- Nginx 统一入口和反向代理
- SQLite 数据库和分片临时目录，默认持久化到 `/app/data`

旧的 `k-vault-api` / `k-vault-web` 双镜像部署已经废弃。GitHub Actions 只构建和发布 `k-vault` 一个 GHCR package。

## 最简单部署

不需要克隆仓库，也不需要 Node/npm：

```bash
docker volume create kvault_data
docker run -d \
  --name kvault \
  --restart unless-stopped \
  -p 8080:8080 \
  -v kvault_data:/app/data \
  ghcr.io/katelya77/k-vault:latest
```

访问：

- 上传首页：`http://<host>:8080/`
- 管理后台：`http://<host>:8080/admin.html`
- WebDAV 页面：`http://<host>:8080/webdav.html`
- 健康检查：`http://<host>:8080/api/health`

首次启动时，如果没有传入 `CONFIG_ENCRYPTION_KEY` / `SESSION_SECRET`，容器会自动生成并保存到数据卷的 `/app/data/runtime.env`。只要保留 `kvault_data` 卷，重建容器不会丢失这些密钥。

**公网部署前必须设置强随机管理员密码**。上面的无凭据启动命令仅适合隔离的本地测试；下面先生成唯一密码：

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

## Docker Compose 部署

如果你已经克隆仓库：

```bash
docker compose up -d
```

`docker-compose.yml` 默认拉取 `ghcr.io/katelya77/k-vault:latest`，并把数据保存到 `kvault_data` 卷。`.env` 是可选的；没有 `.env` 也能启动。

需要固定账号、域名、默认存储或上传限制时再创建 `.env`：

```bash
cp .env.example .env
# 启动前编辑 .env，设置强随机 BASIC_PASS。
docker compose up -d
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
# 启动前编辑 .env，设置强随机 BASIC_PASS。
docker compose up -d
```

查看状态：

```bash
docker compose ps
docker compose logs -f k-vault
```

预期 `kvault` 为 `Up ... (healthy)`。

## 配置存储后端

Docker 支持两种配置方式：

1. **后台动态配置**：启动后访问 `/admin.html`，新增、测试、设为默认存储。这是最直观的方式。
2. **环境变量引导配置**：在 `.env` 或 `docker run -e` 中写入默认存储变量，容器启动时写入 SQLite。

常用变量：

| 变量 | 说明 |
| :--- | :--- |
| `BASIC_USER` / `BASIC_PASS` | 后台登录账号，公网部署建议设置 |
| `PUBLIC_BASE_URL` | 外部访问域名，用于直链、分享、Webhook 回链 |
| `DEFAULT_STORAGE_TYPE` | 默认存储类型：`telegram` / `r2` / `s3` / `discord` / `huggingface` / `webdav` / `github` |
| `TG_BOT_TOKEN` + `TG_CHAT_ID` | Telegram |
| `R2_ENDPOINT` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare R2 |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3 兼容存储 |
| `WEBDAV_BASE_URL` / `WEBDAV_USERNAME` / `WEBDAV_PASSWORD` / `WEBDAV_BEARER_TOKEN` / `WEBDAV_ROOT_PATH` | WebDAV |
| `GITHUB_REPO` / `GITHUB_TOKEN` / `GITHUB_MODE` / `GITHUB_PREFIX` | GitHub |
| `HF_TOKEN` / `HF_REPO` | HuggingFace |
| `UPLOAD_MAX_SIZE` / `UPLOAD_SMALL_FILE_THRESHOLD` / `CHUNK_SIZE` | 上传限制和分片参数 |
| `WEB_PORT` | Compose 对外端口，默认 `8080` |

WebDAV、GitHub、HuggingFace、S3/R2 等后端配置好后，首页存储按钮、`/webdav.html`、后台管理和 `/api/status` 会同步显示状态。API Token 上传走 `/api/v1/upload`，普通网页上传走 `POST /upload`。

## 和 Cloudflare Pages 的一致性

Docker 和 Cloudflare Pages 使用同一套根目录静态页面和主路径：

- `/`：上传首页
- `/admin.html`：后台管理、存储配置、API Token 管理
- `/webdav.html`：WebDAV 上传/测试页面
- `/api/*`：管理、状态、认证、存储测试、API v1
- `POST /upload`：网页上传
- `/api/v1/upload`：API Token 上传
- `/file/*`、`/share/*`、`/s/*`：文件直链、分享和短链

差异只在运行时：

- Cloudflare Pages 使用 Pages Functions、KV/R2 绑定。
- Docker 使用容器内 Node API、SQLite 和 `/app/data` 数据卷。

UI、功能入口、多存储后端、WebDAV 页面、API Token 上传和分享链接的使用方式保持一致。

## 可选 Redis 设置存储

默认使用 SQLite。需要把基础设置放到 Redis 时：

```dotenv
SETTINGS_STORE=redis
SETTINGS_REDIS_URL=redis://redis:6379
```

启动 Redis profile：

```bash
docker compose --profile redis up -d
```

文件元数据和动态存储配置仍保存在 `/app/data/k-vault.db`。

## 升级

Docker Run：

```bash
docker pull ghcr.io/katelya77/k-vault:latest
docker rm -f kvault
docker run -d --name kvault --restart unless-stopped -p 8080:8080 -v kvault_data:/app/data ghcr.io/katelya77/k-vault:latest
```

Docker Compose：

```bash
docker compose pull
docker compose up -d
```

不要删除 `kvault_data` 卷，除非你明确要清空数据库、上传记录、动态存储配置和自动生成的运行时密钥。

## 本地源码构建

开发验证：

```bash
docker build -t k-vault:local .
```

使用本地镜像启动 Compose：

```bash
KVAULT_IMAGE=k-vault:local docker compose up -d
```

PowerShell：

```powershell
$env:KVAULT_IMAGE = "k-vault:local"
docker compose up -d
```

## 排障

检查公共入口：

```bash
curl http://localhost:8080/api/health
curl http://localhost:8080/
```

查看容器日志：

```bash
docker logs -f kvault
```

查看 Compose 日志：

```bash
docker compose logs -f k-vault
```

检查容器内环境变量：

```bash
docker compose exec k-vault sh -lc "env | grep -E 'DEFAULT_STORAGE_TYPE|TG_|R2_|S3_|HF_|GITHUB_|WEBDAV_|BASIC_|PUBLIC_BASE_URL'"
```

检查存储配置是否写入 SQLite：

```bash
docker compose exec k-vault sh -lc "cd /app/server && node -e \"const { createContainer }=require('./lib/container'); const c=createContainer(process.env); console.log(JSON.stringify(c.storageRepo.list(false), null, 2));\""
```

运行存储诊断：

```bash
npm run docker:doctor
```

清空所有 Docker 数据前请确认已经备份：

```bash
docker compose down -v
```
