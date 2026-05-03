// ============================================================
// OpenClaw Copilot - Background Service Worker (Reverse Engineered)
// CDP Relay Bridge: forwards Chrome DevTools Protocol between
// local OpenClaw relay server and browser tabs.
// ============================================================

// --- Utility: Exponential Backoff ---
function calculateBackoff(
  attempt,
  { baseMs = 1000, maxMs = 30000, jitterMs = 1000, random = Math.random } = {},
) {
  const base = Number.isFinite(baseMs) ? baseMs : 1000;
  const max = Number.isFinite(maxMs) ? maxMs : 30000;
  const jitter = Number.isFinite(jitterMs) ? jitterMs : 1000;
  const rng = typeof random === "function" ? random : Math.random;
  const safeAttempt = Math.max(0, Number.isFinite(attempt) ? attempt : 0);
  return Math.min(base * 2 ** safeAttempt, max) + Math.max(0, jitter) * rng();
}

// --- Utility: HMAC-SHA256 Token Signing ---
async function hmacSign(token, port) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`openclaw-extension-relay-v1:${port}`),
  );
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Utility: Build WebSocket URL with HMAC token ---
async function buildRelayWsUrl(port, gatewayToken) {
  const token = String(gatewayToken || "").trim();
  if (!token)
    throw new Error(
      "Missing gatewayToken in extension settings (chrome.storage.local.gatewayToken)",
    );
  const hmac = await hmacSign(token, port);
  return `ws://127.0.0.1:${port}/extension?token=${encodeURIComponent(hmac)}`;
}

// --- Utility: Error classification ---
function isTokenMissingError(err) {
  return !(err instanceof Error ? err.message : String(err || "")).includes(
    "Missing gatewayToken",
  );
}

function isTabNotFoundError(err) {
  const msg = (err instanceof Error ? err.message : String(err || "")).toLowerCase();
  return (
    msg.includes("no tab with id") ||
    msg.includes("no tab with given id") ||
    msg.includes("tab not found")
  );
}

function isLastTab(tabs, excludeTabId) {
  return Array.isArray(tabs)
    ? tabs.filter((t) => t && t.id !== excludeTabId).length === 0
    : true;
}

// --- Constants ---
const DEFAULT_ORIGIN_RULES = [
  {
    id: 901,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "Origin", operation: "set", value: "http://127.0.0.1:18789" },
      ],
    },
    condition: {
      urlFilter: "|ws://127.0.0.1:18789/*",
      resourceTypes: ["websocket"],
    },
  },
  {
    id: 902,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "Origin", operation: "set", value: "http://127.0.0.1:18792" },
      ],
    },
    condition: {
      urlFilter: "|ws://127.0.0.1:18792/*",
      resourceTypes: ["websocket"],
    },
  },
];

const DEFAULT_RELAY_PORT = 18792;

const BADGE_STATES = {
  on: { text: "ON", color: "#FF5A36" },
  off: { text: "", color: "#000000" },
  connecting: { text: "…", color: "#F59E0B" },
  error: { text: "!", color: "#B91C1C" },
};

// --- State ---
let relaySocket = null;           // current WebSocket to relay
let connectPromise = null;        // pending connection promise (dedup)
let currentGatewayToken = "";     // token used for current connection
let pendingConnectId = null;      // id of pending gateway connect handshake
let sessionCounter = 1;           // monotonic session id counter

const attachedTabs = new Map();   // tabId -> { state, sessionId, targetId, attachOrder }
const sessionToTab = new Map();   // sessionId -> tabId (main targets)
const childSessionToTab = new Map(); // child sessionId -> tabId
const pendingRequests = new Map(); // requestId -> { resolve, reject }
const toggleLock = new Set();     // tabIds currently being toggled
const reattachingTabs = new Set(); // tabIds currently re-attaching after navigation

let reconnectAttempt = 0;
let reconnectTimer = null;

const DEBUGGER_RETRY_COUNT = 2;
const DEBUGGER_RETRY_DELAY = 1000;

