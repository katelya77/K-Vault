# K-Vault 公开部署、安全默认值与 Fork 维护指南

> 本文适用于所有 Fork、Cloudflare Pages 和 Docker 实例。域名、Bot Token、KV/R2 命名空间、管理员口令和访问策略均由**部署者自行配置**，仓库不绑定任何维护者的生产环境。

## 1. 公开仓库不是私钥仓库

- 代码、`.env.example`、`.dev.vars.example`、README、Issue、PR、Actions 日志和截图均视为公开信息。
- 真实 `.env`、`.env.*`、`.dev.vars`、私钥文件、登录 Cookie、Bot Token、Cloudflare API Token、R2/S3 密钥、`kvault_<id>_<secret>` 都不得提交。
- 仓库 CI 调用 `node scripts/check-public-secrets.js` 检查已跟踪的文件。只输出文件路径和行号，不回显可能的 Token。
- 静态扫描只能降低意外提交风险，**不能证明仓库或 Git 历史没有密钥**。如发现泄露，先去服务商撤销并轮换，再评估清理提交历史和已公开的 Fork、缓存。

## 2. 本地启动与生产启动

### Cloudflare Pages 本地开发

运行：

```bash
npm install
npm start
```

第一次 `npm start` 创建忽略跟踪的 `.dev.vars`，写入唯一随机管理员密码，文件仅保存在本机；读取文件中的凭据登录本地管理页面。**不要将 `.dev.vars` 放入版本库，不要在生产环境沿用开发密码。** 已存在的文件不会被自动覆盖；空凭据或典型示例弱密码会导致本地预览启动失败，需手动修正。

如果 Fork 想使用自己的本地变量，直接修改未跟踪的 `.dev.vars`，不要修改 `package.json` 的启动命令或源码常量。

### Docker / Docker Compose

从 `.env.example` 复制的配置不是可直接暴露公网的安全生产配置。必须先设置独立、高强度的 `BASIC_USER` / `BASIC_PASS`，并检查 `GUEST_UPLOAD`、上传大小限制和外部网络入口。

```bash
cp .env.example .env
# 在本地编辑 .env 中的 BASIC_PASS，使用唯一的强随机口令。
docker compose up -d
```

容器生成的 `CONFIG_ENCRYPTION_KEY`、`SESSION_SECRET` 应随持久卷备份和恢复，不要写入 Git。只要旧数据仍需解密，就不要随意更换加密密钥。

**无管理员凭据的示例仅用于可信的隔离本地测试。不要将其直接暴露公网。**

## 3. Cloudflare Pages 的多域名 / 机器 API

如果浏览器页面需要 Bot Fight Mode，但 CI、Agent、Webhook 或程序化上传被挑战，可以按**安全区域（Zone）**区分入口。为一个 Pages 项目添加两个自定义域名，例如：

| 用途 | 示例地址 | 建议策略 |
| --- | --- | --- |
| 人工访问 | `https://files.example.org` | 按需开启页面机器人防护 |
| 受控机器客户端 | `https://api-files.example.net` | 对合法 API 客户端选择合适的 WAF、DDoS、速率限制与应用级鉴权 |

同一 Pages 项目共享原 KV、R2 和 Functions 绑定，不需要复制数据。两个域名也不意味着第二个域名天然安全；确保**公开的管理路由受认证保护**，并且机器 API 每次请求都校验有效的 API Token。

Cloudflare **Free Bot Fight Mode** 不能通过 WAF Skip 规则添加单一路径例外。如果目标 Zone 已启用且自动化请求被挑战，应根据 Security Events 决定是否单独使用受控的 Zone、调整策略或选用支持细粒度例外的产品。不要通过伪造浏览器、开放整个云厂商 ASN、全站跳过 WAF 来解决。

参考：[Cloudflare Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/) 与 [Cloudflare WAF Skip 限制](https://developers.cloudflare.com/waf/custom-rules/skip/)。

## 4. Agent 上传最小权限与双后端验收

为每个 Agent 单独签发 Token，按真实需求赋予 `upload` / `read`、`allowedStorages`、`folderPrefix`、`maxFileSize` 等策略。没有删除需求就不要授予 `delete`。

```bash
export KVAULT_BASE_URL=https://api-files.example.net
# KVAULT_API_TOKEN 应由 CI Secret 注入，不写在仓库或命令中。
curl -sS --fail-with-body \
  -H "Authorization: Bearer ${KVAULT_API_TOKEN}" \
  -F "file=@./original.png;type=image/png" \
  -F "storage=r2" -F "folderPath=blog" \
  "${KVAULT_BASE_URL}/api/v1/upload"
```

完成上传并不等于完成交付。必须再使用返回的公网下载 URL 验证响应码、`Content-Type` 和文件字节。针对每个实际启用的后端（例如 R2、Telegram）分别测试，包含普通 URL、编码 URL、文件 Range 读取与错误 Token 拒绝。

不要把 `GET /api/v1/capabilities` 返回 `storages` 误当成可用性保证：它只报告后端配置，不代表上传后文件一定可读。Cloudflare Pages 和 Docker 之间的逻辑或环境变量别名需要回归测试。

完整接口参考：[Agent 接入指南](agent-integration.md)。

---

**English summary:** K-Vault is a reusable project, not a copy of the maintainer's production account. Never commit `.env`, `.dev.vars`, raw tokens, secrets, or private URLs. Local Pages preview generates unique ignored credentials; Docker public deployments must set strong admin authentication. Scope API tokens to the minimum required storages and folders; verify upload **and** public readback separately for each backend. Free Bot Fight Mode has no path-level WAF Skip exception, so design a suitable API entrypoint instead of spoofing browser traffic.
