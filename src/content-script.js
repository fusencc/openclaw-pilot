// # 文件说明书 (Folder Manual Template)
// ## 核心功能 (Core Function)
// 注入网页端“悬浮猫咪入口 + 悬浮面板壳”，打开时才挂载浮窗 iframe，并通过同源展开动效把入口与面板连成一体，同时提供页面内容提取能力给 sidepanel/浮窗做摘要与上下文补全。
//
// ## 输入 (Input)
// - 页面 DOM 与视口尺寸（用于定位悬浮入口与面板）
// - `chrome.storage.local`：持久化悬浮入口位置（x/y）
// - 扩展运行时消息：`GET_PAGE_CONTENT`（返回页面标题/URL/正文）
//
// ## 输出 (Output)
// - 网页端 DOM 注入：悬浮猫咪按钮与浮窗面板壳；打开时挂载 iframe 指向 `src/sidepanel.html?floating=1`，关闭即卸载
// - 交互：点击开关、hover 延迟展开、同源展开动效、自动避让图标避免面板重叠、点击外部/ESC 收起、快速重复点击防抖、移动超过阈值才进入拖拽，避免普通点击被拖拽逻辑抢走
// - 运行时消息响应：返回 `{ title, url, content, siteName }`
// - 状态广播：向后台发送 `SET_FLOATING_WIDGET_STATE`（opened true/false）
//
// ## 定位 (Position)
// 运行在网页里的 content script：负责“网页侧入口/浮窗注入 + 页面内容抓取”。
//
// ## 依赖 (Dependency)
// - `manifest.json`: content_scripts 注入声明、web_accessible_resources 放行浮窗资源
// - `src/sidepanel.html`: 作为 floating iframe 的承载页面（`?floating=1`）
// - `background.js`: 处理 `SET_FLOATING_WIDGET_STATE` 等消息
// - `assets/pet-cat.png`: 悬浮入口图标
//
// ## 维护规则 (Maintenance Rules)
// 1. 每次修改代码逻辑后，必须检查并更新上述的【核心功能】、【输入】、【输出】等信息，确保文档与代码一致。
// 2. 禁止修改或删除本【维护规则】章节的内容。
// 3. 修改完成后，必须扫描当前文件所在的文件夹目录，找到对应的 [当前文件夹名称]_README.md 文档，并同步更新该 README 中关于本文件的描述信息。

