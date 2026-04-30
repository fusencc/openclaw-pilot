// # 文件说明书 (Folder Manual Template)
// ## 核心功能 (Core Function)
// 在 OpenClaw 侧边栏页面注入“Smart Read”按钮，并注入一组 UI CSS 让底部输入区与按钮区更紧凑、对齐且不溢出；提供双模式交互：单击进行网页中文摘要并自动发送（按当前约定输出为加粗段首 + 引用块标题/摘要 + Markdown 表格核心内容 + 行内代码追问的紧凑多重格式）；双击进入“常驻附文模式”（按钮变绿色常驻态），此后用户按原生 send/Enter 发送时自动把网页标题/URL/正文作为参考资料拼接到用户输入后一并发送。按钮具备三层鲁棒性防护（fetch 超时、处理中看门狗、入口处预检自愈），确保在 MV3 service worker 被回收或 SPA 路由切换等异常场景下仍可反复点击、不会僵死。
//
// ## 输入 (Input)
// - 浏览器 Sidepanel DOM（如 `.chat-compose__field textarea`、`.chat-compose__actions`、`.topbar-status`）
// - `chrome.runtime.sendMessage` 返回的页面内容（title/url/content）
//
// ## 输出 (Output)
// - DOM 注入：顶部 `Smart Read` 按钮
// - 样式注入：一段 `style`（id: `openclaw-ui-polish`）用于压缩/对齐 UI
// - 行为：单击触发“中文总结直发”（输出格式固定为：**网页标题** + 引用块标题/URL、**摘要分析** + 引用块一句话摘要、**核心原内容分析：** + Markdown 表格、**可追问方向** + 行内代码问题）；双击进入“常驻附文”，拦截 send/Enter 并拼接网页参考资料后放行发送
// - 鲁棒性：`fetchPageData` 8s 超时（避免 Promise 永久 pending）、`runQuickSummary`/`enterPinnedMode` 15s 看门狗（强制复位 isProcessing 与按钮视觉态）、入口处 `forceRecoverIfStuck` 预检自愈
//
// ## 定位 (Position)
// Sidepanel 前端注入脚本：负责 UI/交互增强与按钮行为编排。
//
// ## 依赖 (Dependency)
// - `chrome.runtime.sendMessage`: 向扩展后台请求页面内容
// - `MutationObserver`: 监听页面变化以注入样式/按钮
// - DOM 结构类名：`.chat-compose__field`、`.chat-compose__actions`、`.topbar-status`
//
// ## 维护规则 (Maintenance Rules)
// 1. 每次修改代码逻辑后，必须检查并更新上述的【核心功能】、【输入】、【输出】等信息，确保文档与代码一致。
// 2. 禁止修改或删除本【维护规则】章节的内容。
// 3. 修改完成后，必须扫描当前文件所在的文件夹目录，找到对应的 [当前文件夹名称]_README.md 文档，并同步更新该 README 中关于本文件的描述信息。

