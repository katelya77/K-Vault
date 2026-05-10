<div align="center">

<img src="logo.png" alt="K-Vault Logo" width="140">

# K-Vault

> 免费图片/文件托管解决方案，支持 Cloudflare Pages + Docker 双模部署，并兼容多种存储后端

[English](README-EN.md) | **中文**

<br>

![GitHub stars](https://img.shields.io/github/stars/katelya77/K-Vault?style=flat-square)
![GitHub forks](https://img.shields.io/github/forks/katelya77/K-Vault?style=flat-square)
![GitHub license](https://img.shields.io/github/license/katelya77/K-Vault?style=flat-square)

</div>

---

## 效果图

<p align="center">
  <img src="demo/登录页面.webp" alt="登录页面" width="300" />
  <img src="demo/首页上传页面.webp" alt="首页上传页面" width="300" />
  <img src="demo/后台管理页面.webp" alt="后台管理页面" width="300" />
</p>
<p align="center">
  <img src="demo/图片浏览页面.webp" alt="图片浏览页面" width="300" />
  <img src="demo/WebDAV页面.webp" alt="WebDAV页面" width="300" />
</p>

## 功能特性

- **无限存储** - 不限数量的图片和文件上传
- **完全免费** - 托管于 Cloudflare，免费额度内零成本
- **免费域名** - 使用 `*.pages.dev` 二级域名，也支持自定义域名
- **多存储后端** - 支持 Telegram、Cloudflare R2、S3 兼容存储、Discord、HuggingFace、WebDAV、GitHub
- **Telegram Webhook 回链** - 机器人在频道/群接收文件后自动回复直链
- **KV 写入优化** - Telegram 可启用签名直链，显著降低 KV 读写消耗
- **内容审核** - 可选的图片审核 API，自动屏蔽不良内容
- **多格式支持** - 图片、视频、音频、文档、压缩包等
- **在线预览** - 支持图片、视频、音频、文档（pdf、docx、txt）格式的预览
- **分片上传** - 支持最大 100MB 文件（配合 R2/S3）
- **访客上传** - 可选的访客上传功能，支持文件大小和每日次数限制
- **API Token 认证** - 支持 `curl` / ShareX / 脚本等程序化上传与调用
- **多种视图** - 网格、列表、瀑布流多种管理界面
- **存储分类** - 直观区分不同存储后端的文件
- **双模部署** - 保留 Cloudflare Pages 部署，同时新增 Docker 自托管（`docker compose up -d`）
- **动态存储配置管理** - 支持在管理端通过 API 对存储配置进行新增/编辑/删除/测试/设为默认
- **可插拔设置存储（Docker）** - 基础站点设置可使用 `sqlite`（默认）或 Redis 协议后端（Upstash / Redis / KVrocks）
- **前端路径简化** - 以根路径页面为主流程（`/`、`/admin.html`、`/webdav.html`）
- **GitHub Actions 镜像构建** - 主分支/Tag 自动构建并推送 `api` + `web` 镜像
- **D1 数据库支持** - 使用 Cloudflare D1 替代 KV，支持复杂查询和多级文件夹
- **高效分页查询** - 基于数据库索引的毫秒级分页响应，支持数万文件
- **新版前端** - Vue 3 + TypeScript 现代化 UI，仪表盘可视化

---

## 架构升级

### 从 KV 迁移到 D1 数据库

**v2.0 重大更新**：我们已将核心数据存储从 Cloudflare KV 迁移到 D1 数据库，解决了大规模文件场景下的性能瓶颈。

#### 为什么升级？

- **性能瓶颈**：KV 的 `list` 操作在文件数量庞大时性能急剧下降
- **查询限制**：KV 无法进行复杂的关联查询和多维度筛选
- **文件夹支持**：KV 无法实现真正的多级文件夹层级结构

#### 新架构优势

| 特性 | KV（旧） | D1（新） |
|------|---------|---------|
| 文件列表查询 | O(n) 全表扫描 | O(log n) 索引查询 |
| 多级文件夹 | ❌ 不支持 | ✅ 无限层级 |
| 复杂查询 | ❌ 不支持 | ✅ SQL 查询 |
| 分页性能 | 随数据量下降 | 恒定毫秒级 |
| 关联查询 | ❌ 不支持 | ✅ JOIN 支持 |

#### 数据存储分布

| 数据类型 | 存储位置 | 原因 |
|---------|---------|------|
| 文件元数据 | D1/SQLite | 需要复杂查询和索引 |
| 文件夹结构 | D1/SQLite | 需要层级关系 |
| 分享链接 | D1/SQLite | 需要关联查询 |
| API Token | D1/SQLite | 需要持久化存储 |
| 存储配置 | D1/SQLite | 需要持久化存储 |
| 会话管理 | KV | 临时数据，自动过期 |
| 分片上传 | KV | 临时数据，自动过期 |
| 访客计数 | KV | 计数器，简单操作 |

#### 数据库表结构

**核心表**：
- `files` - 文件元数据（支持文件夹关联、多维度索引）
- `folders` - 文件夹层级结构（支持无限级目录）
- `shares` - 分享链接管理
- `api_tokens` - API Token 管理
- `storage_configs` - 存储配置管理

**性能优化**：
- 文件夹内文件列表：复合索引 `(folder_id, created_at)`
- 存储类型筛选：单列索引 `storage_type`
- 文件搜索：全文索引支持

详细架构说明请查看 [docs/architecture.md](docs/architecture.md)。

---

## 快速部署

### 前置要求

- Cloudflare 账户
- Telegram 账户（如使用 Telegram 存储）
- Docker + Docker Compose（可选，用于自托管部署）

### 第一步：获取 Telegram 凭据

1. **获取 Bot Token**
   - 向 [@BotFather](https://t.me/BotFather) 发送 `/newbot`
   - 按提示创建机器人，获得 `BOT_TOKEN`

2. **创建频道并添加机器人**
   - 创建一个新的 Telegram 频道
   - 将机器人添加为频道管理员

3. **获取 Chat ID**
   - 向 [@VersaToolsBot](https://t.me/VersaToolsBot) 或 [@GetTheirIDBot](https://t.me/GetTheirIDBot) 发送消息获取频道 ID

### 第二步：部署到 Cloudflare

1. **Fork 本仓库**

2. **创建 Pages 项目**
   - 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
   - 进入 `Workers 和 Pages` → `创建应用程序` → `Pages` → `连接到 Git`
   - 选择 Fork 的仓库，点击部署

3. **配置环境变量**
   - 进入项目 `设置` → `环境变量`
   - 添加必需变量：

| 变量名 | 说明 | 必需 |
| :--- | :--- | :---: |
| `TG_Bot_Token` | Telegram Bot Token | ✅ |
| `TG_Chat_ID` | Telegram 频道 ID | ✅ |
| `BASIC_USER` | 管理后台用户名 | 可选 |
| `BASIC_PASS` | 管理后台密码 | 可选 |
| `ADMIN_EMAIL` | 管理员邮箱（可用邮箱登录） | 可选 |
| `ALLOW_MEMORY_SESSION` | 允许内存会话存储（仅本地开发） | 可选 |
| `STORAGE_TOTAL_CAPACITY` | 总存储容量（支持 TB/GB/MB/KB/B，默认 114TB） | 可选 |

**重新部署** - 修改环境变量后需重新部署生效

### 第三步：部署新版前端（可选）

项目提供新版前端（`frontend-v2`），采用 Vue 3 + TypeScript + Pinia 架构，提供更现代化的用户体验。

#### 本地开发

```bash
# 安装依赖
npm run frontend-v2:dev

# 或者手动进入目录
cd frontend-v2
pnpm install
pnpm dev
```

#### Cloudflare Pages 部署

**方法一：修改构建配置（推荐）**

在 Cloudflare Pages 项目设置中修改：

1. **构建命令**：
   ```bash
   cd frontend-v2 && pnpm install && pnpm build
   ```

2. **输出目录**：
   ```
   frontend-v2/dist
   ```

**方法二：使用 npm 脚本**

在项目根目录执行：
```bash
npm run frontend-v2:build
```

然后将 `frontend-v2/dist` 目录部署到 Cloudflare Pages。

#### 新版前端特性

- 🎨 现代化 UI 设计
- 📊 仪表盘首页（容量使用可视化）
- 📁 文件管理界面（支持文件夹导航）
- 📤 上传功能（开发中）
- 🌙 暗色模式（计划中）

#### 新旧前端对比

| 特性 | 旧版前端（frontend） | 新版前端（frontend-v2） |
|------|---------------------|------------------------|
| 框架 | Vue 3 | Vue 3 + TypeScript |
| 状态管理 | Pinia | Pinia + TypeScript |
| 路由 | Vue Router | Vue Router + 类型 |
| UI 风格 | 经典 | 现代化 |
| 仪表盘 | ❌ | ✅ |
| 文件夹导航 | ❌ | ✅ |
| TypeScript | ❌ | ✅ |

### 第四步：创建 D1 数据库（Cloudflare Pages）

v2.0 使用 D1 数据库替代 KV 存储，需要先创建并绑定数据库：

1. **创建 D1 数据库**
   ```bash
   npx wrangler d1 create kvault-db
   ```

2. **记录数据库 ID**
   命令会返回 `database_id`，例如：
   ```
   database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   ```

3. **绑定数据库到 Pages 项目**
   - 进入 Cloudflare Dashboard → Workers 和 Pages → 你的项目
   - 设置 → 函数 → D1 数据库绑定
   - 添加绑定：
     - 变量名称：`DB`
     - D1 数据库：选择刚创建的数据库

4. **初始化数据库表结构**
   ```bash
   # 下载 schema 文件
   curl -o schema-d1.sql https://raw.githubusercontent.com/katelya77/K-Vault/main/server/db/schema-d1.sql
   
   # 执行数据库迁移
   npx wrangler d1 execute kvault-db --file=./schema-d1.sql
   ```

### 第五步：数据迁移（可选）

如果你从 v1.0 升级到 v2.0，需要将 KV 数据迁移到 D1 数据库。

#### 自动迁移（推荐）

1. **访问管理后台**
   - 打开 `https://你的域名/admin.html`
   - 使用 `BASIC_USER` 和 `BASIC_PASS` 登录

2. **打开迁移工具**
   - 点击页面右上角的工具箱图标
   - 选择"数据库迁移"

3. **查看迁移状态**
   - 系统会自动检测是否需要迁移
   - 显示当前数据库统计信息

4. **执行迁移**
   - 点击"开始迁移"按钮
   - 等待迁移完成
   - 查看迁移结果报告

#### 手动迁移（高级）

也可以使用 API 进行迁移：

```bash
# 查看迁移状态
curl -X GET https://你的域名/api/admin/migrate \
  -u admin:password

# 执行迁移
curl -X POST https://你的域名/api/admin/migrate \
  -u admin:password \
  -H "Content-Type: application/json" \
  -d '{}'
```

**详细迁移说明**：
- [Cloudflare Pages 迁移指南](docs/migration-cloudflare.md)
- [Docker 迁移指南](docs/migration-docker.md)

### 第六步：Docker 自托管部署（可选）

如果你希望在自己的 VPS/NAS 上运行（不依赖 Cloudflare Pages 运行时）：

1. 复制环境变量模板：

```bash
npm run docker:init-env
```

该命令会在 `.env` 不存在时自动创建，并仅在密钥为空或占位符时生成 `CONFIG_ENCRYPTION_KEY` 与 `SESSION_SECRET`，不会每次重置已有密钥。

2. 至少填写以下关键变量：
   - `CONFIG_ENCRYPTION_KEY`
   - `SESSION_SECRET`
   - 一套默认存储配置（例如 `TG_BOT_TOKEN` + `TG_CHAT_ID`）
   - 可选设置存储：
     - 默认：`SETTINGS_STORE=sqlite`
     - Redis 模式：`SETTINGS_STORE=redis` 且配置 `SETTINGS_REDIS_URL`

3. 启动服务：

```bash
npm run docker:up
```

如需启用本地 Redis（用于基础设置存储）：
```bash
docker compose --profile redis up -d --build
```

4. 访问地址：
   - 上传首页：`http://<host>:8080/`
   - 管理后台：`http://<host>:8080/admin.html`
   - WebDAV 页面：`http://<host>:8080/webdav.html`

完整 Docker 说明请查看 [README-DOCKER.md](README-DOCKER.md)。

### 第七步：WebDAV 回归验证（Cloudflare Pages / Docker 通用）

部署完成后，建议至少执行一次 WebDAV 烟测，确认“配置测试 -> 上传 -> 下载 -> 删除”完整闭环。

示例：

```bash
BASE_URL=https://你的域名 \
BASIC_USER=admin BASIC_PASS=your_password \
SMOKE_STORAGE_TYPE=webdav \
SMOKE_STORAGE_CONFIG_JSON='{"baseUrl":"https://dav.example.com","username":"u","password":"p","rootPath":"uploads"}' \
node scripts/storage-regression.js
```

校验标准：

- `/api/status` 中 `webdav.connected` 必须为 `true`
- `/api/storage/:id/test` 必须返回 `connected=true`
- 回归脚本中的 WebDAV `upload / download / delete` 三步必须全部通过

如果是 Docker 部署，只需把 `BASE_URL` 换成你的自托管地址，例如 `http://localhost:8080`。

### Docker 登录 API（curl 示例）

`/api/auth/login` 同时兼容两种请求体：

- `{"username":"...","password":"..."}`
- `{"user":"...","pass":"..."}`

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

安全提示：请勿泄露或提交 `.env` 内 token/secret（如 `TG_BOT_TOKEN`、`DISCORD_BOT_TOKEN`、`HF_TOKEN`、`SESSION_SECRET`、`CONFIG_ENCRYPTION_KEY`）；若疑似泄露请立即轮换并重启服务。

---

## 文件名混淆

### 功能说明

文件名混淆功能通过将上传文件的原始文件名替换为随机生成的 UUID 或 SHA-256 哈希值，防止第三方平台（如 GitHub、Hugging Face）的特征扫描和自动封禁，提升存储账户的绝对安全性。

**主要特性：**
- ✅ 防止敏感文件名触发第三方平台扫描
- ✅ 降低存储账户被自动封禁的风险
- ✅ 保护用户隐私
- ✅ 完全兼容旧文件（未混淆的文件可正常访问）
- ✅ 支持所有存储后端（Telegram、R2、S3、Discord、HuggingFace、WebDAV、GitHub）

### 环境变量配置

| 变量名 | 说明 | 必需 | 默认值 |
| :--- | :--- | :---: | :--- |
| `OBFUSCATE_FILE_NAMES` | 是否启用文件名混淆 | 否 | `false` |
| `OBFUSCATE_METHOD` | 混淆方法：`uuid` 或 `sha256` | 否 | `uuid` |
| `OBFUSCATE_EXTENSION` | 文件后缀：`.bin`、`.data` 等 | 否 | `.bin` |

### 使用示例

```bash
# 启用文件名混淆
OBFUSCATE_FILE_NAMES=true

# 使用 UUID 方法（默认）
OBFUSCATE_METHOD=uuid

# 使用 .bin 后缀（默认）
OBFUSCATE_EXTENSION=.bin
```

### 工作原理

1. **上传时**：将原始文件名替换为随机 UUID + 统一后缀（如 `a1b2c3d4e5f6.bin`）
2. **存储时**：在数据库中保存原始文件名与物理文件名的映射关系
3. **下载时**：查询数据库获取原始文件名，通过 `Content-Disposition` 响应头返回给浏览器

---

## 调试模式

调试模式用于开发和故障排查，启用后会输出详细的日志信息。

### 环境变量

| 变量名 | 说明 | 必填 | 默认值 |
|--------|------|------|--------|
| `DEBUG` | 是否启用调试模式 | 否 | `false` |

### 启用调试模式

```bash
# 启用调试模式
DEBUG=true
```

### 调试日志输出

启用调试模式后，系统会在关键操作点输出详细日志：

- 文件上传和下载流程
- 数据库查询操作
- 文件名混淆处理
- 存储后端交互
- 认证和授权流程

**注意**：调试模式会输出敏感信息，仅建议在开发环境使用，生产环境请保持关闭。

---

## 存储配置

### Telegram 增强模式（自部署 Bot API + Webhook）

项目已支持将 Telegram API 基础地址切换为自部署 Bot API，并支持通过 Webhook 在群/频道接收文件后自动回复直链。

**关键环境变量：**

| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `CUSTOM_BOT_API_URL` | 自部署 Bot API 地址（不填则默认 `https://api.telegram.org`） | `http://127.0.0.1:8081` |
| `PUBLIC_BASE_URL` | Webhook 回链时使用的公网域名（建议填写） | `https://img.example.com` |
| `TG_WEBHOOK_SECRET` | Webhook 密钥，校验头 `X-Telegram-Bot-Api-Secret-Token` | `your-secret` |
| `TELEGRAM_LINK_MODE` | Telegram 链接模式，设为 `signed` 启用签名直链 | `signed` |
| `MINIMIZE_KV_WRITES` | 设为 `true` 时启用低 KV 写入策略（也会启用签名直链） | `true` |
| `TELEGRAM_METADATA_MODE` | Telegram 元数据写入策略：`off` 关闭后台索引写入，默认写轻量索引 | `off` |
| `TG_UPLOAD_NOTIFY` | 网页上传成功后，是否额外发送“直链+File ID”通知消息 | `true` |
| `FILE_URL_SECRET` | 签名直链密钥（不填则回退到 `TG_Bot_Token`） | `random-long-secret` |

**Webhook 部署步骤：**

1. 在 Telegram 中把 Bot 拉进目标频道/群并授予发言权限（频道建议管理员）。
2. 在 Cloudflare Pages 中配置 `TG_Bot_Token`、`PUBLIC_BASE_URL`、`TG_WEBHOOK_SECRET`，然后重新部署。
3. 调用 `setWebhook` 指向本项目接口：`https://你的域名/api/telegram/webhook`。
4. 频道/群内发送图片或文件，Bot 会自动回复 `/file/...` 直链。

**`setWebhook` 示例（官方 API）：**

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://img.example.com/api/telegram/webhook\",\"secret_token\":\"<YOUR_SECRET>\",\"allowed_updates\":[\"message\",\"channel_post\"]}"
```

**`setWebhook` 示例（自部署 Bot API）：**

```bash
curl -X POST "http://127.0.0.1:8081/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://img.example.com/api/telegram/webhook\",\"secret_token\":\"<YOUR_SECRET>\",\"allowed_updates\":[\"message\",\"channel_post\"]}"
```

> **关于 2G 文件：**  
> 使用自部署 Bot API（`CUSTOM_BOT_API_URL`）并由 Telegram 客户端直接发到群/频道，再由 Webhook 回链，可利用 Bot API 大文件能力（常见可到 2GB）。  
> 但网页上传链路仍受当前前端策略与 Cloudflare 请求体限制影响（见下方“使用限制”），不等同于前端直接上传 2GB。
>
> **注意：** 自部署 Bot API 下载文件会先缓存到本地磁盘，请预留足够空间并关注 I/O。

### Telegram 低 KV 写入模式（可选）

当你担心 Cloudflare KV 每日读写额度不够时，可以启用：

- `TELEGRAM_LINK_MODE=signed`（仅 Telegram 文件使用签名直链）
- 或 `MINIMIZE_KV_WRITES=true`（同时影响分片上传任务写入策略）

启用后，Telegram 文件默认仍会写入轻量 KV 索引（用于后台列表和管理操作），下载时通过签名参数直接解析 `file_id`，从而降低 KV 读写压力。

> **可选取舍：** 若你希望 Telegram 文件完全不写入 KV，请额外设置 `TELEGRAM_METADATA_MODE=off`。此时文件不会出现在后台列表，也无法使用依赖 KV 元数据的标签/黑白名单/删除流程。

### KV 存储（图片管理，必需）

启用图片管理功能需要配置 KV：

1. 进入 Cloudflare Dashboard → `Workers 和 Pages` → `KV`
2. 点击 `创建命名空间`，命名为 `k-vault`
3. 进入 Pages 项目 → `设置` → `函数` → `KV 命名空间绑定`
4. 添加绑定：变量名 `img_url`，选择创建的命名空间
5. 重新部署项目

### 前端 UI 设计配置（跨端同步）

支持在后台统一设置全站 UI 风格（首页、图库、后台、WebDAV、登录页）。

**入口位置：**

1. 打开管理后台：`/admin.html`
2. 点击工具栏中的 **前端 UI 设计**（滑杆图标）
3. 在弹窗中调整样式并点击 **保存设置**

**可配置项：**

- 背景图（全站 / 登录页单独）
- 卡片透明度与模糊强度（毛玻璃效果）
- 动态背景特效类型与强度（含移动端优化）

**持久化机制：**

- Cloudflare Pages：写入 KV 键 `ui_config`（通过 `img_url` 绑定访问）
- Docker 自托管：写入 `data/ui_config.json`
- 前端会在接口失败时降级到 `localStorage`（仅本机生效）

**接口说明：**

- `GET /api/ui-config`：读取配置（页面初始化自动调用）
- `POST /api/ui-config`：保存配置（需管理员登录态）

**快速排查：**

- `GET /api/ui-config` 返回 `source: "default"`：表示服务端尚未保存过配置，或写入失败
- Cloudflare 场景请确认：Pages 项目已绑定 KV（变量名必须是 `img_url`），且变更后已重新部署
- 若保存后跨端未生效，先强制刷新页面缓存（`Ctrl+F5` / 无痕窗口），再查看 Functions 日志中的 `/api/ui-config` 请求记录

### R2 存储（大文件支持，可选）

配置 R2 可支持最大 100MB 文件上传：

1. **创建存储桶**
   - Cloudflare Dashboard → `R2 对象存储` → `创建存储桶`
   - 命名为 `k-vault-files`

2. **绑定到项目**
   - Pages 项目 → `设置` → `函数` → `R2 存储桶绑定`
   - 变量名 `R2_BUCKET`，选择存储桶

3. **启用 R2**
   - `设置` → `环境变量` → 添加 `USE_R2` = `true`
   - 重新部署

> 如果重新部署时报 `binding R2_BUCKET of type r2_bucket contains an invalid jurisdiction`，说明 Cloudflare Pages 在校验 R2 绑定元数据时失败，不是上传代码报错。普通 R2 桶不要设置 `jurisdiction`；只有带数据驻留限制的桶才使用 `eu` 或 `fedramp`。按 [Cloudflare Pages R2 绑定排查](docs/cloudflare-pages-r2.md) 删除并重建 Production/Preview 绑定，或运行 `npm run pages:r2:doctor -- --check` 校验 `wrangler.jsonc`。

### S3 兼容存储（可选）

支持任何 S3 兼容的对象存储服务，包括 AWS S3、MinIO、BackBlaze B2、阿里云 OSS 等。

**环境变量：**

| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `S3_ENDPOINT` | S3 服务端点 URL | `https://s3.us-east-1.amazonaws.com` |
| `S3_REGION` | 区域 | `us-east-1` |
| `S3_ACCESS_KEY_ID` | 访问密钥 ID | `AKIA...` |
| `S3_SECRET_ACCESS_KEY` | 秘密访问密钥 | `wJalr...` |
| `S3_BUCKET` | 存储桶名称 | `my-filebed` |

**不同服务商的 Endpoint 示例：**

| 服务商 | Endpoint 格式 | Region |
| :--- | :--- | :--- |
| AWS S3 | `https://s3.{region}.amazonaws.com` | `us-east-1` 等 |
| MinIO | `https://minio.example.com:9000` | `us-east-1` |
| BackBlaze B2 | `https://s3.{region}.backblazeb2.com` | `us-west-004` 等 |
| 阿里云 OSS | `https://oss-{region}.aliyuncs.com` | `cn-hangzhou` 等 |
| Cloudflare R2 | `https://{account_id}.r2.cloudflarestorage.com` | `auto` |

**部署步骤：**

1. 在你的 S3 服务商创建存储桶
2. 获取 Access Key ID 和 Secret Access Key
3. 在 Cloudflare Pages 项目中添加上述环境变量
4. 重新部署，前端将自动显示 S3 存储选项

### Discord 存储（可选）

通过 Discord 频道存储文件，支持 Webhook 和 Bot 两种方式。

> **注意：** Discord 附件 URL 会在约 24 小时后过期。本项目通过代理方式提供文件下载，每次请求时自动刷新 URL。当前版本会优先使用 Bot 查询消息，并在失败时自动回退到 Webhook 查询。若同时配置 Bot + Webhook，请确保 Bot 对 Webhook 所在频道具备读取权限。

**环境变量：**

| 变量名 | 说明 | 必需 |
| :--- | :--- | :---: |
| `DISCORD_WEBHOOK_URL` | Discord Webhook URL（推荐用于上传） | 二选一 |
| `DISCORD_BOT_TOKEN` | Discord Bot Token（用于获取和删除文件） | 推荐 |
| `DISCORD_CHANNEL_ID` | Discord 频道 ID（Bot 模式上传时需要） | Bot 模式 |

**Webhook 方式部署（推荐）：**

1. 在 Discord 服务器中，进入频道设置 → 集成 → Webhook
2. 创建新的 Webhook，复制 Webhook URL
3. 在 Cloudflare Pages 添加环境变量 `DISCORD_WEBHOOK_URL`
4. （推荐）同时创建 Discord Bot 并添加 `DISCORD_BOT_TOKEN`，用于文件获取和删除
5. 重新部署

**Bot 方式部署：**

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications) 创建应用
2. 在 Bot 标签页创建 Bot，获取 Token
3. 在 OAuth2 → URL Generator 中，选择 `bot` scope，并给 Bot 授予 `Administrator` 权限
4. 使用生成的 URL 邀请 Bot 到你的服务器
5. 在 Cloudflare Pages 添加 `DISCORD_BOT_TOKEN` 和 `DISCORD_CHANNEL_ID`
6. 重新部署

**故障排查（`File not found on Discord`）：**

1. 确认 `DISCORD_WEBHOOK_URL` 指向的频道，Bot 也能访问（频道不一致会导致上传成功但直链失败）。
2. 直接给 Bot 授予 `Administrator` 权限，避免频道权限遗漏导致读取失败。
3. 修改环境变量后必须重新部署 Cloudflare Pages（仅保存变量不会即时生效）。
4. 打开 `/api/status` 检查 Discord 状态是否显示为 `bot`、`webhook` 或 `bot+webhook`。

**限制：**
- 无 Boost 服务器：25MB/文件
- Level 2 Boost：50MB/文件
- Level 3 Boost：100MB/文件

### HuggingFace 存储（可选）

使用 HuggingFace Datasets API 存储文件。文件以 git commit 的形式保存在 Dataset 仓库中。

**环境变量：**

| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `HF_TOKEN` | HuggingFace 写入权限 Token | `hf_xxxxxxxxxxxx` |
| `HF_REPO` | Dataset 仓库 ID | `username/my-filebed` |

**部署步骤：**

1. 注册 [HuggingFace](https://huggingface.co) 账户
2. 创建新的 Dataset 仓库（Settings → New Dataset）
3. 前往 [Settings → Access Tokens](https://huggingface.co/settings/tokens) 创建 Token（需要 Write 权限）
4. 在 Cloudflare Pages 添加 `HF_TOKEN` 和 `HF_REPO` 环境变量
5. 重新部署

**限制：**
- 普通上传（base64）：约 35MB/文件
- LFS 上传：最大 50GB/文件
- 免费用户仓库总大小：约 50GB

### WebDAV 存储（可选）

适合对接 alist/openlist、NAS、群晖、坚果云等支持 WebDAV 的存储服务。  
你可以把 WebDAV 作为统一挂载入口，后台继续按目录管理文件，已生成的 `/file/...` 直链不受目录调整影响。
其中 alist/openlist 建议直接填写其 WebDAV 挂载地址（例如 `https://example.com/dav`），不要填管理后台地址。

**环境变量：**

| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `WEBDAV_BASE_URL` | WebDAV 基础地址（不带结尾 `/`） | `https://dav.example.com/dav` |
| `WEBDAV_USERNAME` | WebDAV 用户名（Basic 认证） | `alice` |
| `WEBDAV_PASSWORD` | WebDAV 密码（Basic 认证） | `your-password` |
| `WEBDAV_BEARER_TOKEN` | Bearer Token（与用户名/密码二选一） | `eyJhbGciOi...` |
| `WEBDAV_TOKEN` | Bearer Token 兼容变量名（可选） | `eyJhbGciOi...` |
| `WEBDAV_ROOT_PATH` | 可选，WebDAV 根目录前缀 | `k-vault/uploads` |

**部署步骤：**

1. 在你的 WebDAV 服务端准备一个可写目录，并确认具备 `PUT/GET/DELETE/MKCOL` 权限。
2. 在 Cloudflare Pages 项目中添加上述 `WEBDAV_*` 变量（认证方式二选一：`用户名+密码` 或 `Bearer Token`）。
3. 重新部署后，访问 `/api/status` 检查 `webdav.connected` 与 `webdav.enabled`，或直接打开 `/webdav.html` 测试上传。
4. Docker 自托管场景下，在 `.env` 填写相同变量后重启容器（`npm run docker:up` 或 `docker compose up -d --build`）。

**常见问题：**

- `Not configured`：通常是 `WEBDAV_BASE_URL` 为空，或认证变量未正确填写。
- `401/403`：认证失败，请检查账号密码或 Token。
- 上传失败且提示 `MKCOL`：说明服务端不允许建目录或路径权限不足，请调整 WebDAV 权限。

### GitHub 存储（可选）

支持将文件存到 GitHub 仓库，提供两种模式：

- `releases`：更适合二进制文件，默认模式
- `contents`：更适合小文件/文本文件（单文件建议不超过 20MB）

**环境变量：**

| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `GITHUB_TOKEN` | GitHub Token（需要仓库写入权限） | `ghp_xxxxxxxxxxxx` |
| `GITHUB_REPO` | 目标仓库（`owner/repo`） | `yourname/kvault-files` |
| `GITHUB_MODE` | 存储模式：`releases` / `contents` | `releases` |
| `GITHUB_PREFIX` | 可选，仓库内路径前缀 | `uploads` |
| `GITHUB_RELEASE_TAG` | 可选，releases 模式固定标签 | `k-vault-storage` |
| `GITHUB_BRANCH` | 可选，contents 模式目标分支 | `main` |
| `GITHUB_API_BASE` | 可选，GitHub API 基址（企业版时可改） | `https://api.github.com` |

**部署步骤：**

1. 准备一个 GitHub 仓库（建议专门用于存储文件）。
2. 在 GitHub `Settings -> Developer settings -> Personal access tokens` 创建 Token（Classic 或 Fine-grained 均可），确保对目标仓库有写权限。
3. 在 Cloudflare Pages 项目中添加 `GITHUB_TOKEN`、`GITHUB_REPO`，可按需补充 `GITHUB_MODE` 等可选变量。
4. 重新部署后，首页会出现 GitHub 存储选项（未连通时为禁用态）。
5. 可访问 `/api/status` 确认 `github.connected` 与 `github.enabled` 状态。

**建议：**

- 大文件优先使用 `releases` 模式。
- 需要目录化管理和频繁覆盖时可使用 `contents` 模式。

---

## 访客上传功能

允许未登录用户上传文件，站长可自行配置是否开启及限制规则。

| 变量名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `GUEST_UPLOAD` | 启用访客上传 | `false` |
| `GUEST_MAX_FILE_SIZE` | 访客单文件最大大小（字节） | `5242880`（5MB） |
| `GUEST_DAILY_LIMIT` | 访客每日上传次数限制（按 IP 计） | `10` |

**启用方式：**

1. 在环境变量中设置 `GUEST_UPLOAD` = `true`
2. 按需调整 `GUEST_MAX_FILE_SIZE` 和 `GUEST_DAILY_LIMIT`
3. 确保已配置 `BASIC_USER` 和 `BASIC_PASS`（否则无访客/管理员区分）
4. 重新部署

**功能说明：**
- 访客可在首页直接上传文件，无需登录
- 访客有单文件大小限制和每日上传次数限制
- 访客不能使用分片上传和高级存储选项（S3/Discord/HuggingFace/GitHub）
- 访客不能访问管理后台和图片浏览页
- 限制基于访客 IP 地址，每日自动重置

---

## 高级配置

| 变量名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `ModerateContentApiKey` | 图片审核 API Key（从 [moderatecontent.com](https://moderatecontent.com) 获取） | - |
| `WhiteList_Mode` | 白名单模式，仅白名单图片可加载 | `false` |
| `USE_R2` | 启用 R2 存储 | `false` |
| `CUSTOM_BOT_API_URL` | Telegram API 基础地址（支持自部署 Bot API） | `https://api.telegram.org` |
| `PUBLIC_BASE_URL` | Webhook 回链时使用的公开域名 | 当前请求域名 |
| `TG_WEBHOOK_SECRET` | Telegram Webhook 密钥（也兼容 `TELEGRAM_WEBHOOK_SECRET`） | - |
| `TELEGRAM_LINK_MODE` | Telegram 链接模式（`signed` 为签名直链） | - |
| `MINIMIZE_KV_WRITES` | 降低 KV 写入（也会启用签名直链） | `false` |
| `TELEGRAM_METADATA_MODE` | Telegram 元数据写入策略（`off` 关闭后台索引写入） | `on` |
| `TG_UPLOAD_NOTIFY` | 网页上传成功后发送“直链+File ID”通知消息 | `true` |
| `FILE_URL_SECRET` | 签名直链密钥（也兼容 `TG_FILE_URL_SECRET`） | `TG_Bot_Token` |
| `CHUNK_BACKEND` | 分片临时存储后端（`auto`/`r2`/`kv`） | `auto` |

### Docker 运行时变量（自托管模式）

| 变量名 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `PORT` | 容器内 API 服务端口 | `8787` |
| `DATA_DIR` | 数据目录 | `/app/data` |
| `DB_PATH` | SQLite 数据库路径 | `/app/data/k-vault.db` |
| `CHUNK_DIR` | 分片临时目录 | `/app/data/chunks` |
| `CONFIG_ENCRYPTION_KEY` | 用于加密存储配置密钥（必填） | - |
| `SESSION_SECRET` | 会话/签名密钥（建议与加密密钥不同） | - |
| `UPLOAD_MAX_SIZE` | 最大上传大小（字节） | `104857600` |
| `UPLOAD_SMALL_FILE_THRESHOLD` | 直传/分片策略阈值（字节） | `20971520` |
| `CHUNK_SIZE` | 分片大小（字节） | `5242880` |
| `DEFAULT_STORAGE_TYPE` | 启动时默认存储类型（`telegram`/`r2`/`s3`/`discord`/`huggingface`/`webdav`/`github`） | `telegram` |
| `SETTINGS_STORE` | 基础设置存储后端（`sqlite` 或 `redis`） | `sqlite` |
| `SETTINGS_REDIS_URL` | Redis URL（Upstash/Redis/KVrocks，`SETTINGS_STORE=redis` 时必填） | - |
| `SETTINGS_REDIS_PREFIX` | Redis 键前缀 | `k-vault` |
| `SETTINGS_REDIS_CONNECT_TIMEOUT_MS` | Redis 连接/心跳超时（毫秒） | `5000` |
| `WEB_PORT` | `docker compose` 对外 Web 端口 | `8080` |

---

## 页面说明

| 页面 | 路径 | 说明 |
| :--- | :--- | :--- |
| 首页/上传 | `/` | 批量上传、拖拽、粘贴上传 |
| WebDAV 独立页 | `/webdav.html` | WebDAV 上传/状态检查/URL 上传 |
| 图片浏览 | `/gallery.html` | 图片网格浏览 |
| 管理后台 | `/admin.html` | 文件管理、黑白名单 |
| 文件预览 | `/preview.html` | 多格式文件预览 |
| 登录页 | `/login.html` | 后台登录 |

---

## 使用限制

**Cloudflare 免费额度：**

- 每日 100,000 次请求
- KV 每日 1,000 次写入、100,000 次读取、1,000 次列出
- 超出后需升级付费计划（$5/月起）
- 建议 Telegram 场景开启签名直链或低 KV 写入模式以降低额度压力
- Docker 自托管模式下，Node 运行时不受 Cloudflare 免费额度限制（受你自己的服务器和存储后端限制）

**各存储后端文件大小限制：**

| 存储后端 | 单文件最大大小 |
| :--- | :--- |
| Telegram（网页直传） | 小文件直传 20MB；分片流程当前上限 100MB |
| Telegram（自部署 Bot API + Telegram 客户端 + Webhook） | 受 Bot API 与部署环境影响，常见可达 2GB |
| Cloudflare R2 | 100MB（分片上传） |
| S3 兼容存储 | 100MB（分片上传） |
| Discord（无 Boost） | 25MB |
| Discord（Level 2+） | 50-100MB |
| HuggingFace | 35MB（普通）/ 50GB（LFS） |

> 说明：`/api/upload-from-url` 当前仍按 20MB 限制处理 Telegram 上传。

---

## 所有环境变量参考

| 变量名 | 说明 | 必需 |
| :--- | :--- | :---: |
| `TG_Bot_Token` | Telegram Bot Token | ✅ |
| `TG_Chat_ID` | Telegram 频道 ID | ✅ |
| `TG_BOT_TOKEN` | Telegram Bot Token（Docker/自托管命名） | 可选 |
| `TG_CHAT_ID` | Telegram 频道 ID（Docker/自托管命名） | 可选 |
| `CUSTOM_BOT_API_URL` | 自部署 Telegram Bot API 地址 | 可选 |
| `PUBLIC_BASE_URL` | Webhook 回链域名 | 可选 |
| `TG_WEBHOOK_SECRET` | Telegram Webhook 密钥 | 可选 |
| `TELEGRAM_WEBHOOK_SECRET` | 同上（兼容变量名） | 可选 |
| `TELEGRAM_LINK_MODE` | Telegram 链接模式（`signed`） | 可选 |
| `MINIMIZE_KV_WRITES` | 降低 KV 写入并启用签名直链 | 可选 |
| `TELEGRAM_METADATA_MODE` | Telegram 元数据写入策略（`off` 关闭后台索引写入） | 可选 |
| `TG_UPLOAD_NOTIFY` | 网页上传成功后发送“直链+File ID”通知消息 | 可选 |
| `FILE_URL_SECRET` | 签名直链密钥 | 可选 |
| `TG_FILE_URL_SECRET` | 同上（兼容变量名） | 可选 |
| `BASIC_USER` | 管理后台用户名 | 可选 |
| `BASIC_PASS` | 管理后台密码 | 可选 |
| `ADMIN_EMAIL` | 管理员邮箱（可用邮箱登录） | 可选 |
| `ALLOW_MEMORY_SESSION` | 允许内存会话存储（仅本地开发） | 可选 |
| `STORAGE_TOTAL_CAPACITY` | 总存储容量（支持 TB/GB/MB/KB/B，默认 114TB） | 可选 |
| `USE_R2` | 启用 R2 存储 | 可选 |
| `CHUNK_BACKEND` | 分片临时存储后端（`auto`/`r2`/`kv`） | 可选 |
| `S3_ENDPOINT` | S3 端点 URL | 可选 |
| `S3_REGION` | S3 区域 | 可选 |
| `S3_ACCESS_KEY_ID` | S3 访问密钥 | 可选 |
| `S3_SECRET_ACCESS_KEY` | S3 秘密密钥 | 可选 |
| `S3_BUCKET` | S3 存储桶名 | 可选 |
| `DISCORD_WEBHOOK_URL` | Discord Webhook URL | 可选 |
| `DISCORD_BOT_TOKEN` | Discord Bot Token | 可选 |
| `DISCORD_CHANNEL_ID` | Discord 频道 ID | 可选 |
| `HF_TOKEN` | HuggingFace Token | 可选 |
| `HF_REPO` | HuggingFace 仓库 ID | 可选 |
| `WEBDAV_BASE_URL` | WebDAV 基础地址 | 可选 |
| `WEBDAV_USERNAME` | WebDAV 用户名（Basic 认证） | 可选 |
| `WEBDAV_PASSWORD` | WebDAV 密码（Basic 认证） | 可选 |
| `WEBDAV_BEARER_TOKEN` | WebDAV Bearer Token（与用户名/密码二选一） | 可选 |
| `WEBDAV_TOKEN` | WebDAV Bearer Token 兼容变量名 | 可选 |
| `WEBDAV_ROOT_PATH` | WebDAV 根目录前缀 | 可选 |
| `GITHUB_TOKEN` | GitHub Token（仓库写权限） | 可选 |
| `GITHUB_REPO` | GitHub 仓库（`owner/repo`） | 可选 |
| `GITHUB_MODE` | GitHub 存储模式（`releases`/`contents`） | 可选 |
| `GITHUB_PREFIX` | GitHub 存储路径前缀 | 可选 |
| `GITHUB_RELEASE_TAG` | GitHub Release 标签（releases 模式） | 可选 |
| `GITHUB_BRANCH` | GitHub 分支（contents 模式） | 可选 |
| `GITHUB_API_BASE` | GitHub API 基址 | 可选 |
| `GUEST_UPLOAD` | 启用访客上传 | 可选 |
| `GUEST_MAX_FILE_SIZE` | 访客文件大小限制（字节） | 可选 |
| `GUEST_DAILY_LIMIT` | 访客每日上传次数 | 可选 |
| `ModerateContentApiKey` | 图片审核 API Key | 可选 |
| `WhiteList_Mode` | 白名单模式 | 可选 |
| `PORT` | Docker 自托管模式 API 端口 | 可选 |
| `DATA_DIR` | Docker 自托管模式数据目录 | 可选 |
| `DB_PATH` | Docker 自托管模式 SQLite 路径 | 可选 |
| `CHUNK_DIR` | Docker 自托管模式分片目录 | 可选 |
| `CONFIG_ENCRYPTION_KEY` | Docker 自托管模式存储配置加密密钥（必填） | 可选 |
| `SESSION_SECRET` | Docker 自托管模式会话/签名密钥 | 可选 |
| `UPLOAD_MAX_SIZE` | Docker 自托管模式最大上传大小（字节） | 可选 |
| `UPLOAD_SMALL_FILE_THRESHOLD` | Docker 自托管模式直传阈值（字节） | 可选 |
| `CHUNK_SIZE` | Docker 自托管模式分片大小（字节） | 可选 |
| `DEFAULT_STORAGE_TYPE` | Docker 自托管模式默认存储类型 | 可选 |
| `SETTINGS_STORE` | Docker 自托管基础设置存储后端（`sqlite`/`redis`） | 可选 |
| `SETTINGS_REDIS_URL` | Docker 自托管 Redis URL（Upstash/Redis/KVrocks） | 可选 |
| `SETTINGS_REDIS_PREFIX` | Docker 自托管设置存储 Redis 键前缀 | 可选 |
| `SETTINGS_REDIS_CONNECT_TIMEOUT_MS` | Docker 自托管 Redis 连接/心跳超时（毫秒） | 可选 |
| `WEB_PORT` | `docker compose` 对外 Web 端口 | 可选 |

---

## API 使用指南

### 1. 创建 API Token

1. 打开管理面板 `/admin.html`
2. 点击工具箱菜单中的 **API Token 管理**
3. 创建 Token 时按需选择权限：`upload` / `read` / `delete` / `paste`，并设置过期时间

### 2. 常用示例

**curl 上传文件：**

```bash
curl -X POST https://your-kvault.com/api/v1/upload \
  -H "Authorization: Bearer kvault_xxxxxxxxxxxx" \
  -F "file=@/path/to/file.png"
```

**curl 上传并设置过期和密码：**

```bash
curl -X POST https://your-kvault.com/api/v1/upload \
  -H "Authorization: Bearer kvault_xxxxxxxxxxxx" \
  -F "file=@backup.tar.gz" \
  -F "expires_in=86400" \
  -F "password=mypassword"
```

**curl 创建文本粘贴：**

```bash
curl -X POST https://your-kvault.com/api/v1/paste \
  -H "Authorization: Bearer kvault_xxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello World","language":"text"}'
```

**Shell 快捷函数（可加入 `.bashrc` / `.zshrc`）：**

```bash
kvault() {
  curl -s -X POST "https://your-kvault.com/api/v1/upload" \
    -H "Authorization: Bearer $KVAULT_TOKEN" \
    -F "file=@$1" | jq -r '.links.share'
}
# 使用: kvault screenshot.png
```

### 3. ShareX 配置

- 目标类型（Destination type）：`Image uploader` / `File uploader`
- 请求地址（Request URL）：`https://your-kvault.com/api/v1/upload`
- 请求头（Headers）：`Authorization: Bearer kvault_xxxxxxxxxxxx`
- 请求体（Body）：`Form data`（`multipart/form-data`）
- 文件字段名（File form name）：`file`
- 返回 URL 路径（URL path）：`$.links.download`（或 `$.links.share`）

### 4. API 端点速查

| 方法 | 端点 | 权限 | 说明 |
| :--- | :--- | :--- | :--- |
| POST | `/api/v1/upload` | `upload` | 上传文件（`multipart/form-data`，字段 `file`） |
| GET | `/api/v1/files` | `read` | 列出文件（支持分页） |
| GET | `/api/v1/file/:id` | `read` | 下载文件 |
| GET | `/api/v1/file/:id/info` | `read` | 获取文件元信息 |
| DELETE | `/api/v1/file/:id` | `delete` | 删除文件 |
| POST | `/api/v1/paste` | `paste` | 创建文本粘贴 |
| GET | `/api/v1/pastes` | `read` | 列出粘贴（支持分页） |
| GET | `/api/v1/paste/:id` | `read` | 获取粘贴内容 |
| DELETE | `/api/v1/paste/:id` | `delete` | 删除粘贴 |

---

## 相关链接

- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [Docker 部署说明](README-DOCKER.md)
- [Docker 镜像工作流](.github/workflows/docker-image.yml)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Bot API Server（自部署）](https://github.com/tdlib/telegram-bot-api)
- [问题反馈](https://github.com/katelya77/K-Vault/issues)

---

## 致谢

本项目参考了以下开源项目：

- [Telegraph-Image](https://github.com/cf-pages/Telegraph-Image) - 原始灵感来源

---

## 许可证与致谢 (License & Credits)

本项目基于 [K-Vault (katelya77)](https://github.com/katelya77/K-Vault) 进行深度重构与二次开发。

- **协议变更说明**：原项目代码（截至提交 `decdb04` 之前）采用 CC0 1.0 Universal 协议。
- **现行协议**：自提交 `decdb04` 起，本项目正式切换至 **MIT 许可证**。

本项目后续的所有新增功能及代码重构均受 **MIT 协议** 保护，使用请保留相关署名及免责声明。

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=katelya77/K-Vault&type=Date)](https://star-history.com/#katelya77/K-Vault&Date)
