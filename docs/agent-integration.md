# K-Vault Agent 接入指南（API Token / MCP Tools）

面向机器客户端 —— MCP Agent、GitHub Actions、Coze Workflow、ShareX、自动化脚本 —— 的 K-Vault 图床接入说明。机器可读接口定义见 [openapi.yaml](./openapi.yaml)。

所有示例中的 `https://your-kvault-domain` 替换为你的部署地址；`$KVAULT_API_TOKEN` 为 Token 明文（形如 `kvault_<id>_<secret>`），仅创建/轮换时返回一次，切勿写入仓库、日志或截图。

## 1. 准备 Token

### 方式 A：管理后台

登录 → 「API Token 管理」→ 新建：填写名称、勾选 scopes、可选过期时间与策略（allowedStorages / folderPrefix / maxFileSize，界面按 MB 填写大小）。明文仅创建时展示一次。

### 方式 B：Admin API（Basic 认证）

```bash
curl -X POST "https://your-kvault-domain/api/admin/tokens" \
  -u "$BASIC_USER:$BASIC_PASS" \
  -H "Content-Type: application/json" \
  -d '{"name":"blog-bot","scopes":["upload","read"],"expiresAtMs":1790000000000,"policies":{"folderPrefix":"blog"}}'
```

> 未配置 `BASIC_USER` / `BASIC_PASS` 时 admin API 整体 fail-closed，返回 503 `ADMIN_AUTH_NOT_CONFIGURED`。

### Scopes

| Scope | 能力 |
| --- | --- |
| `upload` | `POST /api/v1/upload`、`POST /api/v1/import` |
| `read` | `GET /api/v1/files`、`GET /api/v1/file/:id`、`GET /api/v1/file/:id/info` |
| `delete` | `DELETE /api/v1/file/:id` |
| `paste` | Paste 相关端点 |

### 策略（policies，可选）

创建/更新时传入，服务端对每次请求强制执行：

| 字段 | 说明 | 违规返回 |
| --- | --- | --- |
| `allowedStorages` | 限定存储后端（telegram / r2 / s3 / discord / huggingface / webdav / github） | 403 `POLICY_DENIED` |
| `folderPrefix` | 限定目录前缀 | 403 `POLICY_DENIED` |
| `maxFileSize` | 单文件字节上限（管理界面按 MB 输入，自动换算） | 413 `POLICY_FILE_TOO_LARGE` |

## 2. 鉴权与通用约定

- 除 `GET /api/v1/capabilities` 外，所有 v1 端点需要 `Authorization: Bearer $KVAULT_API_TOKEN`。
- 成功响应：`{"success": true, ...}`；失败：`{"success": false, "error": {"code": "...", "message": "...", "detail": "..."}}`。
- 常见错误码：
  - 401 `TOKEN_MISSING` / `TOKEN_INVALID` / `TOKEN_EXPIRED` / `TOKEN_DISABLED`
  - 403 `SCOPE_REQUIRED` / `POLICY_DENIED`
  - 413 `FILE_TOO_LARGE` / `POLICY_FILE_TOO_LARGE`
  - 触发令牌级限流返回 429
- 幂等：请求头 `Idempotency-Key`（≤200 字符）。同一 Token + 同一 Key 在 24 小时内重放首次成功响应，响应头带 `Idempotency-Replayed: true`。上传与导入均支持。

## 3. MCP Tools 对照表（7 个）

| Tool | HTTP | 说明 |
| --- | --- | --- |
| `kvault_health` | GET /api/v1/capabilities | 存活/就绪探测（200 且 `data.apiVersion` 存在即健康） |
| `kvault_capabilities` | GET /api/v1/capabilities | 能力清单：可用存储后端、大小上限、图片类型 |
| `kvault_token_info` | GET /api/v1/me | 当前 Token 的 scopes / policies / 用量 |
| `kvault_upload_file` | POST /api/v1/upload | multipart 文件上传 |
| `kvault_import_url` | POST /api/v1/import | 远程 URL 导入（内置 SSRF 防护） |
| `kvault_list_files` | GET /api/v1/files | 游标分页列表 |
| `kvault_get_file` | GET /api/v1/file/:id/info；GET /api/v1/file/:id | 元信息 JSON / 字节流（支持 Range） |

### 3.1 kvault_health / kvault_capabilities

```bash
curl "https://your-kvault-domain/api/v1/capabilities"
```

```json
{"success":true,"data":{"apiVersion":"v1","upload":true,"importFromUrl":true,"maxUploadSize":104857600,"storages":["telegram","r2"],"imageTypes":["image/jpeg","image/png","image/webp","image/avif","image/gif","image/bmp"]}}
```

`storages` 仅列出已配置可用的后端。

### 3.2 kvault_token_info