// --- Utility helpers ---
function getStackTrace() {
  try { return new Error().stack || ""; } catch { return ""; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Tab health check via debugger ---
async function isTabAlive(tabId) {
  try { await chrome.tabs.get(tabId); } catch { return false; }
  for (let attempt = 0; attempt < DEBUGGER_RETRY_COUNT; attempt++) {
    try {
      await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: "1",
        returnByValue: true,
      });
      return true;
    } catch (err) {
      if (isTabNotFoundError(err)) return false;
      if (attempt < DEBUGGER_RETRY_COUNT - 1) await sleep(DEBUGGER_RETRY_DELAY);
    }
  }
  return false;
}

// --- Settings helpers ---
async function getRelayPort() {
  const data = await chrome.storage.local.get(["relayPort"]);
  const port = Number.parseInt(String(data.relayPort || ""), 10);
  return !Number.isFinite(port) || port <= 0 || port > 65535
    ? DEFAULT_RELAY_PORT
    : port;
}

async function getGatewayToken() {
  const data = await chrome.storage.local.get(["gatewayToken"]);
  return String(data.gatewayToken || "").trim() || "";
}

// --- Badge UI ---
function setBadge(tabId, state) {
  const badge = BADGE_STATES[state];
  chrome.action.setBadgeText({ tabId, text: badge.text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
  chrome.action.setBadgeTextColor({ tabId, color: "#FFFFFF" }).catch(() => {});
}

// --- Broadcast relay status to sidepanel ---
function broadcastRelayStatus(connected) {
  chrome.runtime
    .sendMessage({ type: "RELAY_STATUS", connected })
    .catch(() => {});
}

function broadcastRuntimeMessage(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }).catch(() => {});
}

function broadcastSidepanelVisibility(visible) {
  broadcastRuntimeMessage({ type: "SIDEPANEL_VISIBILITY", visible });
}

function broadcastFloatingWidgetState(payload = {}) {
  broadcastRuntimeMessage({ type: "FLOATING_WIDGET_STATE", ...payload });
}

// --- Persist / restore attached tabs across SW restarts ---
async function persistAttachedTabs() {
  try {
    const tabs = [];
    for (const [tabId, info] of attachedTabs.entries()) {
      if (info.state === "connected" && info.sessionId && info.targetId) {
        tabs.push({
          tabId,
          sessionId: info.sessionId,
          targetId: info.targetId,
          attachOrder: info.attachOrder,
        });
      }
    }
    await chrome.storage.session.set({ persistedTabs: tabs, nextSession: sessionCounter });
  } catch {}
}

async function restorePersistedTabs() {
  try {
    const data = await chrome.storage.session.get(["persistedTabs", "nextSession"]);
    if (data.nextSession) sessionCounter = Math.max(sessionCounter, data.nextSession);
    const tabs = data.persistedTabs || [];
    for (const tab of tabs) {
      attachedTabs.set(tab.tabId, {
        state: "connected",
        sessionId: tab.sessionId,
        targetId: tab.targetId,
        attachOrder: tab.attachOrder,
      });
      sessionToTab.set(tab.sessionId, tab.tabId);
      setBadge(tab.tabId, "on");
    }
    for (const tab of tabs) {
      if (!(await isTabAlive(tab.tabId))) {
        attachedTabs.delete(tab.tabId);
        sessionToTab.delete(tab.sessionId);
        setBadge(tab.tabId, "off");
      }
    }
  } catch {}
}

// ============================================================
// WebSocket Relay Connection
// ============================================================

