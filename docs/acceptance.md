# Isola 验收记录

更新：2026-10-11。当前验收范围为 **Web**，Windows 使用同一 Web 客户端。Tauri 外壳只完成官方生成与配置检查；原生 Windows、macOS、iPhone 未构建或运行。Playwright WebKit 是浏览器引擎测试，不是 Safari、iPhone 或原生 WebView 验收。

## 已执行的 Web 证据

下表保留任务 6 的完整运行记录（`a7d5742`，开发命令修复为 `445218e`、`e5ceca2`），并单列最终审查修复 `0a926d5` 的定向验证。

| 命令或场景 | 实际结果与范围 |
| --- | --- |
| `pnpm test`（即 `playwright test`） | 60/60，通过 Chromium、Firefox、WebKit；包含真实市场用例与 SDK/布局测试 |
| 容器中 `pnpm --filter @isola/server test` | 24/24，真实 PostgreSQL、会话、发布、安装、数据库/网络隔离与流式取消 |
| `pnpm --filter @isola/example-notes test` | 6/6，真实笔记数据库与事件业务 |
| 测试 Docker 入口显式选择 WSL 后，`pnpm exec playwright test e2e/market.spec.ts --project=chromium` | 2/2，覆盖最终测试入口；产品 `pnpm dev` 始终使用标准 Docker/Compose |
| Linux Node/Docker 环境中的 `pnpm dev` | 实际启动到 `http://localhost:5173`；真实注册、TGZ 发布、安装、笔记保存、刷新并重新打开通过 |
| Linux 开发命令启动中取消与正常停止 | 实际构建/Compose 子进程终止；Vite/本次容器停止，原有运行容器和数据保留 |
| Windows 原生子进程取消/退出竞态 | 4/4；仅证明开发命令取消及清理路径，不代表完整 Windows 开发启动或原生客户端验收 |
| 审查修复后的核心服务测试 | 25/25，另一次容器启动失败定向测试 1/1；真实插件网络拒绝旧公开管理员登录，插件自身角色可用，框架及其他插件数据库访问被拒绝；失败原因使用具体且不含凭据的固定消息 |
| 审查修复后的布局测试 | 21/21，Chromium、Firefox、WebKit；包含 ListDetail 返回按钮置于业务表单内时只返回、不提交 |
| 审查修复后的开发命令 | 已运行核心在构建前报告冲突，容器 ID、配置、镜像和数据保留；显式停止后启动、正常退出和启动中取消通过 |

任务 7 的官方 `tauri info` 读取到 Windows 10.0.26200 x86_64、Node 24.12.0、pnpm 10.30.2。浏览器测试使用 Playwright 1.58.2，缓存引擎为 Chromium 145.0.7632.6（1208）、Firefox 146.0.1（1509）、WebKit 26.0（2248）；真实容器使用 Debian WSL Docker 26.1.5，Linux 开发入口使用现有 Node24 核心镜像。

审查修复使用独立临时 Compose 项目验证私有 `PGPASSWORD` 和现有核心冲突，未修改 Grove 预览的数据卷或凭据。已有旧密码数据卷需要按[开发指南](plugin-development.md)显式修改 PostgreSQL 角色密码；修改环境变量本身不会更改已有角色密码。

真实 `pnpm dev` 生成并用于 Chromium 市场验收的 `@isola/example-notes` 0.1.0 TGZ：SHA-256 `55a0a7b76f442cf6386ec3ee9f413b987fae0fd65838155057925da19f66dfc0`。本次读取保留的归档计算校验值；不据此声明原生端加载过该产物。

## 逐项结果

