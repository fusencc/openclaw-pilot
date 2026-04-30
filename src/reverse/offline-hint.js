// ============================================================
// OpenClaw Copilot - Offline Connection Hint UI (Reverse Engineered)
// Shows a help overlay when the sidepanel detects "Offline" status.
// ============================================================

import { SETTINGS_KEY } from "./adapter.js";

const offlineHintObserver = new MutationObserver(() => {
  const statusPill = document.querySelector(".topbar-status .pill .mono");
  const isOffline = statusPill && statusPill.textContent?.trim() === "Offline";
  const pageTitle = document.querySelector(".content-header .page-title");
  const isChatPage = pageTitle && pageTitle.textContent?.trim() === "Chat";
  const mainContent = document.querySelector("main.content");

  let hint = document.querySelector(".smart-connection-hint");

  if (isOffline && isChatPage && mainContent) {
    if (!hint) {
      hint = document.createElement("div");
      hint.className = "smart-connection-hint";
      mainContent.insertBefore(hint, mainContent.firstChild);
      renderConnectionHint(hint);
    }
  } else if (hint) {
    hint.remove();
  }
});

function renderConnectionHint(container) {
  let settings = {};
  try {
    settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {}

  const gatewayUrl = settings.gatewayUrl || "Not Configured";
  const isDefault =
    gatewayUrl === "ws://127.0.0.1:18789" || gatewayUrl === "ws://localhost:18789";

  container.innerHTML = `
    <div style="
      background: #1a1a2e; color: #e0e0e0; border-radius: 12px;
      padding: 20px; margin: 16px; font-family: system-ui, sans-serif;
      border: 1px solid #2a2a4a;
    ">
      <h3 style="margin:0 0 12px; color:#ff6b6b;">Connection Issue</h3>
      <p style="margin:0 0 8px;">
        Cannot connect to OpenClaw gateway at
        <code style="background:#2a2a4a; padding:2px 6px; border-radius:4px;">${gatewayUrl}</code>
      </p>
      <div style="margin-top:12px; padding:12px; background:#2a2a4a; border-radius:8px;">
        <strong>Troubleshooting:</strong>
        <ol style="margin:8px 0 0; padding-left:20px; line-height:1.8;">
          <li>Make sure OpenClaw is running locally</li>
          <li>Check that the gateway URL is correct in settings</li>
          ${isDefault ? "<li>Default port 18789 — verify it's not blocked</li>" : ""}
          <li>Try restarting the OpenClaw service</li>
        </ol>
      </div>
    </div>
  `;
}

// Start observing DOM for status changes
offlineHintObserver.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true,
});

export { offlineHintObserver };
