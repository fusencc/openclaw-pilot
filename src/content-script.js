// OpenClaw Smart Read - Content Script
// Extracts page content for AI analysis

const MAX_CONTENT_LENGTH = 12000;

function extractPageContent() {
  const title = document.title || '';
  const url = window.location.href;
  const siteName = window.location.hostname;

  let content = '';

  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.article-content',
    '.entry-content',
    '#content',
    '.content',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 200) {
      content = el.innerText.trim();
      break;
    }
  }

  if (!content || content.length < 200) {
    content = document.body.innerText.trim();
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH) + '\n\n[... content truncated]';
  }

  return { title, url, content, siteName };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_PAGE_CONTENT') {
    sendResponse(extractPageContent());
  }
  return false;
});
