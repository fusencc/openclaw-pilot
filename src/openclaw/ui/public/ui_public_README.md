# public 说明书 (Folder Manual)
## 核心功能 (Core Function)
存放 OpenClaw Web UI 的公共静态图标资源，负责 favicon、Apple Touch Icon 等浏览器入口图形输出。

## 输入 (Input)
输入来自 `icons/icon-source.svg` 的统一视觉稿，以及 Web 端对 SVG、PNG、ICO 多格式图标的兼容需求。

## 输出 (Output)
输出 `favicon.svg`、`favicon-32.png`、`favicon.ico`、`apple-touch-icon.png` 等可直接被浏览器与设备读取的图标文件。

## 定位 (Position)
该目录位于 UI public 静态资源层，承担 Web 入口图标分发职责。

## 依赖 (Dependency)
- `icons/icon-source.svg`：作为当前 favicon 视觉语言的主参考稿
- `sidepanel.js`：运行时通过 `/favicon.svg` 引用品牌图标
- 浏览器 favicon 规范：要求兼容 SVG、PNG、ICO 与 Apple Touch Icon

## 维护规则 (Maintenance Rules)
1. 内部同步：当本文件夹内的代码文件（.swift, .kt, .ts 等）增加、删除或功能变更时，必须检查并更新上述的【核心功能】、【输入】、【输出】等信息，确保文档与代码一致
2. 反向更新 (Reverse Update)：一旦本 README 的内容发生实质性变更（尤其是架构定位、核心功能或文件结构改变时），必须检查并同步更新 `Documentation/Basic/` 目录下的以下全局文档，确保信息一致：
 * `Documentation/Basic/File-structure.md` 项目文件结构
 * `Documentation/Basic/App-flow.md` 产品流程说明
 * `Documentation/Basic/PRD.md` 产品逻辑说明（含用户故事）
 * `Documentation/Basic/Frontend-guidelines.md` 前端开发规范说明
 * `Documentation/Basic/Backend-structure.md` 后端架构设计说明
 * `Documentation/Basic/Tech-stack.md` 项目技术栈说明
