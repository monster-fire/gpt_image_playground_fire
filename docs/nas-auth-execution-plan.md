# NAS 登录、配置与图片收藏执行文档

状态：实施计划，业务代码尚未修改。更新日期：2026-09-14。

源码基线：`da4fda8` / `0.7.12`。本文件作为后续执行的需求与验收依据；现状见 [项目上下文](project-context.md)。

## 1. 确定的存储边界

应用运行于 NAS Docker，使用服务端环境变量密码登录。按以下边界实现：

| 数据 | 权威存储与行为 |
| --- | --- |
| 普通生成原图、缩略图、流式中间图 | 当前浏览器 IndexedDB/内存，沿用相应生命周期。 |
| 普通画廊、任务历史、Agent 对话/分支/消息 | 当前浏览器 IndexedDB。 |
| 输入草稿、普通生成参数、界面偏好 | 浏览器现有本地存储。 |
| 收藏图片原图、对应提示词、收藏夹 | NAS；用户选择收藏后上传，服务端提交成功才显示已收藏。 |
| API profiles、自定义供应商、API Key、默认与 Agent API 配置选择、预置策略状态 | NAS 的 `config/gpt-image-playground.json`；登录后通过接口读取，增删改直接写回该文件。 |
| 登录密码 | 仅服务端运行时环境变量 `APP_PASSWORD`。 |

正常生成、浏览普通画廊和对话不触发图片上传。Agent 和画廊引用同一份本地图片。跨设备共享 NAS 收藏和 API 配置，各设备的普通画廊、对话保持独立。清除浏览器数据会丢失未收藏图片和本地记录，NAS 收藏与配置仍保留。

生成由浏览器执行，刷新或关闭即断开；重新打开不自动续跑。已保存的本地结果保留。供应商已经受理的远端任务是否取消不由应用保证。

## 2. 已核对的入口

| 源码位置 | 当前事实与实施影响 |
| --- | --- |
| `src/lib/db.ts` / `openDB` | IndexedDB 已保存任务、图片、缩略图和 Agent 对话；这些本地路径保留。 |
| `src/lib/persistedState.ts:92` / `createPersistedState` | 当前把整个 settings 持久化；必须剔除所有 NAS API 配置与密钥，并同步修改 merge/migrate。 |
| `src/store.ts:591` / `setSettings` | 当前同步修改本地设置；API 配置改为异步服务端写入，普通浏览器偏好继续本地保存。 |
| `src/App.tsx:66` | 当前启动即初始化和应用预置；改为认证后读取 NAS API 配置，再开放生成操作。 |
| `src/components/SettingsModal.tsx:412,895` | commitSettings/deleteProfile 当前提交整份设置；改为单项 API 配置操作，失败可见。 |
| `src/lib/apiProfiles.ts` / `normalizeSettings`、`mergePresetImportedSettings` | 旧单配置兼容、providerDrafts、默认/Agent 选择与预置状态都需纳入配置边界，避免旧本地配置回填。 |
| `src/store.ts:3760` / `updateTasksFavoriteCollections` | 当前按任务收藏，多图任务一起处理；新增图片级选择和 NAS 收藏映射。 |
| `src/components/TaskCard.tsx`、`src/lib/favoriteState.ts` | 当前任务级收藏按钮与旧收藏标记需兼容；只有实际上传成功的图片显示 NAS 已收藏。 |
| `src/types.ts` / `TaskRecord` | 包含 prompt、revisedPromptByImage，可生成每张收藏的提示词快照。 |
| `src/components/AgentWorkspace.tsx:394`、`src/store.ts` / `removeTasks` | 删除对话/任务及其本地图片继续在浏览器执行，独立 NAS 收藏不因本地清理丢失。 |
| `src/store.ts` / `initStore`、`isNetworkRecoverableError` | 当前有异步任务恢复且 AbortError 被当作可恢复错误；刷新/退出取消须停用相应恢复路径。 |
| `deploy/Dockerfile`、`deploy/nginx.conf` | 当前只有静态运行服务；新增登录、配置和收藏数据服务及 NAS 数据卷。 |
| `deploy/inject-api-url.sh`、`vite.config.ts` | 当前将 JSON 预置内容读入并内嵌前端；NAS 配置改为由后端实时读取文件，停止将其内容注入公开静态文件。 |

符号为稳定定位依据，行号是本次阅读时的位置。后续接口和目录均为拟实施设计。

