# K-Vault Docker 运行指南（中文）

English version: [README-DOCKER-EN.md](README-DOCKER-EN.md)

---

## 部署模式概览

当前仓库支持两种部署模式：

1. Cloudflare Pages + Functions
2. Docker 自托管（Node API + Nginx）

---

## 2026-03 部署变化

### Cloudflare Pages

- 推荐方式改为 Cloudflare Dashboard 直接连接 Git 仓库部署。
- 仓库中的 `.github/workflows/pages-deploy.yml` 现在是说明型手动工作流（`workflow_dispatch`），默认不再依赖：
  - `CF_API_TOKEN`
  - `CF_ACCOUNT_ID`
  - `CF_PAGES_PROJECT`
- 如需 CLI 发布，请在你自己的环境使用 Wrangler 凭据执行。

### Docker

- Docker `web` 服务现在直接托管根目录静态页，和 Pages 入口保持一致：
  - `/`
  - `/admin.html`
  - `/webdav.html`
- 不再需要 `/app/*` 这类单独前端路径作为主流程。
- `api` 与 `functions` 两端都提供了 `/api/health`，回归脚本可统一检查健康状态。

---

## Docker 快速开始

1. 初始化 `.env`（可重复执行，已有密钥不会被覆盖）：

```bash
npm run docker:init-env
```

备用脚本：

```bash
./scripts/bootstrap-env.sh
```

Windows 或无可执行权限环境可用：

```bash
node scripts/bootstrap-env.js
```

1. 至少补全以下配置：

- `CONFIG_ENCRYPTION_KEY`
- `SESSION_SECRET`
- 一套默认存储（例如 `TG_BOT_TOKEN` + `TG_CHAT_ID`）
- 登录鉴权已内置（首个注册用户自动成为管理员）

1. 启动服务：

```bash
npm run docker:up
```

1. 访问地址：

- 上传页：`http://<host>:8080/`
- 后台管理：`http://<host>:8080/admin.html`
- WebDAV 页面：`http://<host>:8080/webdav.html`

1. 检查状态：

```bash
docker compose ps
```

预期：

- `kvault-api` 为 `Up ... (healthy)`
- `kvault-web` 为 `Up ...`
- 若启用 Redis profile，`kvault-redis` 为 `Up ... (healthy)`

---

## 可选：启用 Redis 设置存储

如果你希望基础设置（非文件本体）用 Redis：

1. 在 `.env` 中设置：
   - `SETTINGS_STORE=redis`
   - `SETTINGS_REDIS_URL=redis://redis:6379`
2. 启动 Redis profile：

```bash
docker compose --profile redis up -d --build
```

---

## 登录 API（curl 示例）

`/api/auth/login` 支持两种请求体：

- 新格式：`{"username":"...","password":"..."}`
- 兼容格式：`{"user":"...","pass":"..."}`

```bash
curl -i -X POST "http://localhost:8080/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}'
```

```bash
curl -i -X POST "http://localhost:8080/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"user":"admin","pass":"your_password"}'
```

---

## 架构说明

- `api`：Node.js + Hono（`server/`）
  - 元数据：SQLite（`storage_configs`、`files`、`sessions`、`chunk_uploads`）
  - 设置存储：`sqlite` 或 `redis`
  - 敏感配置加密：`CONFIG_ENCRYPTION_KEY`
  - 存储后端：Telegram / R2 / S3 / Discord / HuggingFace / WebDAV / GitHub
- `web`：Nginx 静态托管 + 反代
  - `/api/*` -> `api:8787`
  - `GET /upload` -> 根目录上传页，`POST /upload` -> `api:8787/upload`
  - `/file/*`、`/share/*` -> `api:8787`
  - `/` -> 根目录静态页面

持久化卷：

- `kvault_data`
- `kvault_redis`（启用 Redis profile 时）

---

## Cloudflare Pages 说明（无 Dashboard 构建配置改造）

- 推荐流程：
  1. Fork 仓库
  2. 在 Cloudflare Pages 中连接 fork
  3. 直接部署
- 仓库中的 `.github/workflows/pages-deploy.yml` 只保留说明用途，不默认执行密钥化 CLI 发布。
- 如果 R2 绑定导致 Pages Functions 发布失败（`invalid jurisdiction`），按 [Cloudflare Pages R2 绑定排查](docs/cloudflare-pages-r2.md) 重建 `R2_BUCKET` 绑定或生成干净的 `wrangler.jsonc`。

---

## 推荐聚合方案（alist/openlist + WebDAV）

为降低多网盘适配维护成本，推荐：

1. K-Vault 负责上传体验、直链与后台管理
2. alist/openlist 负责上游多盘聚合
3. K-Vault 通过 WebDAV 作为挂载入口接入聚合层

优势：