async function connectToRelay() {
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) return;
  if (connectPromise) return await connectPromise;

  connectPromise = (async () => {
    const port = await getRelayPort();
    const token = await getGatewayToken();
    const httpBase = `http://127.0.0.1:${port}`;
    const wsUrl = await buildRelayWsUrl(port, token);

    // Update dynamic origin rule for this relay endpoint
    try {
      const urlObj = new URL(wsUrl);
      const originValue = urlObj.protocol === "wss:"
        ? `https://${urlObj.host}`
        : `http://${urlObj.host}`;
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [100],
        addRules: [{
          id: 100, priority: 1,
          action: { type: "modifyHeaders", requestHeaders: [{ header: "Origin", operation: "set", value: originValue }] },
          condition: { urlFilter: `|${urlObj.protocol === "wss:" ? "wss" : "ws"}://${urlObj.host}/*`, resourceTypes: ["websocket"] },
        }],
      });
      await new Promise((r) => setTimeout(r, 100));
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      console.log("[OpenClaw Ext] Dynamic rules updated:", rules);
    } catch (err) {
      console.warn("Failed to set dynamic origin rule:", err);
    }

    // Health check: is relay reachable?
    try {
      await fetch(`${httpBase}/`, { method: "HEAD", signal: AbortSignal.timeout(2000) });
    } catch (err) {
      throw new Error(`Relay server not reachable at ${httpBase} (${String(err)})`);
    }

    // Open WebSocket
    const ws = new WebSocket(wsUrl);
    relaySocket = ws;
    currentGatewayToken = token;

    ws.onmessage = (evt) => {
      if (ws === relaySocket) runAfterInit(() => handleRelayMessage(String(evt.data || "")));
    };

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket connect timeout")), 5000);
      ws.onopen = () => { clearTimeout(timeout); resolve(); };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error("WebSocket connect failed")); };
      ws.onclose = (evt) => { clearTimeout(timeout); reject(new Error(`WebSocket closed (${evt.code} ${evt.reason || "no reason"})`)); };
    });

    ws.onclose = () => { if (ws === relaySocket) onRelayDisconnect("closed"); };
    ws.onerror = () => { if (ws === relaySocket) onRelayDisconnect("error"); };
  })();

  try {
    await connectPromise;
    reconnectAttempt = 0;
  } finally {
    connectPromise = null;
  }
}

// ============================================================
// Disconnect / Reconnect
// ============================================================

function onRelayDisconnect(reason) {
  relaySocket = null;
  currentGatewayToken = "";
  pendingConnectId = null;

  for (const [id, req] of pendingRequests.entries()) {
    pendingRequests.delete(id);
    req.reject(new Error(`Relay disconnected (${reason})`));
  }
  reattachingTabs.clear();

  for (const [tabId, info] of attachedTabs.entries()) {
    if (info.state === "connected") {
      setBadge(tabId, "connecting");
      chrome.action.setTitle({ tabId, title: "OpenClaw Browser Relay: relay reconnecting…" });
    }
  }
  scheduleReconnect();
  broadcastRelayStatus(false);
}

function scheduleReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const delay = calculateBackoff(reconnectAttempt);
  reconnectAttempt++;
  console.log(`Scheduling reconnect attempt ${reconnectAttempt} in ${Math.round(delay)}ms`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await connectToRelay();
      reconnectAttempt = 0;
      console.log("Reconnected successfully");
      await reannounceAllTabs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Reconnect attempt ${reconnectAttempt} failed: ${msg}`);
      if (!isTokenMissingError(err)) return;
      scheduleReconnect();
    }
  }, delay);
}

function cancelReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempt = 0;
}

// ============================================================
// Re-announce attached tabs after reconnect
// ============================================================

async function reannounceAllTabs() {
  for (const [tabId, info] of attachedTabs.entries()) {
    if (info.state !== "connected" || !info.sessionId || !info.targetId) continue;

    if (!(await isTabAlive(tabId))) {
      attachedTabs.delete(tabId);
      if (info.sessionId) sessionToTab.delete(info.sessionId);
      setBadge(tabId, "off");
      chrome.action.setTitle({ tabId, title: "OpenClaw Browser Relay (click to attach/detach)" });
      continue;
    }

    let targetInfo;
    try {
      targetInfo = (await chrome.debugger.sendCommand({ tabId }, "Target.getTargetInfo"))?.targetInfo;
    } catch {
      targetInfo = info.targetId ? { targetId: info.targetId } : undefined;
    }

    try {
      sendToRelay({
        method: "forwardCDPEvent",
        params: {
          method: "Target.attachedToTarget",
          params: { sessionId: info.sessionId, targetInfo: { ...targetInfo, attached: true }, waitingForDebugger: false },
        },
      });
      setBadge(tabId, "on");
      chrome.action.setTitle({ tabId, title: "OpenClaw Browser Relay: attached (click to detach)" });
    } catch {
      setBadge(tabId, "connecting");
      chrome.action.setTitle({ tabId, title: "OpenClaw Browser Relay: relay reconnecting…" });
    }
  }
  await persistAttachedTabs();
}

// ============================================================
// Send message to relay WebSocket
// ============================================================

function sendToRelay(msg) {
  const ws = relaySocket;
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("Relay not connected");
  ws.send(JSON.stringify(msg));
}

// ============================================================
// Gateway Connect Handshake
// ============================================================

function startGatewayHandshake(payload) {
  if (pendingConnectId) return;
  const nonce = typeof payload?.nonce === "string" ? payload.nonce.trim() : "";
  pendingConnectId = `ext-connect-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  sendToRelay({
    type: "req",
    id: pendingConnectId,
    method: "connect",
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: "chrome-relay-extension", version: "1.0.0", platform: "chrome-extension", mode: "webchat" },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      caps: [],
      commands: [],
      nonce: nonce || undefined,
      auth: currentGatewayToken ? { token: currentGatewayToken } : undefined,
    },
  });
}