## 3. API 配置读取与修改

- API 配置的唯一权威文件为用户 NAS 上的 `config/gpt-image-playground.json`。新增配置客户端接口模块和服务端文件读写模块；登录成功通过 API 读取该文件中的 profiles、customProviders、默认项、Agent 配置和预置限制，组装内存中的运行设置。
- 明确拆分“NAS API 配置”与“本地偏好”，使用字段白名单；不要继续把完整 AppSettings 放入 localStorage。旧顶层 baseUrl/apiKey/model、profiles 中密钥、providerDrafts、previousPresetConfig、Agent profile ID 等兼容字段一并检查。
- 密钥可由单独鉴权接口按使用时读取，仅留当前会话内存。生成仍在浏览器，所以已登录浏览器能够取得供应商 API Key；登录密码始终只由服务端读取。
- 配置创建、编辑、删除带 revision/幂等操作 ID；服务端确认后更新内存。401 回登录，409 重新读取并提示冲突，NAS 不可用时阻止配置操作和使用过期配置开始新生成。
- 生成提交前获取/校验所选 profile 的最新版本。正在运行的请求使用提交时快照；配置后续删除无法撤销已发出的请求，后续生成/重试必须重新选取有效配置。
- API 配置页面保存失败保留编辑草稿，不能显示保存成功。不同设备更改后，在进入设置/切回页面/提交生成时更新配置。
- 删除配置直接移除 JSON 中的配置和密钥，同次写入调整默认与 Agent 选择；本地历史保留生成时名称、模型等非密钥信息。允许最后一项删除并进入“未配置 API”，需要调整 normalizeSettings/getActiveApiProfile 调用方的空配置处理。
- 该文件作为运行配置直接读取；启动和重开页面不向其中重新播种已删除项。预置策略及其必要状态与 API 配置一起保存，显式锁定策略由服务端执行。
- URL 配置导入、JSON 导入、复制配置、复制导入链接、ZIP 导入均经过同一服务端配置入口。不得从 URL 参数静默建立仅本地有效的配置。
- 退出或会话失效清空内存配置/密钥，保留本地历史和图片；旧密钥持久化残留按迁移步骤清理。

### JSON 文件写入契约

1. 实施前核对 NAS 实际文件结构，兼容现有 profiles/customProviders 和字段命名。使用结构化 JSON 解析，保留不属于本次修改的合法扩展字段；新增默认选择、Agent 设置或 schema 元数据时制定兼容规则。
2. 配置请求在单服务实例内串行处理，采用整份配置 revision/ETag。写入前重新读取文件并校验请求版本，再应用单项修改，避免两个设备相互覆盖。版本可由实际文件内容计算，使手动编辑也能被后续读取识别。
3. 在同一配置目录写临时文件，完成校验、写入及 flush 后通过 rename 原子替换目标文件；在目标 NAS 文件系统验证文件与目录同步行为。成功响应只在落盘完成后返回，磁盘满、权限不足或非法 JSON 均返回明确错误，不覆盖成空配置。
4. 创建操作使用稳定实体 ID，重试先核对文件中的目标实体；修改/删除使用版本条件。响应丢失时客户端重新读取确认结果，不能直接追加一份配置；API 配置的提交结果以该文件为准。
5. 服务启动时验证文件存在且可读写。缺失、损坏或配置目录不可用时报告配置错误，阻止依赖配置的生成/写操作；保留原文件供修复，不自动用默认值替换。修复后重新读取即可生效，无需重新构建前端。
6. 服务端是运行期间的唯一写入者。NAS 上人工修改文件应先停止服务或进入暂停配置写入的维护状态；进程内锁不能保证与外部编辑器并发写入安全。服务恢复后读取新内容并使旧版本失效。

实际 `config/gpt-image-playground.json` 位于用户 NAS，当前工作区未找到，尚未核对其内容；实施时读取结构即可，不在日志或文档输出实际密钥。

## 4. 图片收藏与提示词

