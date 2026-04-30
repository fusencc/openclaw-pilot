// ============================================================
// OpenClaw Copilot 1.0.3 - Reverse Engineering Index
// ============================================================
//
// 目录结构:
//
//   manifest.json          - 扩展清单 (已清理 key/update_url)
//   background.js          - ★ 完整逆向源码 (CDP Relay Bridge)
//   sidepanel.js           - 美化 + 段落注释标注 (Vite bundle)
//   rules.json             - declarativeNetRequest 规则
//   src/sidepanel.html     - 侧边栏入口 HTML
//   src/reverse/           - ★ 逆向提取的独立模块:
//     adapter.js           - Settings 注入层 (gatewayUrl, token, sessionKey)
//     offline-hint.js      - 离线连接提示 UI
//     gateway-client.js    - WebSocket RPC 客户端 (核心通信类)
//     rpc-methods.js       - 全部 46 个 RPC 方法映射表
//   assets/                - CSS + 语言包 (zh-CN, zh-TW, es, de, pt-BR)
//   icons/                 - 扩展图标
//
// ============================================================
// 架构概览:
//
//   ┌─────────────┐  WebSocket   ┌──────────────┐
//   │ sidepanel   │◄────────────►│ OpenClaw     │
//   │ (Chat UI)   │ :18789      │ Gateway      │
//   └──────┬──────┘              └──────────────┘
//          │ chrome.runtime.sendMessage
//   ┌──────▼──────┐  WebSocket   ┌──────────────┐
//   │ background  │◄────────────►│ OpenClaw     │
//   │ (CDP Bridge)│ :18792      │ Relay Server │
//   └─────────────┘              └──────────────┘
//          │ chrome.debugger API
//   ┌──────▼──────┐
//   │ Browser Tab │  (任意网页, 完整 CDP 控制)
//   └─────────────┘
//
// ============================================================
// 加功能指南:
//
// 1. 改 background.js (CDP 层):
//    - 已是完整可读源码, 直接改
//    - 可拦截/注入 CDP 命令, 加新 message handler
//    - 修改 relay 行为, 加自定义协议
//
// 2. 加新页面/功能:
//    - 在 manifest.json 加 content_scripts / popup / options_page
//    - 写全新 JS 文件, 不碰 bundle
//
// 3. 改 sidepanel UI:
//    - 方案 A: 在 sidepanel.js 中按 SECTION 注释定位, 局部修改
//    - 方案 B: 用 MutationObserver 从外部注入 DOM (更稳)
//    - 方案 C: 重写 sidepanel, 复用 GatewayClient 协议
//
// 4. 调用 OpenClaw API:
//    - 参考 src/reverse/rpc-methods.js 的 46 个方法
//    - 参考 src/reverse/gateway-client.js 的 RPC 调用方式
//    - WebSocket URL: ws://127.0.0.1:18789
//    - 默认 Token: YOUR_GATEWAY_TOKEN_HERE
//
// ============================================================
