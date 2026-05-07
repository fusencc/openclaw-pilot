// OpenClaw Smart Read - Content Script (floating variant)
// This file mirrors the extraction logic in content-script.js.

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
  '#detail-desc', '.note-content', '.content-container',
  '[data-note-content]', '.feed-item__content',
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_PAGE_CONTENT') {
    sendResponse(extractPageContent());
  }
  return false;
});