```bash
curl -H "Authorization: Bearer $KVAULT_API_TOKEN" "https://your-kvault-domain/api/v1/me"
```

返回 `data.token`：`id / name / scopes / expiresAt / enabled / policies / createdAt / lastUsedAt / usageCount`。适合 Agent 启动时自检凭据权限。

### 3.3 kvault_upload_file

| 参数 | 位置 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | form-data | 是 | 文件本体 |
| `storage` | form-data | 否 | telegram / r2 / s3 / discord / huggingface / webdav / github，缺省用默认存储 |
| `folderPath` | form-data | 否 | 目录前缀 |
| `slug` | form-data | 否 | 自定义分享 slug（冲突返回 409 `SLUG_CONFLICT`） |
| `expires_in` | form-data | 否 | 分享链接有效秒数 |
| `max_downloads` | form-data | 否 | 分享下载次数上限 |
| `password` | form-data | 否 | 分享密码 |

```bash
curl -X POST "https://your-kvault-domain/api/v1/upload" \
  -H "Authorization: Bearer $KVAULT_API_TOKEN" \
  -H "Idempotency-Key: post-42-cover" \
  -F "file=@./cover.png" -F "storage=r2" -F "folderPath=blog/2026"
```

成功：`{"success":true,"file":{"id":"...","name":"cover.png",...},"links":{"download":"...","share":"...","delete":"..."}}`。≤25MB 的重复内容上传会命中 SHA-256 去重索引，响应附加 `"deduplicated": true` 并返回已有文件。

创建受密码保护的链接时，在上传表单中添加 `password`，把 `links.share` 和密码分开提供给接收者。需要短路径时可以同时填写 `slug`。Cloudflare Pages 的签名 Telegram 上传在关闭元数据时无法保存这些分享选项。

### 3.4 kvault_import_url

| 参数 | 位置 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | JSON | 是 | 远程地址 |
| `storage` | JSON | 否 | 同上传 |
| `folder` | JSON | 否 | 目录前缀 |
| `deduplicate` | JSON | 否 | 默认 `true`，设为 `false` 跳过去重 |

```bash
curl -X POST "https://your-kvault-domain/api/v1/import" \
  -H "Authorization: Bearer $KVAULT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: agent-run-20260903-1" \
  -d '{"url":"https://cdn.example.com/cover.jpg","storage":"r2","folder":"agent"}'
```

返回 `data.file`（含 `sha256`）、`data.links.download / share`、`data.source.url`、`data.deduplicated`。

SSRF 防护：仅允许 http/https；端口白名单 80 / 443 / 8080 / 8443；内网、环回、链路本地、CGNAT、云厂商 metadata 主机与字面 IP 一律拒绝（Docker 侧对每个 DNS 解析结果复检）；每一跳重定向都重新校验。

### 3.5 kvault_list_files

```bash
curl -H "Authorization: Bearer $KVAULT_API_TOKEN" \
  "https://your-kvault-domain/api/v1/files?limit=50&storage=r2&search=cover"
```

可选 query：`limit`（默认 50，最大 200）、`cursor`、`storage`、`search`、`listType`、`folderPath`。返回 `files[]` 与 `pagination{cursor, listComplete, pageCount, total}`；下一页传 `cursor=<pagination.cursor>`。

### 3.6 kvault_get_file

```bash
# 元信息（JSON，含原始字段 raw）
curl -H "Authorization: Bearer $KVAULT_API_TOKEN" "https://your-kvault-domain/api/v1/file/<id>/info"

# 字节流（支持 Range，受分享密码保护约束）
curl -H "Authorization: Bearer $KVAULT_API_TOKEN" "https://your-kvault-domain/api/v1/file/<id>"
```

## 4. 其他端点

- `POST /api/v1/paste`（scope: `paste`）：`{"content":"...","language":"text","expires_in":86400,"password":""}` → 201 + `paste{id, language, createdAt, expiresAt, hasPassword}` 与 `links.view / links.raw`。
- `GET /api/v1/pastes`：分页列表。
- `DELETE /api/v1/file/:id`（scope: `delete`）：删除文件。

## 5. 安全须知（Agent 开发者）

1. Token 明文只在创建/轮换时返回一次，服务端只存哈希；疑似泄露立即 rotate，旧密钥即刻失效。
2. 禁用的 Token 立即失效，且不能被任何遥测写入"复活"（用量统计与凭据分离存储，60 秒防抖）。
3. 上传默认拒绝 SVG；URL 导入仅 http(s) + 端口白名单。
4. 为 Agent 配最小权限：推荐 `upload` scope + `folderPrefix` 策略。
5. 浏览器前端直连需配置 `API_CORS_ORIGINS` 白名单；纯服务端调用无需 CORS。