// ============================================================
// Show help page on first error
// ============================================================

async function showHelpOnFirstError() {
  try {
    if ((await chrome.storage.local.get(["helpOnErrorShown"])).helpOnErrorShown === true) return;
    await chrome.storage.local.set({ helpOnErrorShown: true });
    await chrome.runtime.openOptionsPage();
  } catch {}
}

// ============================================================
// Relay Message Handler
// ============================================================

async function handleRelayMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  // Gateway connect challenge
  if (msg && msg.type === "event" && msg.event === "connect.challenge") {
    try {
      startGatewayHandshake(msg.payload);
    } catch (err) {
      console.warn("gateway connect handshake start failed", err instanceof Error ? err.message : String(err));
      pendingConnectId = null;
      const ws = relaySocket;
      if (ws && ws.readyState === WebSocket.OPEN) ws.close(1008, "gateway connect failed");
    }
    return;
  }

  // Gateway connect response
  if (msg && msg.type === "res" && pendingConnectId && msg.id === pendingConnectId) {
    pendingConnectId = null;
    if (!msg.ok) {
      const errMsg = msg?.error?.message || msg?.error || "gateway connect failed";
      console.warn("gateway connect handshake rejected", String(errMsg));
      const ws = relaySocket;
      if (ws && ws.readyState === WebSocket.OPEN) ws.close(1008, "gateway connect failed");
    }
    return;
  }

  // Ping/pong keepalive
  if (msg && msg.method === "ping") {
    try { sendToRelay({ method: "pong" }); } catch {}
    return;
  }

  // Response to a pending request we sent
  if (msg && typeof msg.id === "number" && (msg.result !== undefined || msg.error !== undefined)) {
    const pending = pendingRequests.get(msg.id);
    if (!pending) return;
    pendingRequests.delete(msg.id);
    msg.error ? pending.reject(new Error(String(msg.error))) : pending.resolve(msg.result);
    return;
  }

  // CDP command forwarded from relay -> execute in browser
  if (msg && typeof msg.id === "number" && msg.method === "forwardCDPCommand") {
    try {
      const result = await executeCDPCommand(msg);
      sendToRelay({ id: msg.id, result });
    } catch (err) {
      sendToRelay({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

// ============================================================
// Session / Target Resolution
// ============================================================

function resolveSessionToTab(sessionId) {
  const tabId = sessionToTab.get(sessionId);
  if (tabId) return { tabId, kind: "main" };
  const childTabId = childSessionToTab.get(sessionId);
  return childTabId ? { tabId: childTabId, kind: "child" } : null;
}

function findTabByTargetId(targetId) {
  for (const [tabId, info] of attachedTabs.entries()) {
    if (info.targetId === targetId) return tabId;
  }
  return null;
}

// ============================================================
// Attach / Detach Debugger to Tab
// ============================================================

async function attachDebuggerToTab(tabId, options = {}) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  await chrome.debugger.sendCommand(target, "Page.enable").catch(() => {});

  const targetInfo = (await chrome.debugger.sendCommand(target, "Target.getTargetInfo"))?.targetInfo;
  const targetId = String(targetInfo?.targetId || "").trim();
  if (!targetId) throw new Error("Target.getTargetInfo returned no targetId");

  const order = sessionCounter++;
  const sessionId = `cb-tab-${order}`;

  attachedTabs.set(tabId, { state: "connected", sessionId, targetId, attachOrder: order });
  sessionToTab.set(sessionId, tabId);
  chrome.action.setTitle({ tabId, title: "OpenClaw Browser Relay: attached (click to detach)" });

  if (!options.skipAttachedEvent) {
    sendToRelay({
      method: "forwardCDPEvent",
      params: {
        method: "Target.attachedToTarget",
        params: { sessionId, targetInfo: { ...targetInfo, attached: true }, waitingForDebugger: false },
      },
    });
  }

  setBadge(tabId, "on");
  await persistAttachedTabs();
  broadcastRelayStatus(true);
  return { sessionId, targetId };
}

async function detachDebuggerFromTab(tabId, reason) {
  const info = attachedTabs.get(tabId);

  // Notify relay about child sessions being detached
  for (const [sid, tid] of childSessionToTab.entries()) {
    if (tid === tabId) {
      try {
        sendToRelay({
          method: "forwardCDPEvent",
          params: { method: "Target.detachedFromTarget", params: { sessionId: sid, reason: "parent_detached" } },
        });
      } catch {}
      childSessionToTab.delete(sid);
    }
  }

  // Notify relay about main session detach
  if (info?.sessionId && info?.targetId) {
    try {
      sendToRelay({
        method: "forwardCDPEvent",
        params: { method: "Target.detachedFromTarget", params: { sessionId: info.sessionId, targetId: info.targetId, reason } },
      });
    } catch {}
  }

  if (info?.sessionId) sessionToTab.delete(info.sessionId);
  attachedTabs.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch {}

  setBadge(tabId, "off");
  chrome.action.setTitle({ tabId, title: "OpenClaw Browser Relay (click to attach/detach)" });
  broadcastRelayStatus(false);
  await persistAttachedTabs();
}

// ============================================================
// Toggle Relay (attach/detach active tab)
// ============================================================

async function toggleRelayOnActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = activeTab?.id;
  if (!tabId || toggleLock.has(tabId)) return;

  toggleLock.add(tabId);
  try {
    // If tab is mid-reattach, cancel it
    if (reattachingTabs.has(tabId)) {
      reattachingTabs.delete(tabId);
      setBadge(tabId, "off");
      chrome.action.setTitle({ tabId, title: "OpenClaw Browser Relay (click to attach/detach)" });
      return;
    }

    // If already connected, detach
    if (attachedTabs.get(tabId)?.state === "connected") {
      await detachDebuggerFromTab(tabId, "toggle");
      return;
    }

    // Otherwise, attach
    cancelReconnect();
    attachedTabs.set(tabId, { state: "connecting" });
    setBadge(tabId, "connecting");
    chrome.action.setTitle({ tabId, title: "OpenClaw Browser Relay: connecting to local relay…" });

    try {
      await connectToRelay();
      await attachDebuggerToTab(tabId);
    } catch (err) {
      attachedTabs.delete(tabId);
      setBadge(tabId, "error");
      chrome.action.setTitle({ tabId, title: "OpenClaw Browser Relay: relay not running (open options for setup)" });
      showHelpOnFirstError();
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("attach failed", msg, getStackTrace());
      broadcastRelayStatus(false);
    }
  } finally {
    toggleLock.delete(tabId);
  }
}

// ============================================================
// Execute CDP Command (forwarded from relay)
// ============================================================

async function executeCDPCommand(msg) {
  const method = String(msg?.params?.method || "").trim();
  const params = msg?.params?.params || undefined;
  const sessionId = typeof msg?.params?.sessionId === "string" ? msg.params.sessionId : undefined;
  const resolved = sessionId ? resolveSessionToTab(sessionId) : null;
  const targetIdParam = typeof params?.targetId === "string" ? params.targetId : undefined;

  const tabId =
    resolved?.tabId ||
    (targetIdParam ? findTabByTargetId(targetIdParam) : null) ||
    (() => {
      for (const [tid, info] of attachedTabs.entries()) {
        if (info.state === "connected") return tid;
      }
      return null;
    })();

  if (!tabId) throw new Error(`No attached tab for method ${method}`);
  const target = { tabId };

  // Special handling: Runtime.enable (reset first to avoid stale state)
  if (method === "Runtime.enable") {
    try {
      await chrome.debugger.sendCommand(target, "Runtime.disable");
      await new Promise((r) => setTimeout(r, 50));
    } catch {}
    return await chrome.debugger.sendCommand(target, "Runtime.enable", params);
  }

  // Special handling: Target.createTarget (open new tab)
  if (method === "Target.createTarget") {
    const url = typeof params?.url === "string" ? params.url : "about:blank";
    const newTab = await chrome.tabs.create({ url, active: false });
    if (!newTab.id) throw new Error("Failed to create tab");
    await new Promise((r) => setTimeout(r, 100));
    return { targetId: (await attachDebuggerToTab(newTab.id)).targetId };
  }

  // Special handling: Target.closeTarget
  if (method === "Target.closeTarget") {
    const tid = typeof params?.targetId === "string" ? params.targetId : "";
    const closeTabId = tid ? findTabByTargetId(tid) : tabId;
    if (!closeTabId) return { success: false };
    try {
      const allTabs = await chrome.tabs.query({});
      if (isLastTab(allTabs, closeTabId)) {
        console.warn("Refusing to close the last tab: this would kill the browser process");
        return { success: false, error: "Cannot close the last tab" };
      }
      await chrome.tabs.remove(closeTabId);
    } catch {
      return { success: false };
    }
    return { success: true };
  }

  // Special handling: Target.activateTarget
  if (method === "Target.activateTarget") {
    const tid = typeof params?.targetId === "string" ? params.targetId : "";
    const activateTabId = tid ? findTabByTargetId(tid) : tabId;
    if (!activateTabId) return {};
    const tab = await chrome.tabs.get(activateTabId).catch(() => null);
    if (!tab) return {};
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    await chrome.tabs.update(activateTabId, { active: true }).catch(() => {});
    return {};
  }

  // Generic CDP command passthrough
  const mainSessionId = attachedTabs.get(tabId)?.sessionId;
  const debugTarget = sessionId && mainSessionId && sessionId !== mainSessionId
    ? { ...target, sessionId }
    : target;
  return await chrome.debugger.sendCommand(debugTarget, method, params);
}

// ============================================================
// Chrome Debugger Event Listeners
// ============================================================

function onDebuggerEvent(source, method, params) {
  const tabId = source.tabId;
  if (!tabId) return;
  const info = attachedTabs.get(tabId);
  if (!info?.sessionId) return;

  // Track child target sessions
  if (method === "Target.attachedToTarget" && params?.sessionId) {
    childSessionToTab.set(String(params.sessionId), tabId);
  }
  if (method === "Target.detachedFromTarget" && params?.sessionId) {
    childSessionToTab.delete(String(params.sessionId));
  }

  // Forward all CDP events to relay
  try {
    sendToRelay({
      method: "forwardCDPEvent",
      params: {
        method: "Target.attachedToTarget",
        params: { sessionId: source.sessionId || info.sessionId, method, params },
      },
    });
  } catch {}
}

// ============================================================
// Debugger Detach Handler (navigation, user cancel, devtools)
// ============================================================

async function onDebuggerDetach(source, reason) {
  const tabId = source.tabId;
  if (!tabId || !attachedTabs.has(tabId)) return;

  // User cancelled or opened devtools — clean detach
  if (reason === "canceled_by_user" || reason === "replaced_with_devtools") {
    detachDebuggerFromTab(tabId, reason);
    return;
  }

  // Check if tab still exists
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { detachDebuggerFromTab(tabId, reason); return; }

  // Don't reattach chrome:// or extension pages
  if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
    detachDebuggerFromTab(tabId, reason);
    return;
  }

  // Already reattaching
  if (reattachingTabs.has(tabId)) return;

  // Clean up old session state
  const oldInfo = attachedTabs.get(tabId);
  const oldSessionId = oldInfo?.sessionId;
  const oldTargetId = oldInfo?.targetId;
  if (oldSessionId) sessionToTab.delete(oldSessionId);
  attachedTabs.delete(tabId);
  for (const [sid, tid] of childSessionToTab.entries()) {
    if (tid === tabId) childSessionToTab.delete(sid);
  }

  // Notify relay of detach
  if (oldSessionId && oldTargetId) {
    try {
      sendToRelay({
        method: "forwardCDPEvent",
        params: { method: "Target.detachedFromTarget", params: { sessionId: oldSessionId, targetId: oldTargetId, reason: "navigation-reattach" } },
      });
    } catch {}
  }

  // Begin reattach with exponential delays
  reattachingTabs.add(tabId);
  setBadge(tabId, "connecting");
  chrome.action.setTitle({ tabId, title: "OpenClaw Browser Relay: re-attaching after navigation…" });

  const delays = [200, 500, 1000, 2000, 4000];
  for (let i = 0; i < delays.length; i++) {
    await new Promise((r) => setTimeout(r, delays[i]));
    if (!reattachingTabs.has(tabId)) return;
    try { await chrome.tabs.get(tabId); } catch { reattachingTabs.delete(tabId); setBadge(tabId, "off"); return; }
    if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
      try {
        await attachDebuggerToTab(tabId, { skipAttachedEvent: false });
        reattachingTabs.delete(tabId);
        return;
      } catch {}
    }
  }
  reattachingTabs.delete(tabId);
  setBadge(tabId, "off");
}

