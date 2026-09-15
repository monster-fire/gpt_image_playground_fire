<div align="center">

# 🎨 GPT Image Playground

[![GitHub Repo stars](https://img.shields.io/github/stars/CookSleep/gpt_image_playground?style=flat-square&color=eab308)](https://github.com/CookSleep/gpt_image_playground/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/CookSleep/gpt_image_playground?style=flat-square&color=3b82f6)](https://github.com/CookSleep/gpt_image_playground/network/members)
[![License](https://img.shields.io/badge/license-MIT-10b981?style=flat-square)](https://github.com/CookSleep/gpt_image_playground/blob/main/LICENSE)
[![React](https://img.shields.io/badge/React-19-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**基于 OpenAI gpt-image-2.5 API 的图片生成与编辑工具**

提供简洁精美的 Web UI，支持 OpenAI / OpenAI 兼容接口、sub2api（异步）、fal.ai 与可导入的自定义 HTTP 供应商。<br>
当前自部署版本需要通过 NAS / 服务器 Docker 运行，应用密码和私密 API 配置只保存在服务端环境变量与挂载目录中。

<br>

当前版本需要自行部署 Docker 服务端。

</div>

<br>

> 提示：当前版本必须有 Node 服务端，纯静态托管无法提供登录、NAS 配置读写和同源代理接口。

---

## ❤️ 赞助商

<table>
<tr>
<td width="180" align="center" valign="middle">
  <a href="https://moyuu.cc/register?aff=z95r"><img src="https://github.com/user-attachments/assets/b5b14eaa-8f24-41fd-89aa-d681400a3c84" alt="摸鱼 AI" width="150"></a>
</td>
<td valign="middle"><b><a href="https://moyuu.cc/register?aff=z95r">摸鱼 AI</a></b>&nbsp;，让 AI API 接入更简单。明码标价，充值 1:1，支持 GPT、Claude、Gemini 等主流模型，重新定义「便宜 · 稳定 · 高速」</td>
</tr>
<tr>
<td width="180" align="center" valign="middle">
  <a href="https://jucodex.com/register?aff=3JDW"><img src="https://github.com/user-attachments/assets/1980f1ef-d594-457d-b7e4-a0dbff467984" alt="JuCodex" width="150"></a>
</td>
<td valign="middle"><b><a href="https://jucodex.com/register?aff=3JDW">JuCodex</a></b>&nbsp;为企业级用户打造的高可用、低延迟、极致性价比的中转站，提供 Codex、Claude Code、Grok 等主流大模型中转服务，新用户注册送 3 元（QQ 邮箱），永久承诺 0 水 0 替、模型 100% 保真。<a href="https://image.jucodex.com">生图工作台</a></td>
</tr>
<tr>
<td width="180" align="center" valign="middle">
  <a href="https://api.muteki.site/register?aff=CookSleep&promo=CookSleep"><img src="https://github.com/user-attachments/assets/0247d44d-d76b-458b-b8f5-9714ec46e7de" alt="MaruCode" width="150"></a>
</td>
<td valign="middle"><b><a href="https://api.muteki.site/register?aff=CookSleep&promo=CookSleep">MaruCode</a></b>&nbsp;是一家偶尔做做慈善的小破站 API，自营号池，主要提供 Codex、Claude Code、GPT Image 等主流模型，支持 Websocket 协议，明码标价(Codex 0.25x, CC 1.5x)，透明汇率(1:1)，<a href="https://api.muteki.site/register?aff=CookSleep&promo=CookSleep">新用户注册送 2 刀</a>。<a href="https://images-2.muteki.site">生图工作台🖼️</a></td>
</tr>
<tr>
<td width="180" align="center" valign="middle">
  <a href="https://go.apimart.ai/gh-gpt_image_playground"><img src="https://github.com/user-attachments/assets/d38e62e8-55be-4b3b-84cd-b7812c35a228" alt="APIMart" width="150"></a>
</td>
<td valign="middle"><b><a href="https://go.apimart.ai/gh-gpt_image_playground">APIMart</a></b>&nbsp;是专注 AI 图片/视频生成的低价 API 平台，GPT-Image-2 低至 $0.006/张，1 美元可出图 160+ 张。图片、视频一套异步 API 通吃，提交任务拿 ID、回调取结果，跑批万张不超时、换模型不改代码。按量付费、无月费，通过<a href="https://go.apimart.ai/gh-gpt_image_playground">此注册链接</a>注册即可开用。</td>
</tr>
<tr>
<td width="180" align="center" valign="middle">
  <a href="https://9527.codes"><img src="https://github.com/user-attachments/assets/29eba620-e902-42f9-9c3b-2fb2d7b2e310" alt="9527 CODE" width="150"></a>
</td>
<td valign="middle"><b><a href="https://9527.codes">9527 CODE</a></b>&nbsp;是企业级满血 AI 中转服务平台，专注提供 Claude Code、Codex 等主流模型的高稳定中转能力，为企业级 AI 使用提供稳定、合规、高效的一站式解决方案。</td>
</tr>
<tr>
<td width="180" align="center" valign="middle">
  <a href="https://api.sublyx.org/register?aff=U62PAZERCHEA"><img src="https://github.com/user-attachments/assets/828b0b12-f07d-4408-a6d7-627056b81b76" alt="Sublyx" width="150"></a>
</td>
<td valign="middle"><b><a href="https://api.sublyx.org/register?aff=U62PAZERCHEA">Sublyx</a></b>&nbsp;是一家稳定高效的 AI API 聚合网关，支持 OpenAI、Claude、Grok、Codex、gpt-image-2 等主流模型，兼容 OpenAI SDK、Claude Code、Codex、Cherry Studio 等常用工具。通过<a href="https://api.sublyx.org/register?aff=U62PAZERCHEA">链接注册</a>并使用优惠码 <code>IMG2</code>，可额外领取 10 刀额度。<a href="https://img2.icedit.ai">生图工作台</a></td>
</tr>
</table>

---

## 📸 界面预览

<details>
<summary><b>点击展开截图展示</b></summary>
<br>

<div align="center">
  <b>桌面端主界面</b><br>
  <img src="docs/images/example_pc_1.jpg" alt="桌面端主界面" />
</div>

<br>

<div align="center">
  <b>任务详情与实际参数</b><br>
  <img src="docs/images/example_pc_2.jpg" alt="任务详情与实际参数" />
</div>

<br>

<div align="center">
  <b>桌面端批量选择</b><br>
  <img src="docs/images/example_pc_3.jpg" alt="桌面端批量选择" />
</div>

<br>

<div align="center">
  <b>桌面端 Agent 模式</b><br>
  <img src="docs/images/example_pc_4.jpg" alt="桌面端 Agent 模式" />
</div>

<br>

<div align="center">
  <b>移动端主界面</b><br>
  <img src="docs/images/example_mb_1.jpg" alt="移动端主界面" width="420" />
</div>

<br>

<div align="center">
  <b>移动端侧滑多选</b><br>
  <img src="docs/images/example_mb_2.jpg" alt="移动端侧滑多选" width="420" />
</div>

</details>

---

## ✨ 核心特性

### 🎨 强大的图像生成与编辑
- **参考图与遮罩**：支持上传最多 16 张参考图（支持剪贴板和拖拽）。内置可视化遮罩编辑器，自动预处理以符合官方分辨率限制。
- **批量与迭代**：支持单次多图生成；一键将满意结果转为参考图，无缝开启下一轮修改。
- **流式生成预览**：`Images API` 与 `Responses API` 模式均支持流式接收中间步骤图像，缓解连接超时问题。
- **透明背景（API 原生 / 本地后处理双模式）**：画廊模式下选择 PNG 或 WebP 格式后可开启透明背景功能，每个 API 配置可独立选择实现方式（设置入口在 API 配置页）。API 原生模式会直接请求模型返回透明通道（需当前接口和模型支持；fal.ai 暂无对应参数），本地后处理模式则会要求模型使用纯绿色或纯洋红色背景，并在结果返回后于浏览器中去除背景色，按所选 PNG 或 WebP 格式保存透明结果。

  > 本地后处理流程适用于图标、贴纸、单主体素材等场景；若主体边缘存在复杂发丝、半透明材质、强反光或与背景色接近的颜色，可能出现边缘残留或误抠。若使用 API 原生模式时接口返回“不支持透明背景”类错误，应用会提示切换为本地后处理。

### 🤖 Agent 多轮对话模式
- **多轮对话与上下文记忆**：基于 Responses API 的对话式生成，Agent 会理解上下文并按需调用图像工具；支持 `@` 引用参考图或前面轮次生成的图片，并自动识别上下文中的图片。
- **并发批量生成**：内置 `generate_image_batch` 工具，让 Agent 在一次轮次中并发生成多张关联图像，并通过 `continue_generation` 自动追加新一轮以处理依赖关系。
- **分支与重新生成**：编辑某轮消息重新发送或重新生成某轮消息会产生可切换的分支，引用解析严格限定在当前分支路径内，避免误用其他分支的图片。
- **画廊同步与隔离删除**：Agent 生成的图片会同步到画廊；删除对话默认保留画廊记录，删除画廊任务时也会自动清理对话中残留的图片引用。
- **可选 Web 搜索**：可开启 `web_search` 工具，Agent 会在需要时搜索网络信息并附带引用链接。

### ⚙️ 精细化参数追踪
- **智能尺寸控制**：提供 1K/2K/4K 快速预设，自定义宽高时会自动规整至模型安全范围（16 的倍数、总像素校验等）。
- **实际参数对比**：自动提取 API 响应中真实生效的尺寸、质量、耗时以及**模型改写后的提示词**，与你的请求参数高亮对比。支持定制化的参数列表横向平滑滚动体验。

### 📁 高效历史管理与 NAS 配置
- **瀑布流与画廊**：历史任务自动保存，支持按状态过滤、全屏大图预览与快捷下载。
- **多收藏夹管理**：支持创建多个命名收藏夹，同一任务可归入多个收藏夹。提供独立的收藏夹概览视图（展示封面缩略图与任务数量），点击进入具体收藏夹后仍可叠加搜索与状态筛选。收藏夹支持拖拽排序、重命名、设置默认收藏夹，以及按收藏夹为单位批量打包下载 ZIP。
- **快捷批量操作**：桌面端支持鼠标拖拽框选、Ctrl/⌘ 连选，移动端支持顺滑侧滑多选；轻松实现批量收藏与清理。
- **优化的图片查看与下载**：大图预览支持左右滑动切换、移动端长按弹出操作菜单，支持快捷下载与批量下载。
- **私密配置隔离**：Docker 部署会先通过服务端密码登录，再从 NAS 挂载目录读取 API 配置；供应商 Key 不会写入静态 JS 包。浏览器仍会使用本机 IndexedDB 保存画廊、图片缓存与交互状态，支持一键打包导出 ZIP 备份。

### 🔌 多配置与供应商增强
- **多配置管理**：支持创建并保存多个 API 配置（包含供应商、API Key、模型等），按需快速切换；支持一键复制当前配置到列表底部，并通过拖拽对配置列表与供应商列表进行自定义排序。
- **多供应商接入**：内置 OpenAI 兼容接口（含 `Images API` 和 `Responses API`）、sub2api（异步）、fal.ai（支持队列），并支持通过 JSON 导入自定义 HTTP 供应商配置（兼容同步/异步任务）。
- **Agent 模式独立 API 配置**：支持为 Agent 模式使用原生（Response API）或混合（Response API + Image API）的独立 API 配置，解决部分供应商/模型不支持 `image_generation` 工具的问题。
- **API 代理**：OpenAI 兼容接口与 fal.ai 均可配置自定义代理。其中 OpenAI 兼容接口可开启同源 `/api-proxy/` 代理，交由 Docker 或本地开发环境转发至真实 API，绕开浏览器 CORS 限制。
- **Codex CLI 兼容模式**：对上游为 Codex CLI 的 API，开启后应用 Codex CLI 实际支持的参数，并将多图生成拆分为并发单图。
- **提示词防改写**：Responses API 会始终在请求文本前加入强制指令防止提示词被改写；开启 Codex CLI 模式后，Images API 也会获得同等保护。
- **智能诊断提示**：当检测到接口异常改写行为或缺少常规参数时，自动提示开启相应的兼容模式。
- **习惯配置**：支持设置提交后清空输入、重启后保留历史输入、临时复用历史任务 API 配置、关闭提示词防改写等。

---

## 🚀 部署与使用

当前版本必须通过 NAS / 服务器 Docker 或本地 Node 服务端运行。纯静态托管无法提供 `/api/auth/*`、`/api/api-config` 和 `/api-proxy/*`，因此不支持 Vercel、GitHub Pages、Cloudflare Workers 或普通静态 Nginx 作为私密实例。

<a id="preset-config"></a>
### 配置保存方式

登录密码由服务端环境变量 `APP_PASSWORD` 提供。API 配置由服务端读写 `API_CONFIG_PATH`，Docker 默认路径是 `/config/gpt-image-playground.json`。不要使用 `VITE_DEFAULT_API_URL`、`DEFAULT_API_URL` 或远程 JSON 文件把私密配置注入静态包。

登录后在设置页保存供应商配置。保存动作会调用 `/api/api-config`，直接修改 NAS 或宿主机挂载目录中的配置文件。

<a id="docker-deployment"></a>
### Docker / NAS 部署

Docker 是当前推荐部署方式。容器内同时运行 Nginx 与 Node 服务端：Nginx 提供前端页面，Node 提供登录、会话、NAS 配置文件读写和同源 API 代理。生产环境必须设置 `APP_PASSWORD`，否则容器会直接退出。

**环境变量**

| 变量 | 说明 |
|------|------|
| `APP_PASSWORD` | 必填。应用登录密码，只在服务端读取，不会写入静态文件 |
| `APP_ORIGIN` | 浏览器访问本应用的完整源，例如 `http://192.168.0.121:11130`；反向代理或 HTTPS 域名部署时建议显式填写 |
| `COOKIE_SECURE` | HTTPS 部署保持 `true`；内网 HTTP 测试设为 `false`，否则浏览器不会回传安全 Cookie |
| `API_CONFIG_PATH` | API 配置文件路径，默认 `/config/gpt-image-playground.json`；应挂载到 NAS 或宿主机目录 |
| `DATA_DIR` | 服务端运行数据目录，默认 `/data`；应挂载到 NAS 或宿主机目录 |
| `ENABLE_API_PROXY` | 是否开启同源 `/api-proxy/` |
| `API_PROXY_URL` | 代理转发的完整 API 基础地址，例如 `https://api.openai.com/v1` |
| `LOCK_API_PROXY` | 强制锁定代理为开启，用户无法关闭 |
| `HOST` / `PORT` | Nginx 监听地址和宿主机端口，compose 默认映射 `11130:80` |

`/api-proxy/` 会先校验应用登录会话和 CSRF，再转发到上游 API。仍建议只在内网、VPN 或带反向代理访问控制的环境中开放。

**Docker Compose**

仓库提供了 `compose.yaml` 和 `.env.example`。复制 `.env.example` 为 `.env` 后，修改 `APP_PASSWORD`、`APP_ORIGIN`、`API_PROXY_URL`，再启动：

```bash
cp .env.example .env
docker compose up -d --build
```

compose 会把 `./config` 挂载到容器 `/config`，把 `./data` 挂载到容器 `/data`。NAS Docker 面板里可以把这两个宿主路径替换为 NAS 共享目录。API 配置写入 `/config/gpt-image-playground.json`，会话等服务端状态写入 `/data`。

**Docker CLI 示例**

```bash
docker run -d -p 11130:80 \
  -e APP_PASSWORD=change-this-password \
  -e APP_ORIGIN=http://192.168.0.121:11130 \
  -e COOKIE_SECURE=false \
  -e ENABLE_API_PROXY=true \
  -e API_PROXY_URL=https://api.openai.com/v1 \
  -v ./config:/config \
  -v ./data:/data \
  ghcr.io/cooksleep/gpt_image_playground:latest
```

使用 `latest` 标签时，重新拉取镜像并重启即可更新（如 `docker compose pull && docker compose up -d`）。

### 本地开发

本地开发也必须启动 Node 服务端，不能只运行 `npm run dev`。Vite 会把 `/api/` 和 `/api-proxy/` 代理到 `NAS_DEV_SERVER_URL`，默认是 `http://127.0.0.1:3000`。

**1. 准备 .env**

可以直接复制示例文件，再按本机地址修改：

```bash
cp .env.example .env
```

```dotenv
APP_PASSWORD=dev-password
APP_ORIGIN=http://127.0.0.1:5173
COOKIE_SECURE=false
ENABLE_API_PROXY=true
API_PROXY_URL=https://api.openai.com/v1
API_CONFIG_PATH=./config/gpt-image-playground.json
DATA_DIR=./data
NAS_DEV_SERVER_URL=http://127.0.0.1:3000
```

`npm run start` 会通过 Node 的 `--env-file=.env` 读取上述服务端变量。Vite 会通过 `.env` 读取 `NAS_DEV_SERVER_URL`。

**2. 终端一：启动服务端**

```bash
npm install
npm run start
```

**3. 终端二：启动前端开发服务器**

```bash
npm run dev
```

打开 Vite 输出的地址，输入 `APP_PASSWORD` 登录。开发模式下不要使用 `dev-proxy.config.json` 保存真实上游地址；如需同源代理，使用 `API_PROXY_URL` 并在应用设置中开启 API 代理。

**4. 本地故障模拟 API（可选）**

如果需要复现图片 URL 跨域、接口返回结构异常、原始响应查看等问题，可启动内置模拟服务：

```powershell
npm run mock:api
```

使用方式见 [本地故障模拟 API](docs/mock-image-api.md)。

---

<a id="url-quick-fill"></a>
## 🛠️ URL 传参快速填充

通过 URL 查询参数快速填入 OpenAI 兼容配置，适合在当前已登录实例内临时导入设置。不要把包含真实 API Key 的 URL 发到第三方站点或公开页面。

| 参数 | 说明 | 示例 |
|------|------|------|
| `apiUrl` | API Base URL | `?apiUrl=https://api.example.com/v1` |
| `apiKey` | API Key | `?apiKey=sk-xxxx` |
| `model` | 模型 ID | `?model=gpt-image-2.5-sunburst` |
| `imageGenerationModel` | Responses API 的图像生成工具模型，留空使用 API 默认值 | `?imageGenerationModel=gpt-image-2.5-sunburst` |
| `apiMode` | `images` 或 `responses`，默认 `images` | `?apiMode=responses` |
| `profileName` | 配置名称，默认“URL 参数配置” | `?profileName=我的配置` |
| `reasoningEffort` | Responses API 推理强度 | `?reasoningEffort=high` |
| `codexCli` | Codex CLI 兼容模式 | `?codexCli=true` |
| `streamImages` | 流式传输 | `?streamImages=true` |
| `streamPartialImages` | 中间步骤图像数（需配合 streamImages） | `?streamPartialImages=2` |
| `profileId` | 目标配置 ID；匹配到同 ID 配置时直接更新 | `?profileId=my-service` |
| `transparentBackgroundMethod` | 透明背景实现方式：`api`（原生）或 `local`（本地后处理） | `?transparentBackgroundMethod=local` |

示例：

```text
http://你的NAS地址:11130?apiUrl={address}&model={model}
```

<a id="preset-config-json"></a>
## 📋 配置 JSON 格式

使用 JSON 文件或分享链接导入配置时，JSON 对象包含两个顶层字段：

- **`customProviders`**（数组）：自定义供应商定义。如果只使用内置供应商（OpenAI 兼容、sub2api（异步）或 fal.ai），此数组留空 `[]` 即可。
- **`profiles`**（数组）：预置的 API 配置列表。每项对应用户配置页中的一个配置条目。

### 配置列表字段说明（`profiles`）

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 定向更新时填写 | 用于标识配置条目：若后续链接携带相同 ID（查询参数 `profileId`、`settings` 链接或预置配置 JSON 中的 `id`），将直接更新该条目而非新建。应用内普通分享链接会省略此字段。 |
| `name` | 是 | 配置名称，方便用户识别。 |
| `description` | 否 | 配置说明，支持 Markdown；填写后会以说明卡片显示在“当前配置”下方。文本可选中和复制，其中的链接可点击。 |
| `provider` | 是 | 供应商类型。`"openai"` 为 OpenAI 兼容接口，`"sb2api-async"` 为 sub2api（异步），`"fal"` 为 fal.ai，其他值引用 `customProviders` 中具有相同 ID 的供应商定义。 |
| `baseUrl` | 是 | API 基础地址（Base URL）。未以 `/` 结尾时遵循 OpenAI 规则自动补齐 `/v1` 前缀；以 `/` 结尾时直接基于该地址请求接口，不补 `/v1`；fal.ai 可留空。 |
| `apiKey` | 否 | API Key。建议省略，让用户导入后自行填写。 |
| `model` | 是 | 默认模型 ID。 |
| `imageGenerationModel` | 否 | Responses API 的 `image_generation` 工具模型，默认 `gpt-image-2.5-sunburst`；也可使用 `gpt-image-2.5-flare`。留空时不发送工具模型 ID，保持 API 默认值。 |
| `apiMode` | 否 | `"images"` 或 `"responses"`，默认 `"images"`。 |
| `isDefault` | 否 | 有多个配置时，为默认项设置 `true`（只能有一个）；只有一个配置时不填。默认项决定首次使用时自动选中的配置；允许拖动排序和删除（受保护策略控制）。 |
| `timeout` | 否 | 请求超时秒数，默认 600。 |
| `apiProxy` | 否 | 是否走部署端 API 代理，默认 `false`。 |
| `transparentBackgroundMethod` | 否 | 透明背景实现方式：`"api"`（API 原生）或 `"local"`（本地后处理）。OpenAI 兼容配置默认 `"api"`，fal.ai 默认 `"local"`，自定义服务商若生成和编辑请求都映射了 `$params.background` 模板变量则默认 `"api"`，否则默认 `"local"`。 |

### 示例：仅 OpenAI 兼容

```json
{
  "customProviders": [],
  "profiles": [
    {
      "id": "my-openai",
      "name": "我的 OpenAI 配置",
      "description": "使用前请阅读 [接口说明](https://example.com/docs)。",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-image-2.5-sunburst"
    }
  ]
}
```

### 示例：OpenAI 兼容 + sub2api + fal.ai 多配置

```json
{
  "customProviders": [],
  "profiles": [
    {
      "id": "openai-main",
      "name": "OpenAI",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-image-2.5-sunburst",
      "isDefault": true
    },
    {
      "id": "sub2api-profile",
      "name": "sub2api 异步",
      "provider": "sb2api-async",
      "baseUrl": "https://api.example.com/v1",
      "model": "gpt-image-2.5-sunburst"
    },
    {
      "id": "fal-profile",
      "name": "fal.ai",
      "provider": "fal",
      "baseUrl": "",
      "model": "openai/gpt-image-2"
    }
  ]
}
```

### 配置导入与迁移

如需从旧实例或其他环境迁移配置，请在应用设置页使用导入/导出功能。导入后点击保存，服务端会把配置写入 `API_CONFIG_PATH` 指向的 NAS 文件。不要再把配置 JSON 放进 `VITE_DEFAULT_API_URL`、`DEFAULT_API_URL` 或静态托管环境变量。

---

<a id="custom-provider-config"></a>
## 🔌 自定义供应商

当 API 不是标准 OpenAI 格式时，需要在 `customProviders` 中定义请求和响应结构。每个供应商定义必须有唯一的 `id`，然后由 `profiles` 中配置的 `provider` 字段引用。

若自定义供应商的接口不在 `/v1` 路径下，请将配置中的 `baseUrl` 设置为以 `/` 结尾。例如 `baseUrl` 为 `https://api.example.com/` 且 `submit.path` 为 `api/image-tasks` 时，实际请求地址将为 `https://api.example.com/api/image-tasks`；未以 `/` 结尾时则继续按 OpenAI 规范补齐 `/v1`。

**创建方式：**

1. **当前实例中生成**：登录自己的 NAS / Docker 实例，进入 **设置 → API 配置 → 供应商类型 → 创建自定义供应商 → AI 一键生成与导入**，粘贴第三方 API 文档让 AI 生成配置。
2. **应用内导出**：生成完成后，在 **API 配置 → 当前配置** 右侧点击“链接按钮”复制含 `?settings=` 参数的分享 URL，可导入到另一个已登录实例。

也可以参考 [自定义供应商 LLM 提示词](docs/custom-provider-llm-prompt.md)，将提示词和第三方 API 文档直接发给任意 LLM，手动获取完整 JSON。

**完整 JSON 示例（含异步任务供应商定义）：**

```json
{
  "customProviders": [
    {
      "id": "custom-example-task",
      "name": "示例异步任务供应商",
      "submit": {
        "path": "images/generations",
        "method": "POST",
        "contentType": "json",
        "body": {
          "model": "$profile.model",
          "prompt": "$prompt",
          "size": "$params.size",
          "quality": "$params.quality",
          "output_format": "$params.output_format",
          "output_compression": "$params.output_compression",
          "n": "$params.n",
          "image_urls": "$inputImages.dataUrls"
        },
        "taskIdPath": "data.0.task_id"
      },
      "poll": {
        "path": "tasks/{task_id}",
        "method": "GET",
        "intervalSeconds": 5,
        "statusPath": "data.status",
        "successValues": ["completed"],
        "failureValues": ["failed", "cancelled"],
        "errorPath": "data.error.message",
        "result": {
          "imageUrlPaths": ["data.result.images.*.url.*"],
          "b64JsonPaths": []
        }
      }
    }
  ],
  "profiles": [
    {
      "id": "example-profile",
      "name": "示例异步任务供应商",
      "provider": "custom-example-task",
      "baseUrl": "https://api.example.com/v1",
      "model": "gpt-image-2.5-sunburst",
      "apiMode": "images"
    }
  ]
}
```

示例中的 `example-profile` 是唯一配置，因此自动成为默认预置配置。若添加更多配置，需要为其中一项设置 `isDefault: true`。

---

## 💻 技术栈

<div align="center">
  <br>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E" alt="Vite" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind_CSS_3-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS 3" /></a>
  <a href="https://zustand.docs.pmnd.rs/"><img src="https://img.shields.io/badge/Zustand-764ABC?style=for-the-badge&logo=react&logoColor=white" alt="Zustand" /></a>
  <br>
  <br>
</div>

## 📄 许可证 & 致谢

本项目基于 [MIT License](LICENSE) 开源。

特别致谢：[LINUX DO](https://linux.do)

## 💜 赞助支持

<div align="center">

如果这个项目对你有帮助，欢迎通过爱发电赞助支持，你的每一份鼓励都是持续更新的动力！

<br>
<br>

<a href="https://www.ifdian.net/a/cooksleep">
  <img src="https://img.shields.io/badge/%E7%88%B1%E5%8F%91%E7%94%B5-%E8%B5%9E%E5%8A%A9%E4%BD%9C%E8%80%85-946ce6?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyMS4zNWwtMS40NS0xLjMyQzUuNCAxNS4zNiAyIDEyLjI4IDIgOC41IDIgNS40MiA0LjQyIDMgNy41IDNjMS43NCAwIDMuNDEuODEgNC41IDIuMDlDMTMuMDkgMy44MSAxNC43NiAzIDE2LjUgMyAxOS41OCAzIDIyIDUuNDIgMjIgOC41YzAgMy43OC0zLjQgNi44Ni04LjU1IDExLjU0TDEyIDIxLjM1eiIvPjwvc3ZnPg==&logoColor=white" alt="爱发电赞助" />
</a>

<br>
<br>

</div>

## ⭐ Star History

<div align="center">
  <a href="https://www.star-history.com/?repos=CookSleep%2Fgpt_image_playground&type=date&legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=CookSleep/gpt_image_playground&type=date&theme=dark&legend=top-left&sealed_token=YDhR-bhWDaCuWPSxXgtqShoQoM84wroDOtJOM_4TtQsdxIYcQoVPIykb3dHxXo__YPI7b2HlcrMitDbXkJw0dQi68bJOx5xCCqyz8qVdokdcPKMOSbNWOhsDYv6FKKQW40xKkkOqjme8AnR-T9z3i6bq83j47rR6WiNC1n6uVaVf3Ksm8JOf0y9lpXpj" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=CookSleep/gpt_image_playground&type=date&legend=top-left&sealed_token=YDhR-bhWDaCuWPSxXgtqShoQoM84wroDOtJOM_4TtQsdxIYcQoVPIykb3dHxXo__YPI7b2HlcrMitDbXkJw0dQi68bJOx5xCCqyz8qVdokdcPKMOSbNWOhsDYv6FKKQW40xKkkOqjme8AnR-T9z3i6bq83j47rR6WiNC1n6uVaVf3Ksm8JOf0y9lpXpj" />
      <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=CookSleep/gpt_image_playground&type=date&legend=top-left&sealed_token=YDhR-bhWDaCuWPSxXgtqShoQoM84wroDOtJOM_4TtQsdxIYcQoVPIykb3dHxXo__YPI7b2HlcrMitDbXkJw0dQi68bJOx5xCCqyz8qVdokdcPKMOSbNWOhsDYv6FKKQW40xKkkOqjme8AnR-T9z3i6bq83j47rR6WiNC1n6uVaVf3Ksm8JOf0y9lpXpj" />
    </picture>
  </a>
</div>
