# 项目上下文与接手指南

本文供后续编码助手快速恢复项目上下文。它记录已核对的源码结构，不替代 [AGENTS.md](../AGENTS.md) 的工作约定，也不作为线上服务能力的保证。

- 整理日期：2026-09-14。
- 源码基线：`da4fda8`，包版本 `0.7.12`；开始梳理时工作区无未提交修改。
- 依据：本地源码、类型、测试用例、部署配置和现有文档；未访问真实供应商。
- 更新原则：相关模块变更后同步修正本文，以当前源码和实际验证结果为准。优先通过符号名定位，避免依赖易变化的行号。

改造状态见 [NAS 登录、配置与图片收藏执行文档](nas-auth-execution-plan.md)：Docker 模式已实现密码登录、固定 7 天会话和 NAS 配置文件接口；普通画廊、历史和 Agent 对话保存在浏览器。收藏上传 NAS 仍待实施。

2026-09-15 P0 更新：`NasAuthGate` 在加载工作区前验证会话和配置；`nasAuth.ts` 区分 NAS Cookie 与供应商 Key，`nasConfig.ts` 管理 NAS 读写及版本冲突。`server/app.mjs` 使用 Node 内置模块，Docker 同时运行 Node 与 Nginx。重试采用原任务当前有效配置并确认范围，错误诊断分类脱敏，灯箱立即显示加载/缺失/失败状态，NAS 刷新不自动恢复生成。测试与部署参数见 [产品体验文档](product-experience-improvement-plan.md#6-本次交付边界)。下文保留原始结构梳理，涉及这些模块时以本段及当前源码为准。

## 1. 快速认识

GPT Image Playground 是浏览器端图片生成、编辑和历史管理应用。仓库没有自有图片生成业务后端；前端调用用户配置的外部 API，Docker 和开发环境可提供转发代理。

主要使用流程：

- **画廊模式**：输入提示词，上传参考图，可选遮罩，设置生成参数，查看流式预览和生成记录；支持重试、复用配置、结果再编辑。
- **Agent 模式**：Responses API 多轮对话，支持图片引用、图像工具、批量生成、分支、重新生成和停止。生成结果关联画廊任务。
- **历史与素材**：搜索、状态筛选、多收藏夹、批量选择、图片预览、下载、ZIP 备份与导入。
- **供应商设置**：多 API 配置、预置配置、自定义 HTTP 供应商、代理、兼容参数和独立 Agent API 配置。

“本地存储”指应用历史与素材的持久化位置。生成请求仍会向所选供应商发送提示词和所需图片；版本检查也会访问 GitHub。

## 2. 技术栈与目录

[package.json](../package.json) 声明 React 19、Vite 6、TypeScript 5、Zustand 5、Tailwind CSS 3；测试使用 Vitest 4，部分 DOM 测试使用 jsdom。压缩用 `fflate`，fal.ai 接入用 `@fal-ai/client`，Markdown/流式文本使用 `react-markdown`、`streamdown` 等。

| 位置 | 职责 |
| --- | --- |
| [src/main.tsx](../src/main.tsx) | React 挂载、移动端视口保护、Service Worker 注册。 |
| [src/App.tsx](../src/App.tsx) | 启动恢复、预置配置与 URL 参数应用、画廊/Agent 切换、全局弹窗装配。 |
| [src/types.ts](../src/types.ts) | API 配置、任务、图片、Agent 对话和导出格式的共享类型。 |
| [src/store.ts](../src/store.ts) | Zustand 状态和动作；任务执行、恢复、删除、Agent 轮次执行、导入导出编排。 |
| `src/components/` | UI；`input/`、`settings/`、`favorites/` 已有按功能拆分的子模块。 |
| `src/hooks/` | 视口、滚动、选择、提示、版本检查等交互逻辑。 |
| `src/lib/` | API 适配、配置清洗、数据转换、持久化、图片处理等。 |
| [src/index.css](../src/index.css)、[tailwind.config.js](../tailwind.config.js) | 全局样式和 Tailwind 设置。 |
| `public/` | PWA manifest、图标、Service Worker。 |
| `deploy/` | Docker 构建、Nginx、运行时环境变量注入与旧变量迁移。 |
| `scripts/`、`docs/` | 本地故障模拟 API、说明文档、界面截图。 |
| `.github/workflows/` | GitHub Pages、Docker 镜像、Vercel 发布流程。 |

页面视图由 store 中的 `appMode` 等状态决定；`App.tsx` 直接选择组件，没有使用路由库。

## 3. 启动与配置应用顺序

入口：[main.tsx](../src/main.tsx) → [App.tsx](../src/App.tsx) → [store.ts](../src/store.ts) 的 `initStore`。

1. store 创建时，Zustand `persist` 恢复本地配置，经 `migratePersistedState`、`normalizePersistedState` 等处理旧数据。
2. `initStore` 读取 IndexedDB 任务和 Agent 对话，合并旧版对话数据，恢复草稿、收藏关系和图片引用。
3. 对不可恢复的中断任务标记错误；有远端队列 ID 的 fal.ai / 自定义异步任务安排状态查询。
4. 枚举图片 ID 清理孤立图片，并安排缩略图补全，避免启动时读取全部原图。
5. `App` 加载部署预置配置，合并部署变更，应用预置限制，再应用 URL 设置参数。
6. 已应用的 URL 设置参数通过 `history.replaceState` 从地址栏移除。

主要配置模块：

| 文件 | 后续定位重点 |
| --- | --- |
| [apiProfiles.ts](../src/lib/apiProfiles.ts) | `normalizeSettings`、`normalizeApiProfile`、`getActiveApiProfile`、`mergeImportedSettings`、`mergePresetImportedSettings`。 |
| [presetConfig.ts](../src/lib/presetConfig.ts) | 预置 ID、参数锁定、删除限制、仅预置模式。 |
| [defaultApiUrl.ts](../src/lib/defaultApiUrl.ts) | 默认地址及其查询参数解析。 |
| [customProviderConfigUrl.ts](../src/lib/customProviderConfigUrl.ts) | 导入链接、远程/内嵌默认配置读取。 |
| [urlSettings.ts](../src/lib/urlSettings.ts) | 页面 URL 参数转换为应用设置及应用后的清理。 |
| [profileImportUrl.ts](../src/lib/profileImportUrl.ts) | API 配置导入链接生成。 |
| [vite.config.ts](../vite.config.ts) | 构建期 JSON 预置内嵌、版本常量、开发代理。 |

`AppSettings` 保留旧版单配置字段用于兼容，但请求应通过 profile 解析当前配置。预置合并包含部署快照、用户修改、已删除预置记录等语义，不能简单用新默认值覆盖整个设置。

当前代码默认图片模型在 [imageModels.ts](../src/lib/imageModels.ts) 中为 `gpt-image-2.5-sunburst`，默认 Responses 模型在 `apiProfiles.ts` 中为 `gpt-5.6-sol`。这些是仓库常量，不代表已验证任一供应商支持这些模型。

## 4. 画廊图片生成链路

```text
InputBar
  -> submitTask
  -> 创建并保存 TaskRecord
  -> executeTask
  -> callImageApi
       -> falAiImageApi
       -> openaiCompatibleImageApi（含自定义 HTTP 供应商）
  -> 保存输出图片、实际参数、错误/恢复信息
  -> 更新 store 与 IndexedDB
  -> TaskGrid / TaskCard / DetailModal
```

- UI 提交入口：[InputBar.tsx](../src/components/InputBar.tsx)；目前参考图上限常量 `API_MAX_IMAGES = 16`。
- 状态编排：`store.ts` 的 `submitTask`、`executeTask`、`updateTaskInStore`、`retryTask`、`reuseConfig`、`editOutputs`。
- API 总入口：[api.ts](../src/lib/api.ts) 的 `callImageApi`，按 profile 的 provider 分发。
- OpenAI 兼容及自定义 HTTP：[openaiCompatibleImageApi.ts](../src/lib/openaiCompatibleImageApi.ts)。支持 Images / Responses、生成/编辑、流式响应和自定义结果映射；不要把该文件理解成只处理官方接口。
- fal.ai：[falAiImageApi.ts](../src/lib/falAiImageApi.ts)，包含队列提交及结果查询。
- 共用请求/结果结构和图片响应处理：[imageApiShared.ts](../src/lib/imageApiShared.ts)。SSE 解析见 [serverSentEvents.ts](../src/lib/serverSentEvents.ts)。
- URL 拼接与代理：[devProxy.ts](../src/lib/devProxy.ts)。末尾带 `/` 的 base URL 有直接拼接端点的特殊语义，改地址处理前先看测试。

相关图片处理：

| 文件 | 职责 |
| --- | --- |
| [size.ts](../src/lib/size.ts)、[paramCompatibility.ts](../src/lib/paramCompatibility.ts) | 尺寸计算与参数兼容。 |
| [mask.ts](../src/lib/mask.ts)、[maskPreprocess.ts](../src/lib/maskPreprocess.ts) | 遮罩校验、目标图片与工作尺寸处理。 |
| [MaskEditorModal.tsx](../src/components/MaskEditorModal.tsx) | 可视化遮罩编辑。 |
| [transparentImage.ts](../src/lib/transparentImage.ts) | 本地透明背景方案的提示词与去背景色处理。 |
| [taskState.ts](../src/lib/taskState.ts) | 完成/失败状态补丁、中断任务处理、实际参数映射。 |

`TaskRecord` 同时记录请求参数、实际参数和按图片区分的实际参数/改写提示词。并发生成还可能有 `outputErrors`；不能只看 `status === 'done'` 就断言所有输出成功。

fal.ai 的 `falRequestId` / `falEndpoint`，以及自定义异步任务的 `customTaskId` 是恢复依据。普通 HTTP 请求在刷新后不能凭本地 `running` 状态续接原连接。

## 5. Agent 对话链路

入口：[AgentWorkspace.tsx](../src/components/AgentWorkspace.tsx) 展示对话；共用 `InputBar` 调用 `submitAgentMessage`。`store.ts` 的 `executeAgentRound` 编排请求、工具执行、结果落库与后续轮次，`stopAgentResponse` 和 `regenerateAgentAssistantMessage` 处理停止与重新生成。

| 文件 | 职责 |
| --- | --- |
| [agentApi.ts](../src/lib/agentApi.ts) | Responses 请求、工具定义、批量图像调用参数解析、流式回调。 |
| [agentInputBuilder.ts](../src/lib/agentInputBuilder.ts) | 组装请求上下文与历史输入。 |
| [agentConversationState.ts](../src/lib/agentConversationState.ts) | 对话清洗、分支路径、轮次删除及引用变换。 |
| [agentImageReferences.ts](../src/lib/agentImageReferences.ts) | 图像引用解析。 |
| [promptImageMentions.ts](../src/lib/promptImageMentions.ts)、[contentEditableMentions.ts](../src/lib/contentEditableMentions.ts) | 提示词图片提及与可编辑输入框中的引用。 |
| [agentResponseState.ts](../src/lib/agentResponseState.ts) | 响应持久化、上下文恢复、删除后的响应清理。 |
| [responsesOutputState.ts](../src/lib/responsesOutputState.ts) | Responses 输出项规范化。 |
| [agentAssistantBlocks.ts](../src/lib/agentAssistantBlocks.ts) | 助手消息展示块。 |
| [agentWebSearch.ts](../src/lib/agentWebSearch.ts) | Web 搜索相关处理。 |

`AgentConversation` 持有 `rounds` 和 `messages`；轮次通过 `parentRoundId` 形成分支，通过 `activeRoundId` 选择当前路径。上下文和图片引用必须沿当前分支解析。

Agent 独立 API 配置模式为 `off` / `native` / `hybrid`：`off` 表示沿用当前 API 配置，并非关闭 Agent；`native` 使用独立文本配置和 Responses 原生 `image_generation` 工具；`hybrid` 将文本对话与图片 API 配置分开，通过 `generate_image` 调用图片能力。两类工具方案都提供 `generate_image_batch`，并可通过 `continue_generation` 继续处理生成依赖。具体能力由配置解析与工具构建逻辑决定。

Agent 图片任务通过 `agentConversationId`、`agentRoundId`、`agentMessageId` 等关联画廊。删除整个对话、删除某轮/某条助手消息、删除画廊任务是不同操作，不能统一成直接删除关联图片。

## 6. 持久化与图片生命周期

| 层 | 当前实现 |
| --- | --- |
| 内存状态 | Zustand `useStore`；包括 UI 状态、任务列表、草稿、对话。 |
| localStorage | Zustand 默认 `persist` 存储；key 为 `gpt-image-playground`，版本为 `2`。设置、收藏夹、模式和按选项保存的输入草稿等由 `createPersistedState` 挑选。 |
| IndexedDB | [db.ts](../src/lib/db.ts)：数据库 `gpt-image-playground`，`DB_VERSION = 4`，object stores 为 `tasks`、`images`、`thumbnails`、`agentConversations`、`agentContextImages`。 |
| 图片缓存 | [imageCache.ts](../src/lib/imageCache.ts)：原图/缩略图内存缓存、缩略图订阅及补全队列。 |
| 数据清洗与迁移 | [persistedState.ts](../src/lib/persistedState.ts)、[inputDraftState.ts](../src/lib/inputDraftState.ts)、各领域的 `normalize*`。 |

- 原图作为 data URL 存入 IndexedDB。ID 优先用 data URL 的 SHA-256；无 `crypto.subtle` 时有回退 hash。去重与缩略图生成是两件事，不应描述为原图统一压缩。
- 混合模式 Agent 通过 `agentContextImages.ts` 按需压缩上下文图片，并按原图 ID 和压缩版本缓存到 `agentContextImages`。首次发送补齐本次缺失副本；后续轮次和刷新后直接复用，仅新增或过期图片需要处理。查看、下载和图片编辑仍读取原图，副本不进入备份或 NAS 上传。
- `deleteImage` 和 `clearImages` 在同一事务清理原图、缩略图与 Agent 副本。写副本时在同一事务检查原图仍存在且内容匹配，防止删除/替换期间的延迟写入留下孤立缓存；同 ID 原图内容替换会失效副本，元数据更新则保留。调整压缩规则时递增 `CONTEXT_IMAGE_VERSION`。
- `node scripts/test-agent-context-cache.mjs` 使用独立无头 Chrome 测试 IndexedDB 升级、刷新复用、增量压缩、删除/清空、并发删除与延迟写入；默认 Windows Chrome 路径，其他环境可设置 `CHROME_PATH`。不调用模型，也不访问日常浏览器数据。
- 缩略图独立保存，当前版本 `2`，最长边 `720`，WebP 质量 `0.9`。缓存当前限制原图 `8` 项、缩略图 `80` 项，补全并发 `4`。
- 任务主要通过图片 ID 引用图片；输入 UI 使用 `InputImage { id, dataUrl }`。持久化草稿时会去掉图片 data URL，恢复时再按 ID 读取。
- Agent 对话通过 store 订阅写入 IndexedDB；`initStore` 支持将旧 localStorage 对话迁入，并清理旧持久化内容中的大响应数据。
- 删除图片前须检查任务、草稿、对话等引用。相关入口为 `deleteImageIfUnreferenced`、`removeTasks`、`scrubAgentOutputPayloadsForDeletedTasks`；`db.ts` 的 `commitTaskDeletion` 将任务与对话变更放在同一事务。
- 配置包含 `apiKey`。现有持久化没有加密层；启用配置导出的 ZIP 会包含 settings，后续不要将实际密钥写入知识文档或提交。

备份入口在 `store.ts` 的 `exportData` / `importData`，格式处理在 [exportZip.ts](../src/lib/exportZip.ts)。当前 manifest 版本为 `3`，ZIP 中有 `manifest.json`、`images/`、`thumbnails/`，支持分卷及旧格式导入。涉及任务数据的操作需结合 [dataOperations.ts](../src/lib/dataOperations.ts) 检查正在运行或等待恢复的工作。

## 7. 按修改目标找入口

| 修改目标 | 优先阅读 | 对应验证位置 |
| --- | --- | --- |
| 生图参数、供应商兼容 | `types.ts`、`apiProfiles.ts`、`api.ts`、`openaiCompatibleImageApi.ts`、`falAiImageApi.ts` | `api.test.ts`、`apiProfiles.test.ts`、`falAiImageApi.test.ts`、`paramCompatibility.test.ts`。 |
| 任务重试、失败、恢复 | `store.ts`、`taskState.ts` | `store.test.ts`、`taskState.test.ts`。 |
| Agent 上下文、分支、批量图像 | `store.ts`、`agentApi.ts`、`agentInputBuilder.ts`、`agentConversationState.ts`、`agentImageReferences.ts` | `agent*.test.ts` 与 `store.test.ts` 的 Agent 场景。 |
| 设置面板、配置导入与预置 | `components/SettingsModal.tsx`、`components/settings/`、`apiProfiles.ts`、`presetConfig.ts`、`urlSettings.ts` | 对应 lib 同名测试。 |
| 上传、引用、输入草稿 | `components/InputBar.tsx`、`components/input/`、`inputDraftState.ts`、`promptImageMentions.ts` | `inputDraftState.test.ts`、`promptImageMentions.test.ts`、`contentEditableMentions.test.ts`。 |
| 画廊、收藏、筛选与批量操作 | `components/TaskGrid.tsx`、`TaskCard.tsx`、`SearchBar.tsx`、`components/favorites/`、`favoriteState.ts` | `favoriteState.test.ts`、`store.test.ts`；交互另做浏览器验证。 |
| 图片预览与下载 | `components/Lightbox.tsx`、`DetailModal.tsx`、`imageCache.ts`、`downloadImages.ts`、`viewportTransform.ts` | `imageCache.test.ts`、`viewportTransform.test.ts`；下载另做浏览器验证。 |
| 数据迁移、删除、导入导出 | `db.ts`、`persistedState.ts`、`exportZip.ts`、`store.ts` | `persistedState.test.ts`、`exportZip.test.ts`、`store.test.ts`。 |

表内未写前缀的业务模块通常位于 `src/lib/`，核心 `store.ts` / `types.ts` 位于 `src/`，测试与被测模块同目录。

## 8. 开发、验证与部署

使用 npm 与现有 lockfile。命令定义见 [package.json](../package.json)。

```powershell
npm ci
npm run dev
npm run build
npm test
npm test -- src/lib/apiProfiles.test.ts
npm run mock:api
```

- `build` 实际执行 `tsc -b && vite build`，包含 TypeScript 检查。`tsconfig.json` 为严格模式，target 为 ES2020。
- 当前有 `33` 个 `*.test.ts` 文件。store 测试 mock 了数据库等边界，不能代替真实 IndexedDB、浏览器交互或远端 API 验证。
- 仓库未定义独立 lint 脚本；不要将未运行的 lint 写成已通过，也不要为文档任务引入工具配置。
- [本地故障模拟 API](mock-image-api.md) 默认监听 `127.0.0.1:8787`，可复现 CORS、URL 下载失败、异常响应、流式失败、异步轮询等场景。
- 开发代理读取 `dev-proxy.config.json`，模板为 [dev-proxy.config.example.json](../dev-proxy.config.example.json)；实际配置被 gitignore 忽略。

部署入口：

- **静态部署**：Vite 产物为 `dist/`，`base: './'`；Vercel、GitHub Pages、Cloudflare 均有对应配置。Cloudflare 的 `deploy:cf` 会真正发布，不能用于普通本地验证。
- **Docker**：[Dockerfile](../deploy/Dockerfile) 使用 Node 20 构建、Nginx 服务静态资源；[inject-api-url.sh](../deploy/inject-api-url.sh) 将运行时配置注入构建占位符，[nginx.conf](../deploy/nginx.conf) 可启用 `/api-proxy/` 转发。
- **预置配置**：构建变量 `VITE_DEFAULT_API_URL` / Docker 变量 `DEFAULT_API_URL`；限制开关有 `LOCK_PRESET_CONFIG_PARAMS`、`PREVENT_PRESET_CONFIG_DELETION`、`SHOW_PRESET_CONFIG_ONLY`，构建时加 `VITE_` 前缀。细节和格式见 [README.md](../README.md) 与 [配置模板](../gpt-image-config.example.json)。
- **PWA**：生产环境注册 [sw.js](../public/sw.js)，开发环境注销 Service Worker。导航网络优先并回退缓存，应用壳和 assets 使用缓存；跨源请求与非 GET 请求不走其缓存逻辑。
- **版本更新**：[useVersionCheck.ts](../src/hooks/useVersionCheck.ts) 查询上游 `CookSleep/gpt_image_playground` 的最新 Release。Pages/Vercel 发布流程也有上游仓库引用；Fork 调整发布策略时需要检查这些入口。

## 9. 后续修改约定

完整规则以 [AGENTS.md](../AGENTS.md) 为准，尤其注意：

- 遵循现有代码风格：2 空格、单引号、无分号、箭头参数带括号；中文 UI 与中文注释。
- 新纯函数放 `src/lib/`；优先复用现有工具，不在 store 继续堆积可独立的转换逻辑。
- `store.ts`、`InputBar.tsx`、`SettingsModal.tsx`、`AgentWorkspace.tsx` 已是大文件，先按符号定位调用链，再做范围明确的修改。
- 外部 API、导入文件、URL 参数和旧持久化数据需要校验；不能将其清洗逻辑当作冗余代码删除。
- 持久化字段修改同时考虑默认值、normalize、partialize、迁移、导入导出与历史兼容；IndexedDB schema 变更需升级数据库版本。
- 准备发布时先检查全部未推送提交和工作区变更，同步 `package.json`、lockfile 两处版本、Service Worker 缓存版本、`RELEASE.md` 的版本与实际发布日期。
- 修改代码后优先构建，再测试；UI、浏览器存储、真实接口相关变更需要相应的额外验证。

## 10. 本次梳理的验证边界

已核对入口、配置合并、请求分发、数据类型、持久化/恢复、测试布局和部署文件。本文是源码阅读结果，不是完整代码审计或性能评估。

本次只新增项目文档和文档入口，没有修改业务代码。工作区未安装 `node_modules`；未安装依赖、运行构建/测试、启动页面或调用真实生成服务。后续执行代码任务时应建立新的构建、测试与必要的浏览器验证记录，不将本文作为这些检查已通过的证据。