// ============================================================
// Register Event Listeners
// ============================================================

chrome.debugger.onEvent.addListener((...args) => { runAfterInit(() => onDebuggerEvent(...args)); });
chrome.debugger.onDetach.addListener((...args) => { runAfterInit(() => onDebuggerDetach(...args)); });

chrome.webNavigation.onCompleted.addListener(({ tabId, frameId }) => {
  runAfterInit(() => {
    if (frameId !== 0) return;
    if (attachedTabs.get(tabId)?.state === "connected") {
      setBadge(tabId, relaySocket && relaySocket.readyState === WebSocket.OPEN ? "on" : "connecting");
    }
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  runAfterInit(() => {
    if (attachedTabs.get(tabId)?.state === "connected") {
      setBadge(tabId, relaySocket && relaySocket.readyState === WebSocket.OPEN ? "on" : "connecting");
    }
  });
});

// ============================================================
// Extension Install / Startup
// ============================================================

async function registerDefaultOriginRules() {
  try {
    chrome.runtime.setUninstallURL("https://tally.so/r/pbBBWE").catch((e) => console.debug("Set uninstall URL failed", e));
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [901, 902], addRules: DEFAULT_ORIGIN_RULES });
    console.log("[OpenClaw Ext] Default origin rules (18789, 18792) registered.");
  } catch (err) {
    console.warn("[OpenClaw Ext] Failed to register default rules:", err);
  }
}

