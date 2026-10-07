# 豆包文本翻译：Magpie 本地加固版

这是非官方的文本翻译插件，不是通用聊天模型。插件直接接入现有 Magpie，不启动额外服务、不改聊天客户端或路由组。

源码基于 [grimseraph/doubao-translate2api](https://github.com/grimseraph/doubao-translate2api/tree/main/src/magpie) 的提交 `55a23f6`，原 MIT 许可证完整保留；Zod 的许可证随包提供。此版本在本机维护，不依赖已经删除的作者发布仓库，也不会从该仓库自动更新。

请仅使用本人或已获授权的账号。网页接口可能变化，账号及服务条款风险由使用者自行评估。插件不绕过登录、验证码或服务限流。

## 安装与登录

在 Magpie「插件 → 添加插件」中填写这个已构建插件目录的绝对路径，或者运行：

```sh
magpie plugin add /绝对路径/doubao-translate-local
magpie plugin login doubao-translate
```

本机安装时已经完成第一步，运行包位于 `/Users/xy/.config/magpie/plugins/local-doubao-translate`。源码位于 `/Users/xy/Projects/doubao-translate-local`，可分发包输出到该项目的 `outputs/`。不要把运行插件指向 Documents 下的临时工作目录：本机后台 Magpie 服务加载该目录曾报找不到入口，改用应用自己的插件目录后已验证加载成功。

请在 Magpie「供应商 → 豆包文本翻译（本地加固版）→ Import Doubao Cookie」导入本人 Cookie Header 或 Cookie JSON。必须包含 `sessionid`、`sid_tt`、`uid_tt`，导入时会校验登录状态。未登录时 Magpie 不会把这三个翻译模型加入可调用的网关目录。

不要把 Cookie 发给聊天助手，不要放到源码、`.env` 或命令行参数里。账号信息只通过 Magpie 自己的登录配置保存；权限应为 `0600`。插件本身不写 Cookie 文件，不打印 Cookie、原文、译文或上游错误正文。

Cookie 失效时重新导入；不会自动抓取浏览器凭据或绕过登录。没有账号时，安装和模型发现不代表翻译已可用。

## 使用

现有 Magpie 网关地址仍是 `http://127.0.0.1:3425/v1`。在翻译工具中显式选择以下模型，不要加入聊天自动路由或故障切换组：

- `doubao-translate/doubao-ai`：豆包 AI 翻译。
- `doubao-translate/volcengine-translate`：火山翻译。
- `doubao-translate/microsoft-translator`：微软翻译。

三个引擎都通过豆包网页翻译接口调用，不是对应厂商的官方 API。

默认译为简体中文。可以用 `target_lang`、`X-Doubao-Target-Lang` 或明确的系统翻译指令指定目标语言：

```json
{
  "model": "doubao-translate/doubao-ai",
  "target_lang": "zh",
  "messages": [{"role": "user", "content": "The meeting starts at nine.\n\n%%\n\nPlease bring your notes."}],
  "stream": false
}
```

只翻译最后一条用户文本；不支持图片、工具、对话记忆、推理或结构化输出。长文本按最多 50 段、每批最多 10,000 个 UTF-16 单元分批，长段再切分，并按原顺序还原换行。独立一行的 `%%` 及周围换行作为段落分隔符保留，不发给翻译接口。全部批次成功后才返回完整结果，失败时不把半截译文冒充成功。

`stream: true` 在完整翻译完成后返回兼容 SSE，不是逐 token 实时翻译。模型显示的 32,000 token 预算只是网关预算，不是上游额度承诺；token usage 为 0，不能据此推算真实用量。

## 资源限制与错误

| 参数 | 默认值 | 可配置上限 |
| --- | --- | --- |
| `maxConcurrency` | 2 | 4 |
| `queueMax` | 8 | 32 |
| `queueTimeoutMs` | 8,000 ms | 30,000 ms |
| `requestTimeoutMs` | 30,000 ms | 60,000 ms |
| `totalTimeoutMs` | 120,000 ms | 180,000 ms |
| `authTimeoutMs` | 10,000 ms | 15,000 ms |
| `maxRetries` | 0 | 2 |

总翻译超时包含排队、分批和重试；从 Magpie 读取账号凭据另外受 `authTimeoutMs` 约束。上游响应头、流读取和 Cookie 校验的等待都独立响应取消。清理流采用尽力取消，不能因为取消钩子卡住而占住翻译槽位。

超时后才到达的响应也会尝试取消。若宿主完全忽略取消且一直不返回，插件能结束自身等待，但无法强行终止宿主内部的网络工作；并发上限约束的是插件持有的翻译槽位。

- 登录缺失或失效：401；真实失效才标记 `X-Magpie-Sign-In: expired`。
- 限流或队列满：429；排队超时：503。
- 请求、总翻译或凭据读取超时：504。
- 空译文、缺少段落或上游错误：明确错误，不返回空的 200 成功。

网络故障不会被标为登录过期；默认不重试，不使用其他聊天模型兜底。

## 本地维护

在源码目录使用 Node.js 24 或更新版本：

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
npm run build:plugin:local
```

项目源码位于 `/Users/xy/Projects/doubao-translate-local`，私有维护仓库是 [mxymalay/doubao-translate-local](https://github.com/mxymalay/doubao-translate-local)。最后一步输出到项目内的 `outputs/doubao-translate-local`，不依赖原来的 Codex 任务目录。需要更新本机运行包时，在源码目录另外执行：

```sh
node scripts/build-plugin.mjs /Users/xy/.config/magpie/plugins/local-doubao-translate
```

Magpie 不监听本地源码文件修改；重建后仅关闭再开启这个插件，让宿主加载新代码，勿执行会更新所有插件的命令。

回归测试使用测试账号占位值和模拟上游，不是真实豆包账号验收。真实验收需导入有效 Cookie 后，发送一条明确目标语言的短文及一篇多段长文，检查译文和分隔符；真实未验收时不要宣称账号可用。
