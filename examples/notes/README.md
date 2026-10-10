# 官方笔记示例 / 插件模板

复制本目录即可开始编写插件，具体步骤见[插件开发指南](../../docs/plugin-development.md)。本示例用公开 `@isola/plugin` 通道访问业务后端，并用 `@isola/plugin/ui` 组合列表、编辑和操作区域。

在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm --filter @isola/plugin build
pnpm --filter @isola/example-notes test
pnpm --filter @isola/example-notes build
pnpm --dir examples/notes pack
```

测试需要 PostgreSQL 18；`TEST_DATABASE_URL` 指向允许创建数据库的测试账号，默认 `postgresql://isola_test@127.0.0.1:55432/postgres`。每次运行创建独立测试数据库并在结束时删除。

从本目录构建可选业务镜像：

```sh
docker build -f server/Dockerfile -t isola-example-notes:0.1.0 .
```

框架为镜像提供 `PORT=3000`、独立插件数据库的 `DATABASE_URL`、请求安装版本的 `ISOLA_PLUGIN_NAME` / `ISOLA_PLUGIN_VERSION`，并在业务请求中传入可信的 `x-isola-user-id`。镜像先读取随镜像打包的 `package.json`，身份不匹配时在初始化前停止；SQL 初始化使用 PostgreSQL 原生事务。`GET /health` 在初始化后返回镜像本身的名称、版本和 API 版本。

| 路由 | 行为 |
| --- | --- |
| `GET /notes` | 当前用户的 `{ id, title, body }` 数组 |
| `POST /notes` | 用 `{ title, body }` 新建笔记，返回记录，HTTP 201 |
| `PUT /notes/:id` | 更新当前用户的笔记并返回记录；不存在时 HTTP 404 |
| `GET /events` | SSE，先发 `{ type: 'ready' }`，新建或更新后发 `{ type: 'changed', note }` |

界面以“新建”打开草稿，“保存”创建或更新笔记，保存成功显示“已保存”。SSE 更新列表，保留正在输入的编辑草稿。宿主、插件前端与后端的一体化开发入口随会话和市场界面一起实现；当前不能单独打开本例 HTML 完成宿主通道联调。