chrome.runtime.onInstalled.addListener(registerDefaultOriginRules);
chrome.runtime.onStartup.addListener(registerDefaultOriginRules);
registerDefaultOriginRules();

chrome.runtime.onInstalled.addListener(() => { chrome.runtime.openOptionsPage(); });

// ============================================================
// Keepalive Alarm (every 30s)
// ============================================================

chrome.alarms.create("relay-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "relay-keepalive" && (await initPromise, attachedTabs.size !== 0)) {
    for (const [tabId, info] of attachedTabs.entries()) {
      if (info.state === "connected") {
        setBadge(tabId, relaySocket && relaySocket.readyState === WebSocket.OPEN ? "on" : "connecting");
      }
    }
    if ((!relaySocket || relaySocket.readyState !== WebSocket.OPEN) && !connectPromise && !reconnectTimer) {
      console.log("Keepalive: WebSocket unhealthy, triggering reconnect");
      await connectToRelay().catch(() => { if (!reconnectTimer) scheduleReconnect(); });
    }
  }
});

// ============================================================
// Initialization
// ============================================================

const initPromise = restorePersistedTabs();
initPromise.then(() => {
  if (attachedTabs.size > 0) {
    connectToRelay()
      .then(() => { reconnectAttempt = 0; return reannounceAllTabs(); })
      .catch(() => { scheduleReconnect(); });
  }
});

