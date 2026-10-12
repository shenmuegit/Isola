# Isola 验收指南

本指南提供 Web 宿主、公开 SDK、插件市场及后端的测试方法与预期结果。Windows 使用同一 Web 客户端。浏览器引擎测试与原生设备测试分别执行；Playwright WebKit 不替代 Safari、iPhone 或系统 WebView 验证。

## 环境与构建

准备 Node.js 24、pnpm 10、Docker Engine/Compose。测试使用可访问原生 Docker socket 的 Linux 容器环境。从仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm --filter @isola/plugin build
pnpm typecheck
pnpm build
```

预期：类型检查和工作区构建成功。插件使用公开 SDK，构建产物包含清单声明的入口与静态资源。

## 自动化测试

### 浏览器、布局与真实市场

先确认 `3000` 和 `4173` 端口空闲，Docker 引擎可用。安装测试浏览器后运行：

```sh
pnpm exec playwright install chromium firefox webkit
pnpm test
```

Playwright 的全局准备脚本构建插件、笔记镜像和框架镜像，创建独立 PostgreSQL、核心服务与网络；测试结束时清理其创建的容器、网络和 PostgreSQL 卷。无需先运行 `pnpm dev`。具体配置见 [playwright.config.ts](../playwright.config.ts)。

| 测试文件 | 预期行为 |
| --- | --- |
| [framework.spec.ts](../e2e/framework.spec.ts) | iframe 通道绑定正确；JSON、File、表单、HTTP 204、错误、超时与 SSE 按 SDK 契约工作；断开后释放请求和订阅 |
| [layout.spec.ts](../e2e/layout.spec.ts) | 区域顺序、宽度与占比正确；宽窄容器和嵌套布局可达；尺寸变化保留编辑节点及草稿 |
| [menu.spec.ts](../e2e/menu.spec.ts) | 注册、替换、注销、文件重选和错误反馈作用于当前插件；旧注册与非当前窗口不能误调用 |
| [navigation.spec.ts](../e2e/navigation.spec.ts) | 安装入口与账号一致；安装成功更新入口、失败保留入口；菜单键盘与焦点行为正确 |
| [market.spec.ts](../e2e/market.spec.ts) | 实际会话下发布 TGZ、安装 Docker 后端、打开插件并保存业务数据；刷新后重新打开内容保留 |

Windows 测试使用 WSL 引擎时，可按[开发指南](plugin-development.md#4-本地联调)显式设置 `ISOLA_TEST_WSL_DISTRO`；默认使用标准 Docker CLI。

### 核心服务与笔记后端

复制 `.env.example` 为 `.env`，设置私有随机 `PGPASSWORD` 和 `BETTER_AUTH_SECRET`。确认 `3000` 和 `5432` 端口空闲，使用独立 Compose 项目运行测试：

```sh
docker compose -p isola-validation up -d --build
docker compose -p isola-validation exec server pnpm test
docker compose -p isola-validation exec -w /workspace server pnpm --filter @isola/example-notes test
docker compose -p isola-validation down
```

核心测试在服务容器内运行，使用 Compose 提供的 Docker socket、PostgreSQL 管理连接和容器标识。测试创建独立业务数据库并清理；`down` 停止该 Compose 项目，保留其命名数据卷。

| 测试文件 | 预期行为 |
| --- | --- |
| [market.test.ts](../apps/server/test/market.test.ts) | 拒绝错误清单、缺失入口及越界归档；同名插件按 SemVer 返回最新版本，安装记录归属正确 |
| [install.test.ts](../apps/server/test/install.test.ts) | 镜像健康信息匹配发布版本；业务数据库、角色和网络归属正确；请求与事件按用户和安装记录转发 |
| [recovery.test.ts](../apps/server/test/recovery.test.ts) | 初始化、安装记录写入或恢复过程失败时保留对应数据与恢复信息；提交后清理失败不撤回已提交安装 |
| [notes.test.ts](../examples/notes/test/notes.test.ts) | 笔记创建、编辑、读取及 SSE 工作正常；用户数据隔离，初始化失败回滚 |

仅运行笔记后端测试时，也可在宿主设置 `TEST_DATABASE_URL` 后运行 `pnpm --filter @isola/example-notes test`。该连接须指向独立测试 PostgreSQL，并允许创建数据库；默认地址见[模板说明](../examples/notes/README.md)。

## 市场与插件业务

按[本地联调指南](plugin-development.md#4-本地联调)运行 `pnpm dev`，打开 `http://localhost:5173`，以官方笔记模板或待发布插件执行以下步骤。