(() => {
  // 避免在 iframe 内重复注入（很多站点会有嵌套 iframe）
  if (window.top !== window) return;

  const MAX_CONTENT_LENGTH = 15000;

  const NOISE_SELECTORS = [
    'nav', 'header', 'footer', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
    '.sidebar', '.nav', '.menu', '.footer', '.header',
    '.ad', '.ads', '.advertisement', '.social-share', '.share-bar', '.share-buttons',
    '.related-posts', '.recommended', '.related-articles', '.more-articles',
    '.breadcrumb', '.breadcrumbs', '.pagination',
    '.copyright', '.legal', '.disclaimer', '.icp', '.beian',
    '.site-footer', '.page-footer', '.global-footer',
    '.site-header', '.global-header', '.top-bar',
    '.cookie-banner', '.cookie-notice', '.consent-banner',
    '.popup', '.modal', '.overlay', '.dialog',
    '.toolbar', '.toolbox', '.action-bar',
    '.follow-us', '.newsletter', '.subscribe',
    'script', 'style', 'noscript', 'iframe', 'svg',
  ];

  const NOISE_TEXT_PATTERNS = [
    /备案号/i, /ICP[备证]/i, /京ICP/i, /粤ICP/i, /沪ICP/i, /浙ICP/i,
    /网安备/i, /公网安备/i, /增值电信/i, /经营许可/i, /营业执照/i,
    /©\s*\d{4}/i, /copyright/i, /all rights reserved/i,
    /cookie\s*(policy|设置|同意)/i, /privacy\s*policy/i, /隐私政策/i,
    /用户协议/i, /服务条款/i, /terms\s*of\s*(service|use)/i,
  ];

  const CONTENT_SELECTORS = [
    // 社交平台特定
    '#detail-desc', '.note-content', '.content-container',
    '[data-note-content]', '.feed-item__content',
    // 通用
    'article',
    '[role="article"]',
    'main',
    '[role="main"]',
    '.post-content',
    '.article-content', '.article-body', '.article__body',
    '.entry-content', '.entry-body',
    '.post-body', '.story-body',
    '#article-content', '#post-content',
    '.content-body', '.page-content',
    '#content',
    '.content',
  ];

  function getMetaDescription() {
    const ogDesc = document.querySelector('meta[property="og:description"]')?.content;
    if (ogDesc?.trim()) return ogDesc.trim();
    const metaDesc = document.querySelector('meta[name="description"]')?.content;
    if (metaDesc?.trim()) return metaDesc.trim();
    return '';
  }

  function getMetaAuthor() {
    return (
      document.querySelector('meta[name="author"]')?.content ||
      document.querySelector('[rel="author"]')?.textContent ||
      ''
    ).trim();
  }

  function getPublishDate() {
    const selectors = [
      'meta[property="article:published_time"]',
      'meta[name="publish-date"]',
      'meta[name="date"]',
      'time[datetime]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const val = el?.content || el?.getAttribute('datetime') || '';
      if (val.trim()) return val.trim();
    }
    return '';
  }

  function isNoiseText(text) {
    if (!text || text.length > 300) return false;
    return NOISE_TEXT_PATTERNS.some((re) => re.test(text));
  }

  function cleanNode(node) {
    const clone = node.cloneNode(true);
    NOISE_SELECTORS.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });
    clone.querySelectorAll('div, p, span, section').forEach((el) => {
      const text = (el.innerText || '').trim();
      if (text && isNoiseText(text) && el.children.length <= 2) {
        el.remove();
      }
    });
    return clone;
  }

  function nodeToStructuredText(node) {
    const parts = [];
    const walk = (el) => {
      if (!el) return;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child.textContent.trim();
          if (t) parts.push(t);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName;
          if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(tag)) continue;
          if (tag === 'BR') { parts.push('\n'); continue; }
          if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) {
            const level = '#'.repeat(parseInt(tag[1]));
            const text = child.textContent.trim();
            if (text) parts.push(`\n${level} ${text}\n`);
            continue;
          }
          if (tag === 'LI') {
            const text = child.textContent.trim();
            if (text) parts.push(`- ${text}`);
            continue;
          }
          if (['P', 'DIV', 'SECTION', 'BLOCKQUOTE'].includes(tag)) {
            walk(child);
            parts.push('\n');
            continue;
          }
          if (tag === 'PRE' || tag === 'CODE') {
            const text = child.textContent.trim();
            if (text) parts.push(`\`\`\`\n${text}\n\`\`\``);
            continue;
          }
          walk(child);
        }
      }
    };
    walk(node);
    return parts
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function findBestContentNode() {
    for (const sel of CONTENT_SELECTORS) {
      const candidates = document.querySelectorAll(sel);
      let best = null;
      let bestLen = 0;
      candidates.forEach((el) => {
        const len = (el.innerText || '').trim().length;
        if (len > bestLen) { best = el; bestLen = len; }
      });
      if (best && bestLen > 200) return best;
    }
    return null;
  }

  function extractPageContent() {
    const title = document.title || '';
    const url = window.location.href;
    const siteName = window.location.hostname;
    const description = getMetaDescription();
    const author = getMetaAuthor();
    const publishDate = getPublishDate();

    let content = '';
    const contentNode = findBestContentNode();

    if (contentNode) {
      const cleaned = cleanNode(contentNode);
      content = nodeToStructuredText(cleaned);
    }

    if (!content || content.length < 200) {
      const bodyClone = cleanNode(document.body);
      content = nodeToStructuredText(bodyClone);
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      content = `${content.slice(0, MAX_CONTENT_LENGTH)}\n\n[... content truncated]`;
    }

    let meta = '';
    if (description) meta += `描述: ${description}\n`;
    if (author) meta += `作者: ${author}\n`;
    if (publishDate) meta += `发布: ${publishDate}\n`;

    const fullContent = meta ? `${meta}\n${content}` : content;

    return { title, url, content: fullContent, siteName };
  }

  const FLOATING = {
    ROOT_ID: 'openclaw-floating-root',
    STORAGE_KEY: 'openclaw:floating:pos:v1',
    CAT_SIZE: 64,
    GAP: 6,
    PANEL_W: 336,
    PANEL_H: 448,
    PANEL_SCALE: 0.8,
    HOVER_OPEN_MS: 180,
    OPENING_PULSE_MS: 220,
    RAPID_CLICK_SUPPRESS_MS: 320,
    EDGE_PADDING: 8,
    DRAG_THRESHOLD: 5,
    Z: 2147483647,
  };

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function getDefaultPos() {
    const x = Math.max(12, window.innerWidth - FLOATING.CAT_SIZE - 18);
    const y = Math.max(80, window.innerHeight - FLOATING.CAT_SIZE - 120);
    return { x, y };
  }

  async function loadPos() {
    try {
      const data = await chrome.storage.local.get([FLOATING.STORAGE_KEY]);
      const pos = data?.[FLOATING.STORAGE_KEY];
      if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return getDefaultPos();
      return pos;
    } catch {
      return getDefaultPos();
    }
  }

  async function savePos(pos) {
    try {
      await chrome.storage.local.set({ [FLOATING.STORAGE_KEY]: pos });
    } catch {}
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'GET_PAGE_CONTENT') {
      sendResponse(extractPageContent());
    }
    return false;
  });

  function ensureRoot() {
    let host = document.getElementById(FLOATING.ROOT_ID);
    if (host) return host;
    host = document.createElement('div');
    host.id = FLOATING.ROOT_ID;
    host.style.cssText = `all: initial; position: fixed; inset: 0; pointer-events: none; z-index: ${FLOATING.Z};`;
    document.documentElement.appendChild(host);
    return host;
  }

  function buildWidget(shadow) {
    const style = document.createElement('style');
    style.textContent = `
      :host, * { box-sizing: border-box; }
      .wrap { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }

      .cat {
        position: fixed;
        z-index: 2;
        width: ${FLOATING.CAT_SIZE}px;
        height: ${FLOATING.CAT_SIZE}px;
        position: fixed;
        display: inline-block;
        border-radius: 999px;
        border: 0;
        padding: 0;
        cursor: grab;
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
        background: transparent;
        filter: drop-shadow(0 12px 22px rgba(124, 58, 237, 0.35)) drop-shadow(0 4px 10px rgba(14, 165, 233, 0.20));
        transform: translate3d(0, 0, 0) scale(1);
        transition: transform 180ms ease, filter 180ms ease, opacity 180ms ease;
      }
      /* Enlarge hit area to match visual glow/transparent pixels */
      .cat::before {
        content: '';
        position: absolute;
        inset: -12px;
        border-radius: 999px;
        background: transparent;
        pointer-events: auto;
      }
      .cat:hover {
        transform: translate3d(0, -1px, 0) scale(1.02);
      }
      .cat:active {
        cursor: grabbing;
        transform: translate3d(0, 0, 0) scale(0.99);
      }
      .cat.panel-open {
        filter: drop-shadow(0 16px 30px rgba(124, 58, 237, 0.42)) drop-shadow(0 8px 18px rgba(14, 165, 233, 0.24));
      }
      .cat.panel-opening {
        transform: translate3d(0, 1px, 0) scale(0.965);
        filter: drop-shadow(0 18px 34px rgba(124, 58, 237, 0.48)) drop-shadow(0 10px 20px rgba(14, 165, 233, 0.28));
      }
      .cat img { width: 100%; height: 100%; display: block; pointer-events: none; }

      .panel {
        --panel-origin-x: 100%;
        --panel-origin-y: 100%;
        --panel-shift-x: 0px;
        --panel-shift-y: 12px;
        position: fixed;
        z-index: 1;
        width: ${FLOATING.PANEL_W}px;
        height: ${FLOATING.PANEL_H}px;
        border-radius: 20px;
        pointer-events: none;
        overflow: hidden;
        opacity: 0;
        transform: translate3d(var(--panel-shift-x), var(--panel-shift-y), 0) scale(0.92);
        transform-origin: var(--panel-origin-x) var(--panel-origin-y);
        transition: opacity 180ms ease, transform 180ms ease;
        background: rgba(12, 10, 20, 0.50);
        border: 1px solid rgba(255,255,255,0.90);
        box-shadow:
          0 22px 50px rgba(0,0,0,0.45),
          0 0 0 1px rgba(124, 58, 237, 0.18),
          inset 0 1px 0 rgba(255,255,255,0.10);
        backdrop-filter: blur(20px) saturate(140%);
        -webkit-backdrop-filter: blur(20px) saturate(140%);
        will-change: transform, opacity;
      }
      @media (prefers-color-scheme: light) {
        .panel {
          background: rgba(255,255,255,0.50);
          border: 1px solid rgba(17,24,39,0.90);
          box-shadow:
            0 18px 46px rgba(0,0,0,0.18),
            0 0 0 1px rgba(124, 58, 237, 0.10),
            inset 0 1px 0 rgba(255,255,255,0.60);
          backdrop-filter: blur(22px) saturate(180%);
          -webkit-backdrop-filter: blur(22px) saturate(180%);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .cat,
        .panel {
          transition-duration: 1ms;
        }

        .cat:hover,
        .cat:active,
        .cat.panel-open,
        .cat.panel-opening,
        .panel,
        .panel.open {
          transform: none;
        }
      }

      .panel.open {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
        pointer-events: auto;
      }

      iframe {
        width: ${Math.round(FLOATING.PANEL_W / FLOATING.PANEL_SCALE)}px;
        height: ${Math.round(FLOATING.PANEL_H / FLOATING.PANEL_SCALE)}px;
        border: 0;
        display: block;
        background: transparent;
        transform: scale(${FLOATING.PANEL_SCALE});
        transform-origin: top left;
      }
    `;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    const cat = document.createElement('button');
    cat.className = 'cat';
    cat.setAttribute('aria-label', 'Open OpenClaw');
    cat.title = 'OpenClaw';
    const img = document.createElement('img');
    img.src = chrome.runtime.getURL('assets/pet-cat.png');
    img.alt = 'OpenClaw';
    cat.appendChild(img);

    const panel = document.createElement('div');
    panel.className = 'panel';

    shadow.append(style, wrap, cat, panel);

    return { cat, panel };
  }

  async function initFloatingWidget() {
    // 避免重复注入（一些 SPA 会 re-inject content script）
    if (document.getElementById(FLOATING.ROOT_ID)) return;

    const host = ensureRoot();
    const shadow = host.attachShadow({ mode: 'open' });
    const { cat, panel } = buildWidget(shadow);

    let opened = false;
    let hoverOpenTimer = null;
    let openingPulseTimer = null;
    let dragging = false;
    let pointerDown = null;
    let dragOffset = { x: 0, y: 0 };
    let suppressNextClick = false;
    let lastCatClickAt = 0;

    function toPercent(value) {
      return `${Math.round(clamp(value, 0, 100))}%`;
    }

    function updatePanelAnchor(x, y, panelLeft, panelTop) {
      const catCenterX = x + FLOATING.CAT_SIZE / 2;
      const catCenterY = y + FLOATING.CAT_SIZE / 2;
      const relativeX = ((catCenterX - panelLeft) / FLOATING.PANEL_W) * 100;
      const relativeY = ((catCenterY - panelTop) / FLOATING.PANEL_H) * 100;
      const panelCenterX = panelLeft + FLOATING.PANEL_W / 2;
      const panelCenterY = panelTop + FLOATING.PANEL_H / 2;
      const shiftX = clamp((catCenterX - panelCenterX) * 0.14, -22, 22);
      const shiftY = clamp((catCenterY - panelCenterY) * 0.12, -22, 22);

      panel.style.setProperty('--panel-origin-x', toPercent(relativeX));
      panel.style.setProperty('--panel-origin-y', toPercent(relativeY));
      panel.style.setProperty('--panel-shift-x', `${Math.round(shiftX)}px`);
      panel.style.setProperty('--panel-shift-y', `${Math.round(shiftY)}px`);
    }

    function getOverlapArea(rectA, rectB) {
      const overlapWidth = Math.max(0, Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left));
      const overlapHeight = Math.max(0, Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top));
      return overlapWidth * overlapHeight;
    }

    function choosePanelPosition(x, y) {
      const minLeft = FLOATING.EDGE_PADDING;
      const minTop = FLOATING.EDGE_PADDING;
      const maxLeft = Math.max(minLeft, window.innerWidth - FLOATING.PANEL_W - FLOATING.EDGE_PADDING);
      const maxTop = Math.max(minTop, window.innerHeight - FLOATING.PANEL_H - FLOATING.EDGE_PADDING);
      const catRect = {
        left: x,
        top: y,
        right: x + FLOATING.CAT_SIZE,
        bottom: y + FLOATING.CAT_SIZE,
      };
      const candidates = [
        {
          left: x - FLOATING.GAP - FLOATING.PANEL_W,
          top: y - FLOATING.GAP - FLOATING.PANEL_H,
          preference: 0,
        },
        {
          left: x + FLOATING.CAT_SIZE + FLOATING.GAP,
          top: y - FLOATING.GAP - FLOATING.PANEL_H,
          preference: 1,
        },
        {
          left: x - FLOATING.GAP - FLOATING.PANEL_W,
          top: y + FLOATING.CAT_SIZE + FLOATING.GAP,
          preference: 2,
        },
        {
          left: x + FLOATING.CAT_SIZE + FLOATING.GAP,
          top: y + FLOATING.CAT_SIZE + FLOATING.GAP,
          preference: 3,
        },
      ];

      return candidates
        .map((candidate) => {
          const left = clamp(candidate.left, minLeft, maxLeft);
          const top = clamp(candidate.top, minTop, maxTop);
          const panelRect = {
            left,
            top,
            right: left + FLOATING.PANEL_W,
            bottom: top + FLOATING.PANEL_H,
          };
          const overlapArea = getOverlapArea(catRect, panelRect);
          const clampDistance = Math.abs(candidate.left - left) + Math.abs(candidate.top - top);
          return {
            left,
            top,
            overlapArea,
            clampDistance,
            preference: candidate.preference,
          };
        })
        .sort((a, b) => a.overlapArea - b.overlapArea || a.preference - b.preference || a.clampDistance - b.clampDistance)[0];
    }

    function positionElements(pos) {
      const maxX = Math.max(0, window.innerWidth - FLOATING.CAT_SIZE - 6);
      const maxY = Math.max(0, window.innerHeight - FLOATING.CAT_SIZE - 6);
      const x = clamp(pos.x, 6, maxX);
      const y = clamp(pos.y, 6, maxY);

      cat.style.left = `${x}px`;
      cat.style.top = `${y}px`;

      const panelPosition = choosePanelPosition(x, y);
      panel.style.left = `${panelPosition.left}px`;
      panel.style.top = `${panelPosition.top}px`;
      updatePanelAnchor(x, y, panelPosition.left, panelPosition.top);
    }

    function pulseCatOpening() {
      if (openingPulseTimer) clearTimeout(openingPulseTimer);
      cat.classList.remove('panel-opening');
      void cat.offsetWidth;
      cat.classList.add('panel-opening');
      openingPulseTimer = setTimeout(() => {
        cat.classList.remove('panel-opening');
        openingPulseTimer = null;
      }, FLOATING.OPENING_PULSE_MS);
    }

    function mountPanelIframe() {
      if (panel.querySelector('iframe')) return;
      const iframe = document.createElement('iframe');
      iframe.allow = 'clipboard-read; clipboard-write';
      iframe.src = chrome.runtime.getURL('src/sidepanel.html?floating=1');
      panel.replaceChildren(iframe);
    }

    function unmountPanelIframe() {
      panel.replaceChildren();
    }

    function setOpened(next, source = 'content-script') {
      const wasOpened = opened;
      opened = !!next;

      if (opened) mountPanelIframe();

      panel.classList.toggle('open', opened);
      cat.classList.toggle('panel-open', opened);

      if (opened && !wasOpened) {
        pulseCatOpening();
      }

      if (!opened) {
        if (openingPulseTimer) {
          clearTimeout(openingPulseTimer);
          openingPulseTimer = null;
        }
        cat.classList.remove('panel-opening');
        unmountPanelIframe();
      }

      chrome.runtime.sendMessage({ type: 'SET_FLOATING_WIDGET_STATE', opened, source }).catch(() => {});
    }

    const initialPos = await loadPos();
    positionElements(initialPos);

    function cancelHoverOpen() {
      if (!hoverOpenTimer) return;
      clearTimeout(hoverOpenTimer);
      hoverOpenTimer = null;
    }

    function scheduleHoverOpen() {
      cancelHoverOpen();
      hoverOpenTimer = setTimeout(() => {
        hoverOpenTimer = null;
        setOpened(true, 'hover');
      }, FLOATING.HOVER_OPEN_MS);
    }

    // hover open (close only via click-outside, ESC, drag, or explicit click toggle)
    cat.addEventListener('mouseenter', () => {
      if (dragging || opened) return;
      scheduleHoverOpen();
    });

    // click toggles the floating panel and the debugger relay lifecycle.
    cat.addEventListener('click', (e) => {
      e.preventDefault();
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      const now = Date.now();
      if (now - lastCatClickAt < FLOATING.RAPID_CLICK_SUPPRESS_MS) {
        lastCatClickAt = now;
        return;
      }
      lastCatClickAt = now;
      cancelHoverOpen();
      setOpened(!opened, 'click');
    });

    // click outside -> close
    document.addEventListener(
      'mousedown',
      (e) => {
        if (!opened) return;
        const path = e.composedPath?.() || [];
        if (path.includes(cat) || path.includes(panel) || path.includes(host)) return;
        setOpened(false, 'outside');
      },
      true,
    );

    // ESC -> close
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!opened) return;
      setOpened(false, 'esc');
    });

    // drag move
    cat.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      cat.setPointerCapture(e.pointerId);
      const rect = cat.getBoundingClientRect();
      pointerDown = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: rect.left,
        top: rect.top,
      };
      dragOffset = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    });

    cat.addEventListener('pointermove', (e) => {
      if (!pointerDown || e.pointerId !== pointerDown.id) return;
      const movedX = e.clientX - pointerDown.x;
      const movedY = e.clientY - pointerDown.y;
      const movedEnough = Math.hypot(movedX, movedY) >= FLOATING.DRAG_THRESHOLD;
      if (!dragging && !movedEnough) return;
      if (!dragging) {
        dragging = true;
        cancelHoverOpen();
        suppressNextClick = true;
        setOpened(false, 'drag');
      }
      const pos = {
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      };
      positionElements(pos);
    });

    cat.addEventListener('pointerup', async (e) => {
      if (!pointerDown || e.pointerId !== pointerDown.id) return;
      pointerDown = null;
      if (!dragging) {
        cat.releasePointerCapture(e.pointerId);
        return;
      }
      dragging = false;
      try {
        const rect = cat.getBoundingClientRect();
        await savePos({ x: rect.left, y: rect.top });
      } catch {}
      cat.releasePointerCapture(e.pointerId);
    });

    cat.addEventListener('pointercancel', (e) => {
      pointerDown = null;
      dragging = false;
      try {
        cat.releasePointerCapture(e.pointerId);
      } catch {}
    });

    window.addEventListener('resize', async () => {
      try {
        const rect = cat.getBoundingClientRect();
        positionElements({ x: rect.left, y: rect.top });
      } catch {
        positionElements(getDefaultPos());
      }
    });
  }

  // 页面还没 ready 时，避免 body/html 结构太早变化导致一些站点异常
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initFloatingWidget(), { once: true });
  } else {
    initFloatingWidget();
  }
})();