async function runAfterInit(fn) {
  await initPromise;
  return fn();
}

// ============================================================
// Message Listener (from sidepanel / popup)
// ============================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "relayCheck") {
    const { url, token } = msg;
    fetch(url, {
      method: "GET",
      headers: token ? { "x-openclaw-relay-token": token } : {},
      signal: AbortSignal.timeout(2000),
    })
      .then(async (res) => {
        const contentType = String(res.headers.get("content-type") || "");
        let json = null;
        if (contentType.includes("application/json")) {
          try { json = await res.json(); } catch { json = null; }
        }
        sendResponse({ status: res.status, ok: res.ok, contentType, json });
      })
      .catch((err) => sendResponse({ status: 0, ok: false, error: String(err) }));
    return true; // async response
  }

  if (msg?.type === "TOGGLE_RELAY") {
    runAfterInit(() => toggleRelayOnActiveTab());
    return false;
  }

  if (msg?.type === "GET_RELAY_STATUS") {
    runAfterInit(() => {
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        let connected = false;
        if (tab?.id) connected = attachedTabs.get(tab.id)?.state === "connected";
        sendResponse({ connected });
        broadcastRelayStatus(connected);
      });
    });
    return true; // async response
  }

  if (msg?.type === "SET_SIDEPANEL_VISIBILITY") {
    const visible = !!msg.visible;
    chrome.storage.session
      .set({ sidepanelVisible: visible })
      .catch(() => {});
    broadcastSidepanelVisibility(visible);
    sendResponse({ ok: true, visible });
    return false;
  }

  if (msg?.type === "GET_SIDEPANEL_VISIBILITY") {
    chrome.storage.session
      .get(["sidepanelVisible"])
      .then((data) => {
        sendResponse({ visible: !!data.sidepanelVisible });
      })
      .catch(() => sendResponse({ visible: false }));
    return true;
  }

  if (msg?.type === "SET_FLOATING_WIDGET_STATE") {
    const opened = !!msg.opened;
    broadcastFloatingWidgetState({ opened, source: msg.source || "content-script" });
    sendResponse({ ok: true, opened });
    return false;
  }

  // 来自悬浮窗 [↗] 按钮：将 sidepanel 主动展开为完整侧边栏。
  // chrome.sidePanel.open 必须在用户手势上下文调用；content-script 转发的消息
  // 满足该条件，但需要显式提供 tabId / windowId 以确保命中正确窗口。
  if (msg?.type === "OPEN_SIDEPANEL") {
    const tabId = sender?.tab?.id;
    const windowId = sender?.tab?.windowId;
    const openOptions = tabId
      ? { tabId }
      : windowId
        ? { windowId }
        : null;
    if (!openOptions || !chrome.sidePanel?.open) {
      sendResponse({ ok: false, error: "no_target" });
      return false;
    }
    chrome.sidePanel
      .open(openOptions)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true; // async response
  }

  // 当 sidepanel 已展开、用户在悬浮窗点 ✦ 总结时，悬浮窗的 iframe 不会被实际渲染，
  // 走传统 postMessage 链路无效；此处把 prompt 直接广播给真正的 sidepanel iframe，
  // 由 read-inject.js 在 sidepanel 模式下兜底接收并自动发送，保证总结能力 100% 可用。
  if (msg?.type === "OPENCLAW_SIDEPANEL_SUMMARY") {
    broadcastRuntimeMessage({
      type: "OPENCLAW_SIDEPANEL_SUMMARY",
      payload: msg.payload || {},
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === "GET_PAGE_CONTENT_FOR_SIDEPANEL") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.id) {
        sendResponse({ error: "No active tab" });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTENT" }, (result) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(result);
        }
      });
    });
    return true; // async response
  }

  return false;
});

// ============================================================
// Side Panel: open on action click
// ============================================================

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.error(err));
