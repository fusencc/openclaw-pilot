// ============================================================
// OpenClaw Copilot - Gateway WebSocket RPC Client (Reverse Engineered)
// Core communication layer between sidepanel UI and OpenClaw gateway.
// ============================================================

const CLOSE_CODE_CONNECT_FAILED = 4008;

class GatewayClient {
  constructor(opts) {
    this.opts = opts;               // { url, token, password, clientName, clientVersion, platform, mode, instanceId, onClose, onHello, onEvent, onGap }
    this.ws = null;
    this.pending = new Map();       // requestId -> { resolve, reject }
    this.closed = false;
    this.lastSeq = null;            // last event sequence number (gap detection)
    this.connectNonce = null;       // nonce from connect.challenge
    this.connectSent = false;
    this.connectTimer = null;
    this.backoffMs = 800;
    this.pendingDeviceTokenRetry = false;
    this.deviceTokenRetryBudgetUsed = false;
  }

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.pendingConnectError = undefined;
    this.pendingDeviceTokenRetry = false;
    this.deviceTokenRetryBudgetUsed = false;
    this.flushPending(new Error("gateway client stopped"));
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect() {
    if (this.closed) return;

    this.ws = new WebSocket(this.opts.url);

    this.ws.addEventListener("open", () => this.queueConnect());

    this.ws.addEventListener("message", (evt) => {
      this.handleMessage(String(evt.data ?? ""));
    });

    this.ws.addEventListener("close", (evt) => {
      const reason = String(evt.reason ?? "");
      const savedConnectError = this.pendingConnectError;
      this.pendingConnectError = undefined;
      this.ws = null;
      this.flushPending(new Error(`gateway closed (${evt.code}): ${reason}`));
      this.opts.onClose?.({ code: evt.code, reason, error: savedConnectError });
      this.scheduleReconnect();
    });

    this.ws.addEventListener("error", () => {});
  }

  scheduleReconnect() {
    if (this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15000);
    window.setTimeout(() => this.connect(), delay);
  }

  flushPending(err) {
    for (const [, handler] of this.pending) handler.reject(err);
    this.pending.clear();
  }

  // --- Gateway Connect Handshake ---

  queueConnect() {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer);
    this.connectTimer = window.setTimeout(() => {
      this.sendConnect();
    }, 750);
  }

  async sendConnect() {
    if (this.connectSent) return;
    this.connectSent = true;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    const hasCrypto = typeof crypto !== "undefined" && !!crypto.subtle;
    const scopes = ["operator.admin", "operator.approvals", "operator.pairing"];
    const role = "operator";

    const token = this.opts.token?.trim() || undefined;
    const auth = token || this.opts.password
      ? { token, password: this.opts.password }
      : undefined;

    const connectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: this.opts.clientName ?? "control-ui",
        version: this.opts.clientVersion ?? "control-ui",
        platform: this.opts.platform ?? navigator.platform ?? "web",
        mode: this.opts.mode ?? "webchat",
        instanceId: this.opts.instanceId,
      },
      role,
      scopes,
      caps: ["tool-events"],
      auth,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    };

    this.request("connect", connectParams)
      .then((response) => {
        this.pendingDeviceTokenRetry = false;
        this.deviceTokenRetryBudgetUsed = false;
        this.backoffMs = 800;
        this.opts.onHello?.(response);
      })
      .catch((err) => {
        this.pendingConnectError = {
          code: err.gatewayCode ?? "UNKNOWN",
          message: err.message,
          details: err.details,
        };
        this.ws?.close(CLOSE_CODE_CONNECT_FAILED, "connect failed");
      });
  }

  // --- Message Handling ---

  handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Event messages (including connect.challenge)
    if (msg.type === "event") {
      if (msg.event === "connect.challenge") {
        const nonce = msg.payload?.nonce;
        if (typeof nonce === "string") {
          this.connectNonce = nonce;
          this.sendConnect();
        }
        return;
      }

      // Sequence gap detection
      const seq = typeof msg.seq === "number" ? msg.seq : null;
      if (seq !== null) {
        if (this.lastSeq !== null && seq > this.lastSeq + 1) {
          this.opts.onGap?.({ expected: this.lastSeq + 1, received: seq });
        }
        this.lastSeq = seq;
      }

      try { this.opts.onEvent?.(msg); } catch (err) {
        console.error("[gateway] event handler error:", err);
      }
      return;
    }

    // Response to a pending request
    if (msg.type === "res") {
      const handler = this.pending.get(msg.id);
      if (!handler) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        handler.resolve(msg.payload);
      } else {
        handler.reject(new GatewayError({
          code: msg.error?.code ?? "UNAVAILABLE",
          message: msg.error?.message ?? "request failed",
          details: msg.error?.details,
        }));
      }
      return;
    }
  }

  // --- Send RPC Request ---

  request(method, params) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = crypto.randomUUID();
    const message = { type: "req", id, method, params };
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (val) => resolve(val), reject });
    });
    this.ws.send(JSON.stringify(message));
    return promise;
  }
}

// --- Gateway Error ---

class GatewayError extends Error {
  constructor({ code, message, details }) {
    super(message);
    this.gatewayCode = code;
    this.details = details;
  }
}

// --- Known Error Codes ---

const GatewayErrorCodes = {
  AUTH_TOKEN_MISMATCH: "AUTH_TOKEN_MISMATCH",
  AUTH_RATE_LIMITED: "AUTH_RATE_LIMITED",
  AUTH_UNAUTHORIZED: "AUTH_UNAUTHORIZED",
  AUTH_DEVICE_TOKEN_MISMATCH: "AUTH_DEVICE_TOKEN_MISMATCH",
};

export { GatewayClient, GatewayError, GatewayErrorCodes, CLOSE_CODE_CONNECT_FAILED };