- 聚合层故障时，仅 WebDAV 对应存储受影响
- 站点本体与其他直连存储可继续工作

---

## 网络说明

- `ports`：对宿主机开放端口（`web` 默认 `8080:80`）
- `expose`：仅容器网络内部可见（`api:8787`、`redis:6379`）

---

## 关键环境变量

| 变量 | 说明 |
| :--- | :--- |
| `CONFIG_ENCRYPTION_KEY` | 必填。加解密动态存储配置 |
| `SESSION_SECRET` | Session/签名密钥 |
| `ADMIN_EMAIL` | 注册白名单邮箱（仅此邮箱可注册，未设置关闭注册） |
| `UPLOAD_MAX_SIZE` | 全局上传限制（字节） |
| `UPLOAD_SMALL_FILE_THRESHOLD` | 直传/分片切换阈值 |
| `CHUNK_SIZE` | 分片大小（字节） |
| `DEFAULT_STORAGE_TYPE` | 默认存储类型（`telegram/r2/s3/discord/huggingface/webdav/github`） |
| `SETTINGS_STORE` | 设置存储后端（`sqlite` 或 `redis`） |
| `SETTINGS_REDIS_URL` | Redis URL（`SETTINGS_STORE=redis` 时必填） |
| `SETTINGS_REDIS_PREFIX` | Redis key 前缀 |
| `SETTINGS_REDIS_CONNECT_TIMEOUT_MS` | Redis 连接/心跳超时（毫秒） |
| `TG_BOT_TOKEN` + `TG_CHAT_ID` | Telegram 引导配置 |
| `R2_*` / `S3_*` / `DISCORD_*` / `HF_*` | 可选引导配置 |
| `WEBDAV_*` | WebDAV 配置（`WEBDAV_BASE_URL`、认证、可选路径前缀） |
| `GITHUB_*` | GitHub 配置（仓库、令牌、模式、可选 tag/prefix） |

---

## 安全提示

- 不要把 token/secret 提交到仓库（如 `TG_BOT_TOKEN`、`DISCORD_BOT_TOKEN`、`HF_TOKEN`、`SESSION_SECRET`、`CONFIG_ENCRYPTION_KEY`）。
- 若有泄露风险，立即轮换密钥并重启服务。

---

## Docker 存储排障（GitHub/HuggingFace 显示 Not configured）

如果 Cloudflare 正常、Docker 显示灰色（`enabled=false`、`configured=false`），按下面顺序排查。

### 0) 一键诊断（推荐）

```bash
npm run docker:doctor
```

该命令会自动检查：

- `api` 容器可用性
- `/api/status` 中 GitHub/HuggingFace 的 configured/connected
- 容器内环境变量注入
- 容器到 GitHub/HuggingFace 的网络连通
- `storage_configs` 中是否已引导创建对应配置

如果仍需手工深入，可继续执行下面 1)-7) 步骤。

### 1) 先确认你在看的是 Docker Runtime 的状态接口

Docker 部署的状态来自 Node API（`server/`），不是 Pages Functions。请检查：

```bash
curl -s http://localhost:8080/api/status
```

### 2) 检查容器是否真的拿到环境变量

```bash
docker compose exec api sh -lc "env | grep -E 'HF_|HUGGINGFACE|GITHUB_|GH_|DEFAULT_STORAGE_TYPE'"
```

要求：至少能看到 HuggingFace 与 GitHub 对应变量之一（见下方别名兼容）。

### 3) 检查网络连通性（容器内）

```bash
docker compose exec api sh -lc "wget -S --spider https://api.github.com 2>&1 | head -n 20"
docker compose exec api sh -lc "wget -S --spider https://huggingface.co 2>&1 | head -n 20"
```

若 DNS、代理、防火墙有问题，会在这里直接暴露。

### 4) 检查存储引导是否已写入数据库

```bash
docker compose exec api sh -lc "node -e \"const { createContainer }=require('./lib/container'); const c=createContainer(process.env); console.log(JSON.stringify(c.storageRepo.list(false).map(x=>({type:x.type,name:x.name,enabled:x.enabled,isDefault:x.isDefault})), null, 2));\""
```

期望结果：包含 `huggingface` / `github` 配置项（例如 `HUGGINGFACE (Env Bootstrap)`、`GITHUB (Env Bootstrap)`）。

### 5) 如果刚改了 `.env`，必须重建并重启

```bash
docker compose down
docker compose up -d --build
```

说明：最新版本会在启动时自动补齐缺失的 env bootstrap 存储配置；不重启不会生效。

### 6) 变量名兼容清单（Docker）

- HuggingFace token：`HF_TOKEN` / `HUGGINGFACE_TOKEN` / `HF_API_TOKEN`
- HuggingFace repo：`HF_REPO` / `HUGGINGFACE_REPO` / `HF_DATASET_REPO`
- GitHub token：`GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_PAT`
- GitHub repo：`GITHUB_REPO` / `GH_REPO` / `GITHUB_REPOSITORY`