1. 用户在画廊或 Agent 图片处点击收藏并选择收藏夹；多图任务的批量入口显示选图列表与上传数量。
2. 从 IndexedDB 读取选中原图，保存所属任务 prompt；存在该图 revisedPromptByImage 时另存“模型改写提示词”。不将整个任务、对话或 API 配置打包上传。
3. 原图采用二进制上传；MIME、大小、hash、时间由服务端校验/计算。NAS 提交完成后显示已收藏，失败保留本地图片并允许重试。
4. 收藏记录自包含图片和提示词，使用独立 favoriteId；本地维护 (taskId, imageId) 到 favoriteId 的映射，不能让 NAS 收藏依赖原浏览器任务。
5. 同一原图文件按内容去重，不同提示词可保留不同收藏记录。重试使用原操作 ID，防止重复记录；部分成功逐图显示状态。
6. NAS 收藏视图独立读取服务端分页列表，支持看图、下载、复制提示词和删除。作为参考图使用时按需下载到当前浏览器。
7. 提示词中的图片提及作为文本保留，不自动上传参考图/遮罩；仅凭收藏提示词不保证精确复现原生成。

收藏夹及归属保存在 NAS。旧任务仅部分输出已上传时显示部分收藏，不将 task.isFavorite 当作整个任务已同步的证据。普通图片与对话没有 NAS 预览副本。

## 5. 删除规则

| 操作 | 数据效果 |
| --- | --- |
| 删除普通画廊图片、任务或 Agent 对话 | 修改当前浏览器记录，清理不再被引用的本地图片。 |
| 清理本地已收藏图片 | 默认保留 NAS 收藏；“同时删除 NAS 收藏”作为明确选项。 |
| 从一个收藏夹移出 | 修改 NAS 归属，仍有其他归属时保留。 |
| 退出最后一个收藏夹/取消收藏 | 明确确认删除 NAS 收藏；无其他收藏引用文件时清理原图。 |
| 在 NAS 收藏页删除 | 删除指定收藏及其文件引用，其他设备刷新后反映变化。 |
| 删除 API 配置 | 后端直接修改 `config/gpt-image-playground.json`，保留本地历史非密钥快照。 |

NAS 不能删除其他浏览器已有的本地副本。界面区分“删除本地图片”和“删除 NAS 收藏”。

本地单图删除需更新输出列表、实际参数/改写提示词、透明原图配对和 Agent 输出引用，保留同任务其他图及共享引用。NAS 收藏快照独立保留。

服务端删除收藏采用数据库事务更新归属/blob 引用，再物理删除无引用文件。SQLite 与文件系统不具有统一事务：持久化清理状态，立即禁止访问删除记录，文件清理失败可查询并重试，不报告已彻底清理。旧客户端更新返回 404/410，不 upsert 复活已删记录。

上传与本地删除竞争时，禁用相关删除或明确取消上传；上传结果不明确时按操作 ID 查询。NAS 已删收藏不因旧本地标志自动重新上传。

## 6. 服务端、登录与部署

新增小型 Node.js/TypeScript 服务提供认证、API 配置、收藏/收藏夹和鉴权媒体读取。保留 Nginx 前端；Compose 将服务端数据根目录映射到 NAS 本地磁盘，服务端仅内部网络暴露。

| 环境变量 | 用途 |
| --- | --- |
| APP_PASSWORD | 必填服务端运行时密码，空值拒绝启动。 |
| DATA_DIR=/data | NAS 本地 bind mount 根目录。 |
| API_CONFIG_PATH=/config/gpt-image-playground.json | 服务端运行配置文件路径，对应 NAS 的 `config/gpt-image-playground.json`。 |
| APP_ORIGIN | 访问源，用于来源/代理校验。 |
| COOKIE_SECURE=true | HTTPS Cookie，显式内网 HTTP 测试可关闭。 |
| SESSION_TTL_HOURS=24 | 默认会话有效期。 |

登录使用服务端密码校验、随机 session Cookie、过期/退出失效、登录限流；Cookie 设置 HttpOnly/SameSite，HTTPS 设置 Secure。写请求校验 Origin 与会话绑定的 CSRF token。登录密码和私有预置不得进入 Vite、公开配置文件、镜像构建参数或日志。

认证成功后才挂载实际工作区；退出/401 中止本页网络和上传、卸载私有 UI、清理内存配置和对象 URL。本地数据库继续保留，登录入口不等同于本地磁盘加密。

所有配置接口、收藏接口、原图/缩略图、下载及可选 /api-proxy/ 统一鉴权。public/sw.js 排除私有路径，私有响应 Cache-Control: no-store，更新缓存版本并测试登出后的缓存行为。

拟定接口：

