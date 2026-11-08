# 豆包文本翻译：Magpie 本地加固版

这是非官方的文本翻译插件，不是通用聊天模型。插件直接接入现有 Magpie，不启动额外服务、不改聊天客户端或路由组。

源码基于 [grimseraph/doubao-translate2api](https://github.com/grimseraph/doubao-translate2api/tree/main/src/magpie) 的提交 `55a23f6`，原 MIT 许可证完整保留；Zod 的许可证随包提供。此版本在 [mxymalay/doubao-translate2api](https://github.com/mxymalay/doubao-translate2api) 维护，不依赖已经删除的作者发布仓库。

请仅使用本人或已获授权的账号。网页接口可能变化，账号及服务条款风险由使用者自行评估。插件不绕过登录、验证码或服务限流。

## 安装与登录

在 Magpie「插件 → 添加插件」中填写 `github:mxymalay/doubao-translate2api#magpie-plugin`，或者运行：

```sh
magpie plugin add github:mxymalay/doubao-translate2api#magpie-plugin
magpie plugin login doubao-translate
```

`magpie-plugin` 分支只包含构建好的插件包，由源码 `main` 分支的 `npm run publish:plugin` 生成。

推荐在 Magpie「供应商 → 豆包文本翻译（本地加固版）→ Sign in with browser (auto)」登录：插件会用独立的浏览器配置（macOS 上为 `~/Library/Application Support/doubao-translate-local/login-profile`，不碰日常 Chrome 配置）打开豆包网页，你在窗口里自己登录后，插件通过仅监听 127.0.0.1 的调试端口读取 `www.doubao.com` 的 Cookie，校验登录状态通过后自动关闭窗口并保存。等待上限 5 分钟。支持 Chrome、Edge、Brave、Chromium，可用环境变量 `DOUBAO_LOGIN_BROWSER` 指定浏览器路径。每次登录都会先清空该独立配置里的豆包 Cookie，所以窗口总是未登录状态，可以登录任意账号（包括「添加另一个账号」）；这不会让已保存在 Magpie 里的账号退出。

也可以用「Import Doubao Cookie」手动导入本人 Cookie Header 或 Cookie JSON，必须包含 `sessionid`、`sid_tt`、`uid_tt`，导入时同样会校验登录状态。未登录时 Magpie 不会把这三个翻译模型加入可调用的网关目录。

不要把 Cookie 发给聊天助手，不要放到源码、`.env` 或命令行参数里。账号信息只通过 Magpie 自己的登录配置保存；权限应为 `0600`。插件本身不写 Cookie 文件，不打印 Cookie、原文、译文或上游错误正文。

Cookie 失效时重新登录或导入；插件只读取你在它打开的独立窗口里亲自登录的豆包 Cookie，不读取日常浏览器的凭据，也不绕过登录或验证码。没有账号时，安装和模型发现不代表翻译已可用。

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

最后一步输出到项目内的 `outputs/doubao-translate-local`。发布新版插件时，在 `main` 上提交后执行：

```sh
npm run publish:plugin
magpie plugin update
```

`publish:plugin` 运行测试、构建插件，并把结果作为新提交推送到 `magpie-plugin` 分支；`magpie plugin update` 让 Magpie 拉取最新版本。

回归测试使用测试账号占位值和模拟上游，不是真实豆包账号验收。真实验收需导入有效 Cookie 后，发送一条明确目标语言的短文及一篇多段长文，检查译文和分隔符；真实未验收时不要宣称账号可用。
