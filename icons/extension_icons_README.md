# icons 说明书 (Folder Manual)
## 核心功能 (Core Function)
存放浏览器扩展入口图标与其矢量主稿，负责统一扩展在工具栏、插件管理页与品牌展示中的视觉识别。

## 输入 (Input)
输入来自品牌图标设计稿、扩展 manifest 的尺寸要求，以及侧边栏品牌资源的复用需求。

## 输出 (Output)
输出 `icon16.png`、`icon32.png`、`icon48.png`、`icon128.png` 等位图文件，以及 `icon-source.svg` 这份可维护的矢量主稿。

## 定位 (Position)
该目录属于扩展静态资源层，是扩展图标资源的唯一维护入口。

## 依赖 (Dependency)
- `manifest.json`：声明扩展在不同场景下使用的图标文件
- `assets/icon128-BTAbtSSb.png`：侧边栏品牌图复用的 128 尺寸位图
- `icon-source.svg`：所有导出位图的统一源文件

## 维护规则 (Maintenance Rules)
1. 内部同步：当本文件夹内的代码文件（.swift, .kt, .ts 等）增加、删除或功能变更时，必须检查并更新上述的【核心功能】、【输入】、【输出】等信息，确保文档与代码一致
2. 反向更新 (Reverse Update)：一旦本 README 的内容发生实质性变更（尤其是架构定位、核心功能或文件结构改变时），必须检查并同步更新 `Documentation/Basic/` 目录下的以下全局文档，确保信息一致：
 * `Documentation/Basic/File-structure.md` 项目文件结构
 * `Documentation/Basic/App-flow.md` 产品流程说明
 * `Documentation/Basic/PRD.md` 产品逻辑说明（含用户故事）
 * `Documentation/Basic/Frontend-guidelines.md` 前端开发规范说明
 * `Documentation/Basic/Backend-structure.md` 后端架构设计说明
 * `Documentation/Basic/Tech-stack.md` 项目技术栈说明
