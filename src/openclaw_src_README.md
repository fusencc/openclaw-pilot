# src 说明书 (Folder Manual)
## 核心功能 (Core Function)
存放 OpenClaw 扩展的前端注入脚本与 Sidepanel 页面资源，包含 UI 样式注入、页面内容读取与交互增强逻辑（如智读按钮的“单击总结 / 双击常驻附文”双模式）。`sidepanel.html` 通过在原压缩 CSS 之后加载 `../assets/theme-override.css`，为整个面板套用 Slate + Indigo 主题（见 assets/）。智读按钮（`read-inject.js`）单击总结已固定为紧凑多重格式：加粗段首、引用块标题/摘要、Markdown 表格核心内容、行内代码追问方向。智读按钮同时具备三层鲁棒性防护：fetch 层 8s 超时、处理层 15s 看门狗、入口预检自愈，确保 MV3 service worker 回收或 SPA 路由切换下可反复触发、不会僵死。

## 输入 (Input)
- 浏览器 Sidepanel/页面 DOM 结构与 CSS 类名
- 扩展运行时消息（`chrome.runtime.*`）与页面抓取内容
- `sidepanel.html` 加载后的运行环境
- 资源层主题：`assets/sidepanel-*.css`（基础样式）+ `assets/theme-override.css`（主题覆盖）

## 输出 (Output)
- 注入到页面/sidepanel 的脚本行为与样式（如输入区布局、按钮注入）
- Sidepanel 页面资源（HTML）与交互体验
- 通过 `theme-override.css` 统一的视觉语言：清晰层级的暗色底 + Indigo 主色，输入框与按钮具备明确的视觉凹陷与焦点反馈
- 智读按钮的网页摘要输出规范：`**网页标题**` + 引用块标题/URL、`**摘要分析**` + 引用块一句话摘要、`**核心原内容分析：**` + Markdown 表格、`**可追问方向**` + 行内代码问题，整体用 `---` 分隔

## 定位 (Position)
扩展前端实现层：承载注入脚本、sidepanel UI 资源与交互编排。

## 依赖 (Dependency)
- Chrome Extension APIs：`chrome.runtime.*`
- DOM APIs：`MutationObserver`、事件派发、选择器匹配

## 维护规则 (Maintenance Rules)
1. 内部同步：当本文件夹内的代码文件（.swift, .kt, .ts 等）增加、删除或功能变更时，必须检查并更新上述的【核心功能】、【输入】、【输出】等信息，确保文档与代码一致
2. 反向更新 (Reverse Update)：一旦本 README 的内容发生实质性变更（尤其是架构定位、核心功能或文件结构改变时），必须检查并同步更新 `Documentation/Basic/` 目录下的以下全局文档，确保信息一致：
 * `Documentation/Basic/File-structure.md` 项目文件结构
 * `Documentation/Basic/App-flow.md` 产品流程说明
 * `Documentation/Basic/PRD.md` 产品逻辑说明（含用户故事）
 * `Documentation/Basic/Frontend-guidelines.md` 前端开发规范说明
 * `Documentation/Basic/Backend-structure.md` 后端架构设计说明
 * `Documentation/Basic/Tech-stack.md` 项目技术栈说明