系统会自动去掉包裹引号（例如 `"ghp_xxx"`），减少 `.env` 误配导致的“未配置”误判。

### 7) 快速判定是“没配置”还是“已配置但连不上”

- `configured=false`：通常是变量没进容器，或变量名不匹配。
- `configured=true` 且 `connected=false`：通常是 token 权限、repo 不存在、网络/代理问题。

这两类问题处理方式不同，先区分再修复。

---

## 管理列表 API（`/api/manage/list`）

默认不带参数时返回第一页。

支持参数：

- `limit`（或 `pageSize` / `size`）：每页数量，默认 `100`，最大 `1000`
- `cursor`（或 `offset`）：分页偏移
- `page`（或 `current`）：页码（仅 cursor 为空时生效）
- `storage`：`all/telegram/r2/s3/discord/huggingface/webdav/github`
- `search`：按文件名和 id 模糊搜索
- `listType`（或 `list_type`）：`all/None/White/Block`
- `includeStats`（或 `stats`）：`1|true|yes` 返回统计

---

## 新增存储说明

- WebDAV：支持 `PUT/GET/DELETE`，自动 `MKCOL` 建目录；连通性检测采用 `OPTIONS` + `PROPFIND`。
- GitHub：
  - `releases`：更适合二进制与较大文件
  - `contents`：更适合小文件/文本（API 限制更严格）

---

## 回归检查

```bash
npm run regression:storage
```

可选烟测配置（示例 WebDAV）：

```bash
BASE_URL=http://localhost:8080 \
SMOKE_STORAGE_TYPE=webdav \
SMOKE_STORAGE_CONFIG_JSON='{"baseUrl":"https://dav.example.com","username":"u","password":"p"}' \
node scripts/storage-regression.js
```

脚本覆盖：

- `health` / `status`
- `login`（两种请求体）
- `storage` 列表/创建/更新/测试/设默认
- 已启用存储的上传/下载/删除

## Docker Smoke CI 与失败快照

仓库新增了 Docker 冒烟工作流：`.github/workflows/docker-smoke.yml`。

该工作流会：

- 启动 Docker `api` 服务并运行 `npm run docker:smoke:ci`
- 校验 `/api/status` 中 `huggingface` 与 `github` 为 `configured=true` 且 `enabled=true`
- 校验 `storage_configs` 中存在 `huggingface` 与 `github` 存储配置

当冒烟失败时，会自动上传 GitHub Actions artifact（`docker-smoke-diagnostics`），包含：

- `.artifacts/api-status.json`
- `.artifacts/storage-profiles.json`

可在对应 workflow run 的 Artifacts 面板直接下载，用于快速定位问题。

---

## 部署补充

- Docker 与 Cloudflare Pages 现在共用同一套根路径页面入口。
- Cloudflare 部署方式本质未变：仍可 Fork 后连接 Pages 直接发布。
- Docker 模式不受 Cloudflare 运行时配额约束（但会受你服务器资源限制）。
- 新镜像工作流：`.github/workflows/docker-image.yml`
  - PR：仅构建
  - main/tag push：构建并推送 `k-vault-api` + `k-vault-web` 到 GHCR

---

## 平台兼容性说明

### Vercel

- 不推荐当前架构直接部署后端。
- 主要原因：函数体积/请求体限制与持久化模型不匹配。

### Zeabur

- 可行，建议拆分 `api` 与 `web` 服务并挂载持久卷。

### ClawCloud

- 可行，建议按容器服务方式拆分部署并绑定持久化存储。

### NAS（如 fnOS/飞牛）

- 具备 Docker/Compose 环境即可使用，导入 `docker-compose.yml` 后映射数据卷并开放端口。

---

## FAQ

### `.env` 不存在

```bash
npm run docker:init-env
```

### `Failed to decrypt storage config "...". Check CONFIG_ENCRYPTION_KEY.`

原因：`CONFIG_ENCRYPTION_KEY` 与历史加密配置不一致。  
处理：

1. 恢复原密钥
2. 若原密钥丢失，删除并重建对应存储配置
3. 避免在运行中的实例随意更换加密密钥

### Docker Compose 的 buildx/bake 提示

某些 Docker 版本会出现 bake 相关提示，可忽略或按需启用/关闭：

- 启用：`COMPOSE_BAKE=true`
- 关闭：`COMPOSE_BAKE=false`
- 若提示缺少 buildx，请安装 `docker-buildx`

---

## 本地开发

后端：

```bash
npm --prefix server install
npm --prefix server run dev
```

前端：

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

Docker 运行时当前以根目录静态页为主，与 Cloudflare Pages 行为对齐。
