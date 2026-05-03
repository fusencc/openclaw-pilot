# src 说明书 (Folder Manual)
## 核心功能 (Core Function)
存放 OpenClaw 扩展的前端注入脚本与 Sidepanel 页面资源，包含 UI 样式注入、页面内容读取、悬浮猫咪聊天入口与交互增强逻辑（如智读按钮的"单击总结 / 双击常驻附文"双模式）。`sidepanel.html` 通过在原压缩 CSS 之后加载 `../assets/theme-override.css`，为整个面板套用 **Nocturne Violet 子夜紫罗兰**主题（见 assets/），并可在 `?floating=1` 模式下作为页面悬浮窗 iframe 复用。`content-script.js` 负责在网页端注入悬浮猫咪入口与悬浮面板 shell（iframe 指向 `src/sidepanel.html?floating=1`），并实现 hover/click 展开、基于图标锚点的同源展开动效、点击外部与 ESC 收起、双击打开完整 sidepanel、拖拽改位与位置持久化；同时继续提供页面内容抓取能力给 sidepanel/浮窗用于摘要与上下文补全。`read-inject.js` 运行在 sidepanel/floating iframe 内：负责 UI 压缩与 Smart Read 按钮注入，提供单击总结/双击常驻附文，并具备三层鲁棒性防护（fetch 8s 超时、15s 看门狗、入口预检自愈）。

## 输入 (Input)
- 浏览器 Sidepanel/页面 DOM 结构与 CSS 类名
- 扩展运行时消息（`chrome.runtime.*`）、iframe `postMessage` 与页面抓取内容
- 后台消息：`OPEN_SIDEPANEL`（双击猫咪触发）、`OPENCLAW_SIDEPANEL_SUMMARY`（sidepanel 兜底总结）
- 用户指针/键盘事件：mouseenter、click、双击、拖拽、ESC、document mousedown
- `sidepanel.html` 加载后的运行环境
- 资源层主题：`assets/sidepanel-*.css`（基础样式）+ `assets/theme-override.css`（Nocturne Violet 主题覆盖）+ `assets/pet-cat.png`（猫咪入口图标）

## 输出 (Output)
- 注入到页面/sidepanel 的脚本行为与样式（如输入区布局、按钮注入、悬浮猫咪、互斥显示、自适应尺寸）
- Sidepanel 页面资源（HTML）与悬浮 iframe 复用入口
- 通过 `theme-override.css` 统一的视觉语言：Nocturne Violet 深夜紫罗兰底 + Violet 主色 + Fuchsia 点缀；悬浮模式下壳层与 iframe 内元素均采用液态玻璃半透明风格（深色 `rgba(12,10,20,0.72)` / 浅色 `rgba(255,255,255,0.72)`），输入框聚焦时紫罗兰描边高亮
- 悬浮窗视觉：64px 猫咪图（drop-shadow 蓝紫光晕 + 5.2s 呼吸 + 思考态紫色跑马环）+ **Natively 液态玻璃中框**（`backdrop-filter: blur(20px) saturate(140%)` + 半透明边框 + 外阴影 + 微紫光圈 + inset 高光，`border-radius: 20px`，深浅模式各自适配）；iframe 内消息气泡/输入框/按钮同步为半透明毛玻璃质感
- 悬浮窗交互：hover 延迟展开 + click 显式开关，并通过图标锚点驱动的同源展开动效让面板像从猫咪入口长出；展开时会在四象限中自动择位，尽量避开猫咪图标、避免面板与入口重叠；点击页面外立即收起 / 双击展开为完整 sidepanel / ESC 收起；猫咪可拖拽改位与位置持久化
- 智读按钮的网页摘要输出规范：`**网页标题**` + 引用块标题/URL、`**摘要分析**` + 引用块一句话摘要、`**核心原内容分析：**` + Markdown 表格、`**可追问方向**` + 行内代码问题，整体用 `---` 分隔

## 定位 (Position)
扩展前端实现层：承载注入脚本、sidepanel UI 资源、悬浮宠物入口与交互编排。

## 依赖 (Dependency)
- Chrome Extension APIs：`chrome.runtime.*`、`chrome.storage.*`
- DOM APIs：`MutationObserver`、`ResizeObserver`、事件派发、选择器匹配、iframe / postMessage

## 维护规则 (Maintenance Rules)
1. 内部同步：当本文件夹内的代码文件（.swift, .kt, .ts 等）增加、删除或功能变更时，必须检查并更新上述的【核心功能】、【输入】、【输出】等信息，确保文档与代码一致
2. 反向更新 (Reverse Update)：一旦本 README 的内容发生实质性变更（尤其是架构定位、核心功能或文件结构改变时），必须检查并同步更新 `Documentation/Basic/` 目录下的以下全局文档，确保信息一致：
 * `Documentation/Basic/File-structure.md` 项目文件结构
 * `Documentation/Basic/App-flow.md` 产品流程说明
 * `Documentation/Basic/PRD.md` 产品逻辑说明（含用户故事）
 * `Documentation/Basic/Frontend-guidelines.md` 前端开发规范说明
 * `Documentation/Basic/Backend-structure.md` 后端架构设计说明
 * `Documentation/Basic/Tech-stack.md` 项目技术栈说明

