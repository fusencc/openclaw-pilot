// ============================================================
// OpenClaw Copilot - RPC API Method Reference (Reverse Engineered)
// Complete list of all JSON-RPC methods the sidepanel calls
// via GatewayClient.request(method, params).
// ============================================================

const RPC_METHODS = {
  // --- Connection & System ---
  "connect":                  "Gateway handshake (minProtocol, maxProtocol, client, role, scopes, auth)",
  "status":                   "Get gateway status",
  "health":                   "Health check",
  "last-heartbeat":           "Get last heartbeat timestamp",
  "system-presence":          "Get system presence info",

  // --- Chat ---
  "chat.history":             "Fetch chat history (sessionKey, limit)",
  "chat.send":                "Send chat message (sessionKey, text, attachments)",

  // --- Sessions ---
  "sessions.list":            "List active sessions",
  "sessions.patch":           "Update session metadata",
  "sessions.delete":          "Delete a session",
  "sessions.usage.logs":      "Get session usage logs",
  "sessions.usage.timeseries":"Get session usage timeseries data",

  // --- Agents ---
  "agents.list":              "List all agents",
  "agent.identity.get":       "Get agent identity (agentId)",
  "agents.files.list":        "List agent files",
  "agents.files.get":         "Get agent file content",
  "agents.files.set":         "Set agent file content",

  // --- Models ---
  "models.list":              "List available AI models",

  // --- Config ---
  "config.get":               "Get current configuration",
  "config.schema":            "Get configuration JSON schema",
  "config.set":               "Set configuration (raw, baseHash)",
  "config.apply":             "Apply configuration changes",

  // --- Cron / Scheduled Tasks ---
  "cron.status":              "Get cron system status",
  "cron.list":                "List cron jobs",
  "cron.add":                 "Add a cron job",
  "cron.update":              "Update a cron job",
  "cron.remove":              "Remove a cron job",
  "cron.run":                 "Manually trigger a cron job (id, mode)",
  "cron.runs":                "Get cron run history",

  // --- Skills ---
  "skills.status":            "Get skills status (agentId)",
  "skills.update":            "Update skill (skillKey, enabled/apiKey)",
  "skills.install":           "Install a skill",

  // --- Tools ---
  "tools.catalog":            "Get tools catalog",

  // --- Channels (WhatsApp, etc.) ---
  "channels.status":          "Get channel connection status (probe, timeoutMs)",
  "channels.logout":          "Logout from a channel (channel)",
  "web.login.start":          "Start WhatsApp web login (force, timeoutMs)",
  "web.login.wait":           "Wait for WhatsApp login completion (timeoutMs)",

  // --- Device Pairing ---
  "device.pair.list":         "List pending device pair requests",
  "device.pair.approve":      "Approve device pairing (requestId)",
  "device.pair.reject":       "Reject device pairing (requestId)",
  "device.token.rotate":      "Rotate device token",
  "device.token.revoke":      "Revoke device token",

  // --- Exec ---
  "exec.approval.resolve":    "Resolve an execution approval request",

  // --- Logs ---
  "logs.tail":                "Tail logs (level, limit)",

  // --- Nodes ---
  "node.list":                "List connected nodes",

  // --- Updates ---
  "update.run":               "Run update (sessionKey)",
};

export { RPC_METHODS };