| 用例 | 状态 | 证据与限制 |
| --- | --- | --- |
| 市场发布、安装、打开 | 通过 | [真实市场测试](../e2e/market.spec.ts)使用 npm TGZ、Better Auth、Docker 与 PostgreSQL |
| 创建、编辑、保存、刷新后重新打开 | 通过 | 官方笔记经真实宿主调用和业务数据库保存；不是拦截的市场 API |
| 接收事件 | 通过 | 笔记重新打开通过真实 SSE ready 事件读取列表；[通道测试](../e2e/framework.spec.ts)和核心测试覆盖事件与流式取消 |
| 自定义区域顺序、宽度与占比 | 通过 | [布局测试](../e2e/layout.spec.ts)验证 1:2:1 权重和声明顺序 |
| 多列换行、嵌套、窄容器无根页面横向溢出 | 通过 | 1280、390、260px 与嵌套父容器测试 |
| 字体放大 | 通过有限范围 | 根字体 16→20px 后 rem 尺寸与可达性通过；未代替系统字体设置验收 |
| 浏览器页面缩放 | 未验证 | 根字体与视口变化测试不等同于浏览器缩放操作 |
| 可选 ListDetail 窄屏返回与焦点 | 通过 | 返回操作、隐藏区域不可交互、容器断点和嵌套作用范围通过 |
| 尺寸变化保留编辑节点和草稿 | 通过 | 比较同一 textarea DOM 身份和未保存内容，条件区域变化保持稳定 key |
| 可见高度缩小后的输入与保存可达 | 通过有限范围 | 浏览器视口从 900 缩到 300px；未操作真实软键盘 |
| 真实软键盘、设备安全区域、触摸/触控笔 | 未验证 | 无真机操作证据 |
| 独立客户端读取同一记录 | 通过 Web 范围 | Grove 在无复制 cookies 的独立 Firefox 会话登录同一用户，读取同一安装版本和保存的正文 |
| 标准表单、File/Blob、JSON/204/错误、通道生命周期 | 通过 | [通道测试](../e2e/framework.spec.ts)；原生 allow-forms 与不透明源同时保留 |
| 伪造归属、宿主凭据、插件数据库与网络隔离 | 通过 | 浏览器和核心服务测试；修复后的独立环境验证私有管理员密码及真实插件网络内的角色隔离 |
| 普通安装失败 | 通过既有用例 | 返回具体原因、不产生成功安装入口，原有版本及普通失败场景数据保留 |
| 插件启动已提交破坏性 SQL 后恢复原有业务数据 | **未完成，待用户决定** | 当前无法自动恢复已提交的破坏性 SQL；普通失败测试不证明这一保证，恢复责任尚未确认 |
| Grove 接入 | 通过 Web 范围 | 独立测试副本按公开 SDK 和 TGZ 规则发布、安装给定网页原型；键盘焦点与失败导入修复已通过定向复核，原 CSS 与 React 编辑器保留 |

Grove 的接入范围是给定网页对应的 `design-trials/grove-sites-prototype-20261008`，独立测试副本提交为 `6ef9d01`。最终本地市场版本为 `0.1.4`，安装记录 `c4572ca1-0bda-4995-afbc-484caad47242`，TGZ SHA-256 为 `1410c35ed202ff193a4e55806605f96ac6aa337099c02a978ace8251cfde29eb`。升级保留已有画板记录。

初次接入通过 21 项实际业务检查及独立 Firefox 读取。修正版通过 6 项业务/前端定向测试、6 项 Chromium 交互检查、3 项原生文件选择器重试检查，以及 5 项 WebKit 普通段落编辑、保存、重新打开和 390×844 阅读检查。失败写入使用显式 503 注入；成功路径经过真实会话、插件后端和 PostgreSQL。WebKit 测试保存的原始笔记已完整恢复并比较一致。

0.1.2 的同浏览器、同状态桌面画板、桌面阅读、窄屏阅读三组原版/插件版截图均为零差异。0.1.4 保留同一 CSS 与 React 编辑器，问答和整理保持原网页的示例行为。远程参考图的字体/滚动条及画板位置存在差异，未声明整张远程图片像素一致。截图、比较指标和安装产物保存在独立测试目录 `workdashboard-testing/grove-evidence`。

WebKit 的表格末尾 `Ctrl+End`、`Enter` 后输入场景出现文字分散；相同视口、内容和按键序列在原版已编译编辑器与插件版中均复现，焦点、显示文字和保存正文一致。该原有场景仍未通过；普通段落输入与保存的通过结果不覆盖它。

## 本次配置与构建检查

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0，锁文件一致 |
| `pnpm --filter @isola/client tauri info` | exit 0，官方 CLI 解析 React/Vite 与 devUrl/frontendDist；未运行原生客户端 |
| 生成的 Tauri JSON Schema + Node assert 检查 | 通过；实际 URL、项目标识、图标引用和生成的本地 core 默认权限一致 |
| `cargo read-manifest --manifest-path apps/client/src-tauri/Cargo.toml` | exit 0，只解析 Cargo 清单；未编译 Rust 或解析完整依赖锁 |
| `pnpm typecheck` | exit 0 |
| `pnpm build` | exit 0，SDK、Web 宿主、服务端、笔记全部构建 |

Tauri 配置由 `@tauri-apps/cli` 2.12.2 官方 `init` 生成，Rust 清单沿用其 `tauri` 2.12.3、`tauri-build` 2.7.2 版本约束与 Rust 1.90 最低版本。默认开发 URL 为 `http://localhost:5173`，发布构建 URL 为本地核心服务 `http://localhost:3000`；部署时按[开发指南](plugin-development.md#客户端配置与验证范围)改成实际服务地址。外壳只加载同一 Web 宿主，未增加公开原生能力。

本次未运行 `tauri dev/build`、`tauri ios init/dev/build` 或任何设备验收；原生客户端支持保持未验证。任务 4 的破坏性初始化数据保留要求仍未完成。
