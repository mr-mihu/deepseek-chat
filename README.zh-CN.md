# chat-demo

[English](README.md) | 简体中文

支持自定义模型厂商的静态聊天示例。没有应用后端：浏览器直接请求你在设置里配置的模型服务。

- 支持 **OpenAI 兼容**（`POST {baseUrl}/chat/completions`）与 **Anthropic 兼容**（`POST {baseUrl}/messages`）两种协议。
- 内置 DeepSeek、OpenAI、DeepSeek（OpenAI 兼容）、硅基流动、阿里云百炼、智谱 GLM、Kimi、OpenRouter、Anthropic、Ollama、LM Studio 预设，也可以完全手填接口地址、模型与请求头。
- 可以同时保存多个厂商，随时切换；每个厂商都能单独配置密钥、模型和额外请求体/请求头。
- 提供 [Docker Compose](#用-docker-compose-运行) 部署，自带一个用于绕开跨域限制的转发代理。

## 用 Docker Compose 运行

需要 Docker 与 Docker Compose（v2）。

```sh
docker compose up -d --build
```

打开 <http://localhost:8080>，在「设置 → 模型服务」里添加厂商即可开始对话。国内网络拉取镜像较慢时，可先给 Docker 配置镜像加速。

### 可选配置

复制 `.env.example` 为 `.env` 后按需修改，改完 `docker compose up -d` 重启生效（不需要重新构建镜像）。

| 变量                  | 默认值        | 说明                                                                                   |
| --------------------- | ------------- | -------------------------------------------------------------------------------------- |
| `WEB_PORT`            | `8080`        | 对外端口                                                                                |
| `CHAT_PROXY_URL`      | `/api/proxy`  | 浏览器把厂商请求发到这个同源地址再转发；留空表示浏览器直连厂商（需要对方允许跨域）      |
| `CHAT_PROXY_TOKEN`    | 空            | 转发代理的校验令牌，公网部署建议设置                                                    |
| `PROXY_ALLOWED_HOSTS` | 空（不限制）  | 只允许转发到这些域名，逗号分隔，如 `api.openai.com,api.siliconflow.cn`                  |
| `CHAT_PROVIDERS`      | `[]`          | 预置厂商（JSON 数组），首次打开时出现在设置里；也可以在页面里手动添加                     |

预置厂商示例：

```json
[
  {
    "name": "硅基流动",
    "protocol": "openai",
    "baseUrl": "https://api.siliconflow.cn/v1",
    "model": "deepseek-ai/DeepSeek-V3",
    "apiKey": "sk-xxx"
  }
]
```

> 密钥只保存在访问者自己的浏览器 localStorage 里。用 `CHAT_PROVIDERS` 预置的密钥会随 `config.js` 下发给浏览器，只适合个人或内网部署。

### 为什么要有转发代理

浏览器直接请求第三方接口时会被 CORS 拦住，而多数模型服务不允许跨域。Compose 里的 `api` 服务接收 `GET|POST /api/proxy?target=<目标地址>`，原样转发请求并把流式响应逐块吐回浏览器（nginx 侧关闭了缓冲，逐字输出不受影响）。如果厂商本身允许跨域，把 `CHAT_PROXY_URL` 设为空即可不用代理。

### 部署到服务器

服务器上**不需要装 Node 或 pnpm**：依赖安装与构建都在容器里完成，只要 Docker 与 Compose v2。

```sh
git clone https://github.com/<你的账号>/deepseek-chat.git
cd deepseek-chat
cp .env.example .env         # 按需改端口、代理、预置厂商
docker compose up -d --build
```

- 首次构建要拉 `node:22-alpine` 与 `nginx:1.27-alpine`，并从 npm 源装依赖，需要外网。国内建议给 Docker 配镜像加速，并在 `.env` 里设 `NPM_REGISTRY=https://registry.npmmirror.com`。
- 更新版本：`git pull && docker compose up -d --build`；改动不大时会命中构建缓存，通常几十秒。
- 状态与日志：`docker compose ps`、`docker compose logs -f web api`；停止：`docker compose down`。
- 内网/离线服务器：在能联网的机器上构建好后导出镜像再导入：

```sh
docker compose build
docker save chat-demo-web:latest chat-demo-proxy:latest | gzip > chat-demo-images.tar.gz
# 拷到服务器
gunzip -c chat-demo-images.tar.gz | docker load
docker compose up -d
```

- 对外建议在前面挂一层 HTTPS 反向代理（Nginx / Caddy 反代到 `127.0.0.1:8080`）；`api` 容器不向宿主机暴露端口，只由 `web` 内部转发。
- 会话与厂商配置都存在访问者浏览器里（localStorage / IndexedDB），服务器端无状态，容器随时可以重建；但也意味着换域名或端口后浏览器的旧数据对不上（origin 变了）。

## 本地运行

准备 Node.js 22.12+ 和 pnpm：

```sh
pnpm install
pnpm dev
```

打开 <http://localhost:8090>。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到任意静态服务器，也可直接打开 `dist/index.html`（直接打开时浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求）。

## 配置模型厂商

「设置 → 模型服务」：

1. 点「添加厂商」，可从预设里选一个（自动填好地址与模型），也可以选「自定义」完全手填。
2. 填 **接口地址**（到版本号为止，如 `https://api.openai.com/v1`）、**模型名称**、**API Key**。
3. 点「测试连接」会请求 `GET {baseUrl}/models` 校验地址与密钥；部分服务没有这个接口，会提示「已连接但无法进一步校验」，不影响使用。
4. 保存后点厂商左侧的圆点选择「使用中」的厂商，之后所有对话都用它。

高级选项里可以补充：

- **额外请求头**：每行一个 `名称: 值`，例如 OpenRouter 需要的 `HTTP-Referer`。
- **额外请求体**：合并进请求体的 JSON，例如 `{"temperature": 0.7}`、`{"reasoning_effort": "high"}`、`{"enable_thinking": true}`。不同厂商的开关字段不一样，用它来适配。

OpenAI 兼容的厂商还可以配语音：填 **朗读模型**（如 `tts-1`）后回复上出现朗读按钮，填 **语音识别模型**（如 `whisper-1`）后输入框出现语音输入；两者都留空就不显示，朗读音色留空默认 `alloy`。中继站（new-api / one-api 等）只要上游有对应的 TTS / STT 通道，同样可以这样配。

### 各协议支持的能力

| 能力                       | OpenAI 兼容            | Anthropic 兼容                               |
| -------------------------- | ---------------------- | -------------------------------------------- |
| 流式对话、停止生成、重新生成 | ✅                     | ✅                                           |
| 深度思考展示                | ✅ 识别 `reasoning_content` / `reasoning` | ✅ 官方 `thinking` 事件              |
| 自动标题                    | 用首条提问截断生成     | 需开启「DeepSeek 专有接口」才由服务端生成      |
| 附件上传                    | ❌                     | 需开启「附件上传（Files API）」                |
| 联网搜索 / 链接阅读          | ❌                     | 需同时开启「DeepSeek 专有接口」与「联网搜索」   |
| 语音输入与朗读               | 填上 TTS / STT 模型后可用（走 `/audio/speech`、`/audio/transcriptions`） | 需开启语音并填写语音接口地址                   |
| 继续生成（续写）             | ❌（接口不支持前缀续写）| ✅                                           |

OpenAI 兼容协议下打开「深度思考」不会发送额外字段，需要厂商侧开关时请用「额外请求体」。

## 对接 New API（一键导入）

[New API](https://github.com/QuantumNous/new-api) 目前只作为 OAuth 客户端登录外部身份源，不提供 OAuth/OIDC 授权服务器（没有 `/authorize` 和 discovery，见 [issue #6572](https://github.com/QuantumNous/new-api/issues/6572)），所以做不到「跳到对方授权页、回来拿令牌」。它给聊天应用准备的官方方式是「聊天预设一键导入」：Root 配一条带占位符的链接，用户点一下就带着自己的令牌跳到目标应用。

chat-demo 支持这种链接，参数为 `newapi`（new-api 服务地址）和 `key`（API 密钥）：

```json
{ "chat-demo": "http://your-chat-demo:8080/?newapi={address}&key={key}" }
```

把这行加到 new-api 的 `系统设置 → 控制台内容 → 聊天`（Root 权限）即可，用户可以从左侧栏「聊天」或「API 密钥」行末的 `⋯ → 聊天 → chat-demo` 点进来。

打开后的行为：

- 自动创建并启用一个「New API」厂商，接口地址取 `{address}/v1`（已有同地址配置时就地更新密钥，不会重复添加）；
- 用这个密钥请求 `/v1/models`，把第一个模型作为默认模型；
- 拉不到模型列表（密钥无效、地址不通）时仍会保存配置并跳到「设置 → 模型服务」，让你确认模型和密钥；
- 地址栏里的参数会被立刻清掉；但令牌在此之前已经出现在地址栏与浏览器历史里，内网或个人使用没问题，公用机器上建议改用「手动配置」。

回环地址（`localhost` / `127.0.0.1`）会自动直连、不经过 Docker 里的转发代理——容器内的 `127.0.0.1` 并不是你电脑的 `127.0.0.1`。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。
- 自定义模型厂商：多套配置、连接测试、预设与高级参数。

## 数据

厂商配置（含 API Key）和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的模型服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含厂商配置、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。厂商配置和其他设置保留，已上传到模型服务的文件不受影响。

## 开发

| 命令            | 用途                  |
| --------------- | --------------------- |
| `pnpm dev`      | 启动开发服务器        |
| `pnpm build`    | 构建到 `dist/`        |
| `pnpm type`     | TypeScript 类型检查   |
| `pnpm lint`     | oxlint 检查           |
| `pnpm format`   | oxfmt 格式化          |
| `pnpm docker:up`| 构建并启动容器        |

[rspack.config.ts](rspack.config.ts) 的 `createConfig({ apiOrigin, devServer })` 决定「DeepSeek」预设的默认地址，默认 `https://api.deepseek.com`；运行时真正用哪个厂商由设置决定。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               厂商配置、两种协议的请求与 SSE、协议类型
      providers.ts     厂商配置、预设、能力开关、请求地址与鉴权头
      client.ts        统一的流式对话入口（按协议分发）
      anthropic.ts     Anthropic 兼容协议
      openai.ts        OpenAI 兼容协议（增量翻译成内部事件）
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
deploy/                nginx 配置、运行时配置脚本、转发代理
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
