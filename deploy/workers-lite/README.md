# 豆包翻译 Lite

单文件 OpenAI Chat Completions 翻译接口，JavaScript 本身不超过 32,000 字节。

本地私有维护仓库：[mxymalay/doubao-translate-local](https://github.com/mxymalay/doubao-translate-local)。本目录保留 Lite 的独立部署文件；私有仓库请使用 Wrangler 或 Cloudflare 已获授权的仓库连接，不使用原作者的公开部署按钮。

## 私有仓库部署

1. 登录 Cloudflare，连接 GitHub 并授权读取私有仓库 `mxymalay/doubao-translate-local`，或使用下方 Wrangler 命令行方式。
2. 连接完整仓库时，项目根目录设为 `deploy/workers-lite`；单独复制此目录使用时，根目录为复制后的仓库根目录。构建命令为 `npm run build`，部署命令为 `npm run deploy`，Node.js 使用 24。
3. 按提示填写两个 Secret：`API_KEY`（至少 16 位，不含空格）和 `DOUBAO_COOKIE`（本人 Cookie Header，含 `sessionid`、`sid_tt`、`uid_tt`）。若页面未收集，部署后在 Worker 设置里按 Secret 类型添加并部署设置。
4. 在沉浸式翻译中填写 `https://你的Worker地址/v1/chat/completions`、同一个 `API_KEY`、模型 `doubao-ai`，关闭流式输出并使用纯文本模板。

```text
Translate to {{to}}:

{{text}}
```

支持独立一行的 `%%` 分隔符。可用 `target_lang` 或 `x-doubao-target-lang` 指定语言，默认中文。不支持 HTML/YAML 模板、任意聊天、其他模型和 Responses/Anthropic 接口。

`GET /health` 仅检查代码运行；真实可用性需用本人 Cookie 请求翻译验证。Secret 未配置时翻译返回 503。HTTP 401/403 不直接判定 Cookie 过期。不要把真实 Cookie 或 API Key 提交到仓库。

## 本地运行

```sh
npm ci
npm run build
```

在此目录创建 `.dev.vars`，按 `.dev.vars.example` 填写凭据，然后执行 `npm run dev`。命令行部署使用 `npm run deploy`，上传 Secret 使用 `npx wrangler secret put API_KEY` 和 `npx wrangler secret put DOUBAO_COOKIE`。

本目录可单独复制使用，不读取父目录文件。`worker.js` 由主项目 `src/workers-lite/index.ts` 生成；维护主项目时执行 `npm run build:workers:lite` 更新它，CI 会检查同步状态。真实云端部署及翻译仍需在自己的账号验收；本次仅保留源码并验证构建。