(function () {
  const BUTTON_ID = 'openclaw-smart-read-btn';
  const STYLE_ID = 'openclaw-ui-polish';
  const SUMMARY_PROMPT = `你是一名专业的网页内容分析助手。请在理解下方网页内容后，按以下规则输出结构化分析结果。
【硬性约束】
1. 使用【简体中文】回复；专有名词原文保留。
2. 忽略：导航栏、按钮、菜单、广告、页脚、侧边推荐等无关元素。
3. 板块与板块之间使用 --- 分隔，保持排版紧凑；列表项内部不要空行。
4. 不要在输出中暴露判断过程，不要说"这是招聘页"、"已识别为技术文章"之类；直接输出结果。
5. 保持信息量，不要删减网页核心事实；但可把同类信息合并进表格。

【输出结构与格式】严格按以下风格输出：
**网页标题**
> **网页标题原文**
> \`URL原文\`

---

**摘要分析**
> 用一句话（不超过 40 字）概括网页的核心凝练主题与结论。

---

**核心原内容分析：**

先用一小段概括页面主要内容；随后用 Markdown 表格整理核心内容。
表格建议两列：| 类型 | 核心内容 |
表格内保留原文专有名词、数字、日期、金额、标题、人名、公司名、产品名、URL。
如果网页内容不适合按“类型”分类，可改用更贴合内容的两列表头，例如：| 要点 | 核心内容 |、| 维度 | 核心内容 |、| 条目 | 核心内容 |。
表格内重点数字、日期、产品名、结论性短语可用 **加粗** 强调。
如原文标题里包含竖线 |，在表格中写作 \|，避免破坏表格。

---

**可追问方向**
\`问题1\`  \`问题2\`  \`问题3\`
每条不超过 20 字，能引出更深入的细节、对比或延伸思考。

---

`;

  const MODE = {
    DEFAULT: 'DEFAULT',
    PINNED: 'PINNED',
  };

  let mode = MODE.DEFAULT;
  let cachedPageData = null; // { title, url, content, siteName, capturedAt }
  let clickTimer = null;
  let isProcessing = false;
  let processingStartAt = 0;
  const MAX_PROCESSING_MS = 15000; // 超过此时长强制自愈，防止 MV3 消息链路异常导致僵死
  let bypassNextSend = false;

  function tinyDelay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function getSmartReadBtn() {
    return document.getElementById(BUTTON_ID);
  }

  function getTextarea() {
    return document.querySelector('.chat-compose__field textarea');
  }

  function getSendBtn() {
    return document.querySelector('.chat-compose__actions .btn.primary');
  }

  function setNativeValue(textarea, value) {
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSet) nativeSet.call(textarea, value);
    else textarea.value = value;
  }

  // 超时保护：MV3 service worker 可能被回收，sendMessage 回调有丢失风险，
  // 必须保证 Promise 在任何异常路径下都能 settle，否则 isProcessing 会永久卡住。
  async function fetchPageData(timeoutMs = 8000) {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('fetchPageData timeout'));
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT_FOR_SIDEPANEL' }, (res) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (res?.error) reject(new Error(res.error));
          else resolve(res);
        });
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  function setPinnedVisual(btn, pinned, title) {
    if (!btn) return;
    if (pinned) {
      btn.classList.add('smart-read-pinned');
      const t = title?.trim() ? title.trim() : '当前页面';
      btn.title = `已附加: ${t}\n输入问题后按 send/Enter 即可发送\n单击或双击退出`;
      btn.setAttribute('aria-label', 'Smart Read (Pinned)');
    } else {
      btn.classList.remove('smart-read-pinned');
      btn.title = 'Smart Read';
      btn.setAttribute('aria-label', 'Smart Read');
    }
  }

  // ========== UI POLISH CSS ==========
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Hide nav sidebar tabs (guide, discord, entire nav group items) */
      .nav-group__items .nav-item[data-tab="guide"],
      .nav-group__items .nav-item[data-tab="join_discord"],
      .nav-group__items a.nav-item--external,
      .nav-group--links {
        display: none !important;
      }

      /* Hide nav group labels and collapse entire sidebar to just chat */
      .nav .nav-group .nav-label {
        display: none !important;
      }
      .nav .nav-group__items {
        padding: 0 !important;
      }
      .nav .nav-group {
        margin: 0 !important;
        padding: 0 !important;
      }

      /* Hide the entire nav sidebar - default to chat */
      aside.nav {
        display: none !important;
      }

      /* Remove left margin from main content when nav is hidden */
      main.content {
        margin-left: 0 !important;
        padding-left: 0 !important;
      }

      /* Compact topbar */
      .topbar {
        padding: 6px 12px !important;
        min-height: unset !important;
        gap: 8px !important;
      }
      .brand-sub {
        display: none !important;
      }
      .brand-title {
        font-size: 13px !important;
        letter-spacing: 0.5px !important;
      }
      .brand-logo img {
        width: 20px !important;
        height: 20px !important;
      }

      /* Compact chat-controls bar */
      .chat-controls {
        padding: 4px 8px !important;
        gap: 4px !important;
        font-size: 12px !important;
      }

      /* ===== COMPACT CHAT COMPOSE (bottom input area) ===== */
      .chat-compose {
        padding: 6px 10px !important;
        gap: 0 !important;
      }
      .chat-compose__row {
        display: flex !important;
        flex-direction: row !important;
        align-items: flex-end !important;
        gap: 6px !important;
        width: 100% !important;
      }

      /* Hide "Message" label text */
      .chat-compose__field > span:first-child {
        display: none !important;
      }
      .chat-compose__field {
        flex: 1 1 0% !important;
        min-width: 0 !important;
        margin: 0 !important;
        width: 80% !important;
      }

      /* Compact textarea */
      .chat-compose__field textarea {
        min-height: 36px !important;
        max-height: 120px !important;
        padding: 8px 12px !important;
        font-size: 13px !important;
        border-radius: 18px !important;
        border: 1px solid rgba(255,255,255,0.12) !important;
        background: rgba(255,255,255,0.04) !important;
        transition: border-color 0.2s, box-shadow 0.2s !important;
        resize: none !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      .chat-compose__field textarea:focus {
        border-color: rgba(255,255,255,0.25) !important;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.06) !important;
        outline: none !important;
      }
      .chat-compose__field textarea::placeholder {
        color: rgba(255,255,255,0.3) !important;
        font-size: 13px !important;
      }

      /* Inline action buttons - compact, right-aligned */
      .chat-compose__actions {
        display: flex !important;
        flex-direction: column !important;
        gap: 4px !important;
        flex-shrink: 0 !important;
        flex-grow: 0 !important;
        width: auto !important;
        max-width: 76px !important;
        align-self: flex-end !important;
        height: auto !important;
      }
      .chat-compose__actions .btn {
        padding: 6px 10px !important;
        font-size: 11px !important;
        border-radius: 14px !important;
        min-width: unset !important;
        width: auto !important;
        white-space: nowrap !important;
        line-height: 1.3 !important;
        min-height: 26px !important;
        border: 1px solid rgba(255,255,255,0.1) !important;
        background: rgba(255,255,255,0.05) !important;
        transition: all 0.2s !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .chat-compose__actions .btn:hover:not(:disabled) {
        background: rgba(255,255,255,0.1) !important;
        border-color: rgba(255,255,255,0.2) !important;
      }
      .chat-compose__actions .btn.primary {
        background: rgba(59,130,246,0.15) !important;
        border-color: rgba(59,130,246,0.3) !important;
        color: #93bbfc !important;
      }
      .chat-compose__actions .btn.primary:hover:not(:disabled) {
        background: rgba(59,130,246,0.25) !important;
      }

      /* Hide keyboard hint (↵) inside send button */
      .btn-kbd {
        display: none !important;
      }

      /* Hide attachment preview bar text labels */
      .chat-compose__attachments-label {
        display: none !important;
      }

      /* Compact pill status */
      .topbar-status .pill {
        font-size: 11px !important;
        padding: 2px 8px !important;
        gap: 4px !important;
        border-radius: 12px !important;
      }

      /* Compact chat messages */
      .chat-message {
        padding: 6px 10px !important;
      }

      /* Smooth scrollbar */
      ::-webkit-scrollbar {
        width: 4px !important;
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.15) !important;
        border-radius: 4px !important;
      }
      ::-webkit-scrollbar-track {
        background: transparent !important;
      }

      /* Smart Read button style */
      #${BUTTON_ID} {
        transition: all 0.2s !important;
        border-radius: 8px !important;
        padding: 4px !important;
      }
      #${BUTTON_ID}:hover {
        background: rgba(255,255,255,0.08) !important;
      }

      /* Smart Read pinned mode */
      #${BUTTON_ID}.smart-read-pinned {
        background: rgba(34, 197, 94, 0.18) !important;
        border: 1px solid rgba(34, 197, 94, 0.5) !important;
        color: rgba(187, 247, 208, 0.95) !important;
        position: relative !important;
      }
      #${BUTTON_ID}.smart-read-pinned::after {
        content: '';
        position: absolute;
        top: 2px;
        right: 2px;
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.95);
        box-shadow: 0 0 0 2px rgba(0,0,0,0.25);
      }

      /* Queue indicator */
      .chat-queue {
        font-size: 11px !important;
        padding: 4px 8px !important;
      }

      /* New messages button */
      .chat-new-messages {
        font-size: 11px !important;
        padding: 4px 12px !important;
        border-radius: 12px !important;
      }
    `;
    document.head.appendChild(style);
  }

  // ========== DOM CLEANUP ==========
  let cleaned = false;
  function cleanupDOM() {
    if (cleaned) return;

    // Force click chat tab if not already active
    const chatTab = document.querySelector('.nav-item[data-tab="chat"]');
    if (chatTab && !chatTab.classList.contains('active')) {
      chatTab.click();
    }

    // Hide guide/discord nav items by matching text
    document.querySelectorAll('.nav-item').forEach(el => {
      const text = el.textContent?.trim().toLowerCase() || '';
      if (text.includes('guide') || text.includes('discord') || text.includes('join')) {
        el.style.display = 'none';
      }
    });

    // Hide external link nav items
    document.querySelectorAll('.nav-item--external').forEach(el => {
      el.style.display = 'none';
    });

    cleaned = true;
  }

  // ========== SMART READ BUTTON ==========
  let injected = false;

  function createReadButton() {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.className = 'nav-collapse-toggle';
    btn.title = 'Smart Read';
    btn.setAttribute('aria-label', 'Smart Read');
    btn.style.cssText = 'margin-right: 6px;';
    btn.innerHTML = `<span class="nav-collapse-toggle__icon" style="display:flex;align-items:center;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    </span>`;
    btn.addEventListener('click', handleClick);
    btn.addEventListener('dblclick', handleDoubleClick);
    return btn;
  }

  function showStatus(btn, text, color) {
    btn.title = text;
    btn.style.opacity = '0.6';
    btn.style.pointerEvents = 'none';
    if (color) btn.style.color = color;
  }

  function resetButton(btn) {
    btn.title = 'Smart Read';
    btn.style.opacity = '';
    btn.style.pointerEvents = '';
    btn.style.color = '';
  }

  // 强制从"处理中僵死态"自愈：清掉 isProcessing 与按钮视觉锁，
  // 用于看门狗到期或用户主动点击时检测到超时时触发。
  function forceRecoverIfStuck(reason) {
    if (!isProcessing) return false;
    const stuckMs = Date.now() - processingStartAt;
    if (stuckMs < MAX_PROCESSING_MS) return false;
    isProcessing = false;
    const btn = getSmartReadBtn();
    if (btn) {
      if (mode === MODE.PINNED) setPinnedVisual(btn, true, cachedPageData?.title);
      else resetButton(btn);
    }
    console.warn('[SmartRead] force-recover from stuck state:', reason, `(${stuckMs}ms)`);
    return true;
  }

  function handleClick(e) {
    const btn = getSmartReadBtn();
    if (!btn) return;
    e.preventDefault();

    if (mode === MODE.PINNED) {
      exitPinnedMode('manual-click');
      return;
    }

    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickTimer = null;
      runQuickSummary();
    }, 300);
  }

  async function handleDoubleClick(e) {
    const btn = getSmartReadBtn();
    if (!btn) return;
    e.preventDefault();

    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }

    if (mode === MODE.PINNED) {
      exitPinnedMode('manual-dblclick');
      return;
    }

    await enterPinnedMode();
  }

  async function runQuickSummary() {
    const btn = getSmartReadBtn();
    if (!btn) return;
    // 在进入前先尝试自愈一次，避免因上次卡死而直接被 isProcessing 拦截
    forceRecoverIfStuck('pre-quick-summary');
    if (isProcessing) return;
    isProcessing = true;
    processingStartAt = Date.now();
    showStatus(btn, 'Reading page...', '#F59E0B');

    // 看门狗：MAX_PROCESSING_MS 内若未 settle，强制复位一次，避免按钮永久僵死
    const watchdog = setTimeout(() => {
      if (!isProcessing) return;
      isProcessing = false;
      const b = getSmartReadBtn();
      if (b) {
        showStatus(b, 'Timeout', '#B91C1C');
        setTimeout(() => resetButton(b), 1500);
      }
      console.warn('[SmartRead] watchdog fired for runQuickSummary');
    }, MAX_PROCESSING_MS);

    try {
      const pageData = await fetchPageData();

      if (!pageData?.content || pageData.content.trim().length < 50) {
        showStatus(btn, 'Too little content', '#B91C1C');
        setTimeout(() => resetButton(btn), 2000);
        return;
      }

      showStatus(btn, 'Analyzing...', '#10B981');
      const message = `${SUMMARY_PROMPT}标题: ${pageData.title}\n网址: ${pageData.url}\n\n${pageData.content}`;

      const textarea = getTextarea();
      if (textarea) {
        setNativeValue(textarea, message);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await tinyDelay(100);

        const sendBtn = getSendBtn();
        if (sendBtn && !sendBtn.disabled) {
          bypassNextSend = true;
          sendBtn.click();
        } else {
          bypassNextSend = true;
          textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        }
        showStatus(btn, 'Sent!', '#10B981');
        setTimeout(() => resetButton(btn), 1500);
      } else {
        showStatus(btn, 'Input not found', '#B91C1C');
        setTimeout(() => resetButton(btn), 2000);
      }
    } catch (err) {
      console.error('[SmartRead]', err);
      showStatus(btn, 'Error', '#B91C1C');
      setTimeout(() => resetButton(btn), 3000);
    } finally {
      clearTimeout(watchdog);
      isProcessing = false;
    }
  }

  async function enterPinnedMode() {
    const btn = getSmartReadBtn();
    if (!btn) return;
    forceRecoverIfStuck('pre-enter-pinned');
    if (isProcessing) return;
    isProcessing = true;
    processingStartAt = Date.now();
    showStatus(btn, 'Reading page...', '#F59E0B');

    const watchdog = setTimeout(() => {
      if (!isProcessing) return;
      isProcessing = false;
      const b = getSmartReadBtn();
      if (b) {
        showStatus(b, 'Timeout', '#B91C1C');
        setTimeout(() => resetButton(b), 1500);
      }
      console.warn('[SmartRead] watchdog fired for enterPinnedMode');
    }, MAX_PROCESSING_MS);

    try {
      const pageData = await fetchPageData();

      if (!pageData?.content || pageData.content.trim().length < 50) {
        showStatus(btn, 'Too little content', '#B91C1C');
        setTimeout(() => resetButton(btn), 2000);
        return;
      }

      cachedPageData = {
        ...pageData,
        capturedAt: Date.now(),
      };
      mode = MODE.PINNED;
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
      btn.style.color = '';
      setPinnedVisual(btn, true, cachedPageData?.title);
    } catch (err) {
      console.error('[SmartReadPinned]', err);
      showStatus(btn, 'Error', '#B91C1C');
      setTimeout(() => resetButton(btn), 3000);
    } finally {
      clearTimeout(watchdog);
      isProcessing = false;
    }
  }

  function exitPinnedMode(reason) {
    cachedPageData = null;
    mode = MODE.DEFAULT;
    const btn = getSmartReadBtn();
    if (btn) {
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
      btn.style.color = '';
      setPinnedVisual(btn, false);
    }
    void reason;
  }

  function composeMessage(userInput, pageData) {
    const input = (userInput || '').trim();
    return `${input}\n\n---\n【网页参考资料】\n标题: ${pageData?.title || ''}\n网址: ${pageData?.url || ''}\n\n${pageData?.content || ''}`;
  }

  function attachSendInterceptor() {
    if (window.__openclawSmartReadInterceptorAttached) return;
    window.__openclawSmartReadInterceptorAttached = true;

    document.addEventListener('click', async (e) => {
      if (bypassNextSend) {
        bypassNextSend = false;
        return;
      }
      if (mode !== MODE.PINNED || !cachedPageData) return;

      const target = e.target;
      if (!(target instanceof Element)) return;
      const sendBtn = target.closest('.chat-compose__actions .btn.primary');
      if (!sendBtn) return;

      const textarea = getTextarea();
      if (!textarea) return;
      const userInput = textarea.value || '';
      if (!userInput.trim()) {
        const btn = getSmartReadBtn();
        if (btn) {
          showStatus(btn, 'Please input your request', '#B91C1C');
          setTimeout(() => setPinnedVisual(btn, true, cachedPageData?.title), 1200);
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      const message = composeMessage(userInput, cachedPageData);
      setNativeValue(textarea, message);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await tinyDelay(50);

      bypassNextSend = true;
      const realSendBtn = getSendBtn();
      if (realSendBtn && !realSendBtn.disabled) {
        realSendBtn.click();
      } else {
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      }

      exitPinnedMode('after-send');
    }, true);

    document.addEventListener('keydown', async (e) => {
      if (bypassNextSend) {
        bypassNextSend = false;
        return;
      }
      if (mode !== MODE.PINNED || !cachedPageData) return;
      if (e.key !== 'Enter' || e.shiftKey) return;

      const textarea = getTextarea();
      if (!textarea) return;

      const active = document.activeElement;
      if (active !== textarea) return;

      const userInput = textarea.value || '';
      if (!userInput.trim()) {
        const btn = getSmartReadBtn();
        if (btn) {
          showStatus(btn, 'Please input your request', '#B91C1C');
          setTimeout(() => setPinnedVisual(btn, true, cachedPageData?.title), 1200);
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      const message = composeMessage(userInput, cachedPageData);
      setNativeValue(textarea, message);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await tinyDelay(50);

      bypassNextSend = true;
      const realSendBtn = getSendBtn();
      if (realSendBtn && !realSendBtn.disabled) {
        realSendBtn.click();
      } else {
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      }

      exitPinnedMode('after-send');
    }, true);
  }

  // ========== INJECTION ==========
  function tryInject() {
    injectStyles();

    if (!injected) {
      if (document.getElementById(BUTTON_ID)) { injected = true; }
      else {
        const topbarStatus = document.querySelector('.topbar-status');
        if (topbarStatus) {
          topbarStatus.insertBefore(createReadButton(), topbarStatus.firstChild);
          injected = true;
        }
      }
    }

    cleanupDOM();

    if (injected) {
      attachSendInterceptor();
      const btn = getSmartReadBtn();
      if (btn && mode === MODE.PINNED) setPinnedVisual(btn, true, cachedPageData?.title);
    }
  }

  const observer = new MutationObserver(() => tryInject());
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }
})();
