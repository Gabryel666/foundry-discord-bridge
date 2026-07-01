/**
 * Foundry-Discord Bridge Server v2
 * 
 * Discord → Foundry: Polls Discord REST API for new messages, forwards via WebSocket.
 * Foundry → Discord: The Foundry module sends directly via Discord webhook (no server needed).
 * 
 * Uses HTTP polling (GET) which doesn't conflict with Hermes's WebSocket gateway connection.
 * No discord.js dependency — pure HTTP + WebSocket.
 */

const { WebSocketServer } = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('❌ config.json not found. Copy config.example.json and fill in your values.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const DISCORD_API = 'https://discord.com/api/v10';
const BOT_TOKEN = config.discord.token;
const CHANNEL_ID = config.discord.channelId;
const POLL_INTERVAL = config.polling?.intervalMs || 2000;

// ── State ───────────────────────────────────────────────────────────────
const connectedClients = new Set();
let lastMessageId = null;
let pollTimer = null;

// ── Discord REST helpers ────────────────────────────────────────────────
function discordGet(endpoint) {
  return new Promise((resolve, reject) => {
    const url = `${DISCORD_API}${endpoint}`;
    const req = https.get(url, {
      headers: {
        'Authorization': `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
        } else if (res.statusCode === 429) {
          // Rate limited — will retry next poll
          console.warn('⚠️  Discord rate limited, backing off...');
          resolve(null);
        } else {
          reject(new Error(`Discord API ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Poll for new messages ───────────────────────────────────────────────
async function pollMessages() {
  try {
    const query = lastMessageId ? `?after=${lastMessageId}&limit=10` : '?limit=1';
    const messages = await discordGet(`/channels/${CHANNEL_ID}/messages${query}`);

    if (!messages || !Array.isArray(messages) || messages.length === 0) return;

    // Sort oldest first
    messages.sort((a, b) => BigInt(a.id) - BigInt(b.id));

    for (const msg of messages) {
      // Skip bot messages
      if (msg.author.bot) {
        lastMessageId = msg.id;
        continue;
      }

      // Skip if we already saw this (initial load)
      if (!lastMessageId && messages.length === 1) {
        lastMessageId = msg.id;
        continue;
      }

      lastMessageId = msg.id;

      const payload = {
        type: 'discord-message',
        author: msg.member?.nick || msg.author.global_name || msg.author.username,
        content: msg.content,
        avatar: msg.author.avatar
          ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png?size=64`
          : null,
        timestamp: new Date(msg.timestamp).getTime(),
      };

      broadcastToFoundry(payload);
    }
  } catch (err) {
    console.error('❌ Poll error:', err.message);
  }
}

function startPolling() {
  // Initial fetch to set the baseline (don't replay old messages)
  pollMessages().then(() => {
    console.log(`📡 Polling #${CHANNEL_ID} every ${POLL_INTERVAL}ms`);
    pollTimer = setInterval(pollMessages, POLL_INTERVAL);
  });
}

// ── WebSocket Server ────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: connectedClients.size,
      polling: !!pollTimer,
      lastMessageId,
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server: httpServer,
  path: config.websocket.path,
});

wss.on('connection', (ws, req) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`🔗 Foundry client connected from ${clientIp}`);
  connectedClients.add(ws);

  ws.send(JSON.stringify({
    type: 'bridge-connected',
    message: 'Connected to Foundry-Discord Bridge',
    clients: connectedClients.size,
  }));

  // Foundry → Discord is handled by the module via webhook directly.
  // We still listen for pings or future bidirectional needs.
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      console.error('❌ Invalid message from client:', err.message);
    }
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log(`🔌 Client disconnected (${connectedClients.size} remaining)`);
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err.message);
    connectedClients.delete(ws);
  });
});

function broadcastToFoundry(payload) {
  const data = JSON.stringify(payload);
  let sent = 0;
  for (const ws of connectedClients) {
    if (ws.readyState === 1) {
      ws.send(data);
      sent++;
    }
  }
  if (sent > 0) {
    console.log(`📨 Discord → Foundry (${sent} client${sent > 1 ? 's' : ''}): ${payload.author}: ${payload.content.substring(0, 60)}`);
  }
}

// ── Start ───────────────────────────────────────────────────────────────
const PORT = config.websocket.port || 3120;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Bridge WebSocket on ws://0.0.0.0:${PORT}${config.websocket.path}`);
  startPolling();
});

// ── Graceful shutdown ───────────────────────────────────────────────────
function shutdown() {
  console.log('\n🛑 Shutting down bridge...');
  if (pollTimer) clearInterval(pollTimer);
  for (const ws of connectedClients) ws.close();
  wss.close();
  httpServer.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