| 接口组 | 操作 |
| --- | --- |
| /api/auth/session、/api/auth/login、/api/auth/logout | 会话检查、登录、退出。 |
| /api/api-config、/api/profiles、/api/providers | 读取 API 配置、单项增删改、默认/Agent 选择；密钥读取单独鉴权。 |
| /api/favorites | 分页列表、multipart 原图与提示词上传。 |
| /api/favorites/:id | 详情、归属修改、删除，修改带 revision。 |
| /api/collections | 收藏夹增删改和排序。 |
| /media/favorites/:id | 鉴权图片读取；缩略图仅从已收藏图片派生。 |
| /api/operations/:id | 查询上传/删除结果，处理超时不确定与文件清理。 |

部署时将 NAS 的整个 `config` 目录以可写方式挂载为后端容器的 `/config`，为临时文件和原子替换提供同一目录；不要沿用旧示例中单文件 `:ro` 的预置挂载方式。配置路径由服务端环境变量指定，不接受客户端传入文件系统路径。Nginx 不公开托管该目录。

`/config/gpt-image-playground.json` 保存 API 配置及相关策略；`/data/app.sqlite` 保存收藏、收藏夹、blob 引用及收藏操作；`/data/images/` 保存收藏原图，`/data/staging/` 保存上传暂存。配置文件和收藏数据卷均需持久挂载。数据库在 NAS 本地卷，单实例写入；备份同时包含配置 JSON、一致性收藏数据库及所有引用图片，恢复时分别验证其完整性。

服务端验证文件类型/字节、大小、提示词长度、配置结构及 URL，使用服务端文件名，拒绝路径穿越；上传流式写文件。磁盘满/只读/卷异常报错，不回退本地保存 NAS 数据。数据目录和真实环境文件加入 gitignore，配置含密钥，限制卷与备份访问权限。

后端框架、SQLite 驱动和受维护 Node 版本在实施时确定，验证 NAS 的 CPU 架构与 Docker 镜像。本次文档不安装依赖。

## 7. 本地兼容与刷新中断

- 现有任务、图片和 Agent 对话保留本地格式与 normalize；收藏同步映射是新增局部状态。
- 旧 isFavorite/favoriteCollectionIds 显示为“本地收藏”，提供显式逐图/批量上传。没有原图的旧收藏提示缺失，不能用预览冒充原图。
- 首次启动直接读取 NAS 已有配置文件。旧本地 API 配置在登录后通过一次性迁移入口列出，经用户选择通过同一文件写入接口合并；同 ID/同名冲突明确处理，不用本地副本覆盖文件。确认文件保存成功并重新读取核对后，在本地记录迁移完成并删除 localStorage 中密钥和配置字段；未完成前不自动清除唯一副本，重复迁移按稳定 ID 检测结果。
- 正常启动仅从 NAS 读取 API 配置，不使用旧本地配置作为运行回退。迁移读取与常规 hydration 分开。
- 本地 ZIP 备份维持任务/图片/对话格式；导入其中 API 配置必须走服务端导入流程。普通本地导出默认不夹带 NAS 密钥，显式导出 API 配置需单独选择并鉴权。
- 停用刷新后的 fal.ai、自定义队列和 Agent 自动恢复。CallApiOptions 增加外部 AbortSignal，覆盖生成、轮询、下载；卸载/退出取消不进入恢复定时器。
- 旧页面遗留 running 任务在浏览器标记中断。通过页面标识及活跃标签页协调避免新标签页误中断另一活跃页，不在 NAS 保存普通任务或生图心跳。
- 手动重试是显式操作；请求提交前验证 NAS 配置，结果持久化在本地，收藏时才上传。

## 8. 执行阶段

| 阶段 | 修改位置与工作 | 完成证据 |
| --- | --- | --- |
| A. 服务端与登录 | 新增 server/、登录组件、src/lib/serverApi.ts；修改 App.tsx、Docker/Nginx 同源入口。 | 密码不进产物；接口/媒体/代理鉴权、退出、CSRF、限流有效。 |
| B. NAS API 配置 | 新增 server 配置 JSON 读写模块及 CRUD，兼容现有文件、串行写入/版本校验/原子替换；修改 store.ts、persistedState.ts、apiProfiles.ts、SettingsModal.tsx 及配置导入入口，调整 inject-api-url.sh 的配置注入边界。 | 两设备读同一 JSON，修改后文件即时更新；本地无新配置/密钥持久化；旧配置迁移幂等，失败不损坏文件。 |
| C. 收藏服务与 UI | 媒体上传/去重/清理；修改 types.ts、收藏动作、TaskCard/Agent 图片入口、components/favorites/；新增逐图片映射。 | 多图只上传所选图，提示词正确，上传失败/部分成功可见，NAS 收藏独立可浏览。 |
| D. 删除与兼容 | 本地单图清理、NAS 取消收藏、最后归属处理、旧本地收藏入口、配置缺失处理。 | 本地清理不丢 NAS 收藏，远端删除不误删共享文件，旧状态不自动上传/复活。 |
| E. 中断与交付 | API AbortSignal、启动中断；Compose/环境模板、配置目录可写挂载、Vite 代理、SW、README。 | 刷新不续跑、多标签页不误判；容器重建保留配置 JSON 与收藏；桌面/移动端验收。 |