| 操作 | 预期结果 |
| --- | --- |
| 注册、登录，发布构建的 `.tgz` | 市场显示正确名称、版本与说明；发布失败显示原因 |
| 安装并打开插件 | 仅安装成功后显示入口；业务页面加载清单中的前端产物 |
| 创建、编辑、保存记录，刷新后重新打开 | 保存内容来自插件数据库，原文保持一致 |
| 用独立浏览器会话登录同一账号 | 读取相同安装版本与已保存记录 |
| 换另一个账号读写私有记录 | 只能读写自己的记录；按其他账号记录 ID 访问也遵守归属条件 |
| 安装两个插件，通过菜单切换并返回市场 | 页面只有一个宿主标题栏，当前插件操作随切换更新 |
| 文件选择、取消、连续两次选择同一文件 | 取消不调用业务回调；每次选择都交付原文件名和内容 |
| 保存请求返回失败后重试 | 页面保留草稿与未保存提示，重试仍提交实际修改内容 |
| 打开菜单后使用 Tab 和 Escape | 操作可达，关闭菜单后焦点返回正确位置 |

## 覆盖更新与失败恢复

在独立测试部署中发布同名的两个正常版本与一个健康检查失败的测试版本，分别执行：

1. 两个账号安装旧版本并保存各自记录，记录安装版本和业务内容。
2. 其中一个账号更新到正常新版本，检查市场只有一张卡片、该账号只有一条安装记录、业务数据库和内容保留；另一账号仍能使用旧版本。
3. 更新到失败版本，检查错误可见，原安装版本、完整业务内容和原后端恢复可用。
4. 运行核心的恢复测试，覆盖初始化已提交 SQL、安装记录写入失败及恢复故障。比较表内容、序列、数据库设置和权限；其他插件数据保持原样。

恢复机制和具体保护见[插件接入规范](plugin-development.md#框架安装失败恢复)。

## 已有数据迁移与跨表保存

插件涉及旧存储结构迁移时，准备带原文、内部链接、多引用和界面状态的测试数据：

- 升级后逐项比较业务内容与界面状态，原引用标识保留；重复读取、重启和并发首次访问不重复创建正式记录。
- 两个账号使用相同旧记录 ID，迁入后的正式记录仍各自归属正确。
- 通过正式接口修改正文，再连续保存旧页面的视角或其他界面状态；其间重新读取后再次保存，新正文仍保持不变。
- 编辑各业务字段，注入一次保存失败后重试，确认实际修改的字段写入成功。
- 在跨表写入的中途制造失败，确认业务内容和引用映射一起回滚；缺失的映射记录及其他用户记录 ID 不导致误写。
- 对具有独立引用的业务，分别验证删除引用和删除原记录符合插件定义的行为。

## 布局与设备

使用相同插件产物验证宽屏、窄屏及嵌套容器，放大字体并操作浏览器页面缩放：区域应保持可达，编辑节点和草稿不因尺寸变化重建或丢失。

真实触摸、软键盘、安全区域和原生 WebView 需要在对应设备验证。原生外壳按[客户端配置](plugin-development.md#客户端配置)连接同一框架宿主，再执行市场安装、业务读写、导航及输入用例。
