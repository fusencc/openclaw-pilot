// ============================================================
// OpenClaw Copilot - Adapter Layer (Reverse Engineered)
// Injected at sidepanel startup to configure gateway connection.
// ============================================================

const SETTINGS_KEY = "openclaw.control.settings.v1";
const OLD_EXTENSION_ID = "mehnffpdgfjnndhhjabklokbpfedkemd";
const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const DEFAULT_TOKEN = "8be19321634a56d832bb89e93379c3860";
const DEFAULT_SESSION_KEY = "agent:main:main";

// Override base path for the embedded Control UI
window.__OPENCLAW_CONTROL_UI_BASE_PATH__ = "http://localhost:3000";

// Patch history.pushState (SPA routing compatibility)
const originalPushState = history.pushState;
history.pushState = function (state, title, url) {
  return originalPushState.apply(this, [state, title, url]);
};

// Load or initialize settings from localStorage
let settings = {};
try {
  settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
} catch {}

// Force chat focus mode off
settings.chatFocusMode = false;

// Set default gateway URL if missing or pointing to old extension
if (
  !settings.gatewayUrl ||
  settings.gatewayUrl.startsWith("ws://chrome-extension") ||
  settings.gatewayUrl.includes(OLD_EXTENSION_ID)
) {
  settings.gatewayUrl = DEFAULT_GATEWAY_URL;
}

// Set default token if missing
if (!settings.token) {
  settings.token = DEFAULT_TOKEN;
}

// Set default session key if missing
if (!settings.sessionKey || settings.sessionKey === "main") {
  settings.sessionKey = DEFAULT_SESSION_KEY;
}

// Persist injected settings
localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
console.log("OpenClaw Adapter: Settings injected", settings);

export { SETTINGS_KEY, settings };