新纯函数放 src/lib/，复用既有领域工具。API 配置共享与图片收藏分别界定持久化范围，避免上传整个 AppSettings 或整个 TaskRecord。

## 9. 验收标准

1. 正常画廊/Agent 生成并浏览，抓包和检查 NAS：仅发生认证/配置读取，无普通图片、预览、对话或任务上传。
2. 三图任务仅收藏第二张：NAS 仅保存该原图、其 prompt 和对应 revised prompt；NAS 收藏无需原 taskId 存在。
3. 上传完成才显示已收藏；断网/磁盘满保留本地原图，重试不重生成、不重复收藏。
4. 同一原图多收藏共享文件，各提示词独立；删除一条不影响其他收藏。
5. A 收藏后 B 能看收藏；A 修改 API 配置后 B 读到新配置，B 看不到 A 的普通画廊和 Agent 对话。
6. 新保存的 API 配置/密钥不在 localStorage/IndexedDB；退出清内存；NAS 不可用时不偷偷使用旧本地配置。
7. 新增/修改/删除 API 配置后直接检查 NAS 的 config/gpt-image-playground.json：内容正确更新；删除最后一项进入未配置状态，本地历史可看，重新生成要求选择有效配置。
8. 清本地任务/对话/浏览器数据后，NAS 收藏和配置仍在；显式远端删除后其他页面刷新更新。
9. 退出最后一个收藏夹有清晰删除确认；共享文件引用正确，unlink 失败可见并可恢复清理。
10. 未认证 API/媒体/代理拒绝，401/退出清 UI；构建产物与日志不含测试登录密码或私有预置 Key。
11. 旧本地收藏不自动上传；旧配置迁移冲突不覆盖 NAS，迁移确认前不丢唯一副本，成功后清理旧凭据。
12. 刷新/关闭生成页不自动续跑或重新提交，遗留状态中断，另一活跃标签页不被误判。
13. 并发修改/删除配置或收藏返回版本冲突/已删除，旧页面不能复活数据；上传响应丢失可查询结果。
14. 重建 NAS 容器仍可从挂载的 JSON 读取 API 配置、从数据卷读取收藏；配置文件和收藏数据库/图片的备份恢复通过。
15. 模拟配置目录只读、磁盘满、JSON 损坏、写入中断：不得报告成功或留下半个 JSON；临时文件替换成功前旧配置保持可读。
16. 两客户端基于同一版本修改配置，一方成功后另一方收到冲突；维护期间人工修改后重开服务和读取接口，无需构建前端即可看到新内容，旧请求版本失效。
17. 新保存配置保留无关合法扩展字段；重复创建/迁移与响应丢失重试不追加重复项；配置文件不能通过静态路径匿名下载。

验证包括 favoriteState/store/persistedState/agentResponseState 的相关回归、配置解析与导入测试、API 取消测试，以及服务端真实 JSON 文件原子写入/故障恢复、收藏 SQLite/文件系统集成测试。执行 npm run build、npm test、新增服务端检查后，完成 Docker 与浏览器桌面/移动端验收。

## 10. 官方依据与实施状态

- [Vite 环境变量](https://vite.dev/guide/env-and-mode)：VITE_* 对客户端公开，密码应置于服务端。
- [OWASP 会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[CSRF 防护](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)：Cookie 与写接口安全边界。
- [SQLite WAL](https://sqlite.org/wal.html)：同主机文件系统限制和一致性备份注意事项。

本次只更新实施文档，未安装依赖、修改业务代码、连接 NAS 或运行构建/测试。部署时填写 NAS 数据目录、架构、权限及 HTTPS 入口。
