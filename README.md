# ChatGPT 项目分支树

Chrome Manifest V3 本地扩展，用来把 ChatGPT 项目内的对话抽象成可交互的提问分支树。扩展只在本机运行，扫描结果、布局、收藏、节点说明、笔记和分支样式都保存在 Chrome 本地存储中，并支持 JSON 导入导出。

当前版本：`1.0.6`

## 功能

- 按 ChatGPT 项目选择并扫描项目内对话。
- 读取项目会话详情中的 `mapping`，只展示真实用户提问节点。
- 根据消息 `parent` 和跨会话公共消息 ID 构建项目级分支树。
- 支持缩放、滚轮平移、框选、多选拖拽、撤销/重做布局移动。
- 点击节点可跳转到对应 ChatGPT 对话并高亮消息。
- 左侧分支栏可高亮分支、设置分支颜色、双击编辑分支名和分支说明。
- 节点支持收藏、节点说明、Markdown 笔记。
- 可折叠/展开 ChatGPT 页面中的助手回复。
- 设置面板支持主题色、字体大小、布局密度、自动更新间隔、JSON 存档导入/导出/清空。

## 本地安装

```bash
npm install
npm run build
```

然后在 Chrome 中加载：

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择本项目的 `dist` 目录。
5. 打开 `https://chatgpt.com` 中任意项目。
6. 点击扩展图标打开侧边栏，选择项目并扫描。

也可以直接安装打包文件中的内容：

- 构建产物目录：`dist/`
- 压缩包：`chatgpt-project-branch-tree.zip`

## 开发

```bash
npm run dev
npm test
npm run build
```

构建流程会：

- 使用 TypeScript 做类型检查。
- 使用 Vite 打包 side panel 和 background。
- 单独把 content script 和 page-world bridge 打成自包含 IIFE，避免 Chrome 以普通 content script 执行时遇到 ESM import 报错。
- 复制 `public/manifest.json` 到 `dist/manifest.json`。
- 将 content/page bridge 包裹在函数作用域内，避免重复注入时污染全局作用域。

## 数据来源

扩展优先通过 ChatGPT 页面同源接口读取数据：

- 项目列表：`/backend-api/gizmos/snorlax/sidebar`
- 项目会话列表：`/backend-api/gizmos/{gizmo_id}/conversations`
- 会话详情：`/backend-api/conversation/{conversation_id}`

会话详情里的 `mapping` 是树构建的核心数据。扩展会过滤出：

- `message.author.role === "user"`
- `message.content` 有实际文本
- `message.metadata.is_user_system_message !== true`

如果接口不可用，扩展会提示错误；旧版 DOM 兜底逻辑只适合当前页面可见内容，不能保证完整项目分支。

## 本地 JSON 存档

设置面板中的“导出”会生成 JSON 文件。存档包含：

- 当前扫描结果
- 已选节点
- 每个项目的布局偏移
- 节点收藏
- 节点名
- 节点说明
- 节点笔记
- 分支颜色
- 分支名和分支说明
- 应用设置

导入 JSON 后会写回 `chrome.storage.local`。扩展不会上传聊天内容或标注内容。

## 版本规则

- `1.0.0`：稳定版基线。
- `1.0.1`、`1.0.2`：后续功能和修复按 patch 递增。
- 每次代码改动都同步更新 `package.json`、`package-lock.json`、`public/manifest.json` 和侧边栏显示版本。

## 1.0.1 更新

- 修复点击分支后总是回到第一条分支的问题。
- 分支栏改为点击颜色环打开颜色浮层，非目标分支置暗。
- 分支名和分支说明改为双击编辑。
- 收藏节点在树上始终保持黄色高亮。
- 节点说明移到请求内容上方，并改为双击编辑。
- 收藏入口移到请求卡片右上角的小按钮。
- 笔记区与回复区拉开距离，新增笔记输入固定在笔记区底部。
- 折叠/展开图标换成更简洁的加减和缩放图标。

## 1.0.2 更新

- 修复项目列表接口因 `limit=100` 超过 ChatGPT 当前上限而返回 422 的问题。
- 项目列表请求页大小调整为接口允许的最大值 `50`。

## 1.0.3 更新

- 已选节点标题改为可双击编辑的节点名，节点名会同步影响树图中的节点展示。
- 详情右上角分支名改为展示侧边栏中编辑后的分支名。
- 收藏入口移动到节点名右侧。
- 节点说明改为轻量行内展示：“节点说明：xxx”，双击即可编辑。
- 笔记区下沉并扩大固定滚动区域。
- 分支颜色选择改为居中大弹窗，并扩充可选颜色。

## 1.0.4 更新

- 修复笔记过多时条目被压缩导致文字不可见的问题。
- 笔记区进一步下沉到详情区域底部，并保持固定高度滚动。
- 单条分支/对话拉取失败时，保留上次缓存的该分支，不再从树图中移除。
- 修复设置里修改自动更新间隔时，空值或非法数字导致报错的问题。

## 1.0.5 更新

- 修复 `content.js` 被拆出 ESM import 后在 Chrome content script 中报 `Cannot use import statement outside a module` 的问题。
- content script 和 page-world bridge 改为独立自包含 IIFE 产物，并增强构建校验，防止压缩后的 `import{...}` 漏检。

## 1.0.6 更新

- 修复点击节点跳转时自动刷新并发扫描导致 ChatGPT 会话详情接口 429 的问题。
- 节点跳转期间会短暂停止静默刷新，跳转后再恢复自动更新。
- 节点跳转只在目标对话变化时切换 URL，并增加消息高亮重试时间。
- 会话详情扫描增加请求间隔和 429 退避重试，降低触发限流的概率。

## 限制

- ChatGPT 内部接口可能随网页改版变化，接口结构变动时需要更新解析逻辑。
- 插件只适用于本地解压安装，当前没有准备 Chrome Web Store 发布材料。
- 跳转高亮依赖 ChatGPT 页面 DOM 中的消息 ID 或文本指纹，页面结构变化时可能需要刷新或重试。
