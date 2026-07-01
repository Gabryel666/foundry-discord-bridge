/**
 * Foundry-Discord Relay Server
 *
 * Bridges chat between Foundry VTT and Discord in real time.
 *
 * Discord → Foundry : HTTP polling (GET /messages), forwards via WebSocket
 * Foundry → Discord : module sends to relay, relay posts via webhook
 *
 * Uses HTTP polling to avoid conflicting with the existing Hermes bot gateway.
 */

const { WebSocketServer } = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('Missing config.json. Copy config.example.json and fill in channelId + webhookUrl.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in ../.env');
  process.exit(1);
}

const PORT = parseInt(process.env.RELAY_PORT || '3120', 10);
const WS_PATH = process.env.RELAY_PATH || '/foundry-bridge';
const CHANNEL_ID = config.channelId;
const WEBHOOK_URL = config.webhookUrl;
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_API = 'https://discord.com/api/v10';
const POLL_INTERVAL = 3000; // 3 seconds — lightweight, no gateway conflict

// ── State ───────────────────────────────────────────────────────────────
const foundryClients = new Set();
let lastMessageId = null;

// ── Discord REST (read only, no gateway) ────────────────────────────────
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
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch { resolve(null); }
        } else if (res.statusCode === 429) {
          console.warn('Rate limited, backing off...');
          resolve(null);
        } else {
          console.error(`Discord API ${res.statusCode}`);
          resolve(null);
        }
      });
    });
    req.on('error', (err) => {
      console.error('HTTP error:', err.message);
      resolve(null);
    });
    req.end();
  });
}

async function pollDiscord() {
  const query = lastMessageId ? `?after=${lastMessageId}&limit=10` : '?limit=1';
  const messages = await discordGet(`/channels/${CHANNEL_ID}/messages${query}`);

  if (!messages || !Array.isArray(messages) || messages.length === 0) return;

  // Sort oldest first
  messages.sort((a, b) => BigInt(a.id) - BigInt(b.id));

  for (const msg of messages) {
    if (msg.author.bot) {
      lastMessageId = msg.id;
      continue;
    }

    // Skip first fetch (just set baseline)
    if (!lastMessageId) {
      lastMessageId = msg.id;
      return;
    }

    lastMessageId = msg.id;

    const payload = JSON.stringify({
      type: 'discord',
      author: msg.member?.nick || msg.author.global_name || msg.author.username,
      content: msg.content,
      avatar: msg.author.avatar
        ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png?size=64`
        : null,
    });

    for (const ws of foundryClients) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }
}

// ── Discord Webhook (send only) ─────────────────────────────────────────
async function postToDiscord(author, content) {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**${author}**: ${content}`,
        username: `${author}`,
      }),
    });
    if (!res.ok) console.error(`Webhook error ${res.status}`);
  } catch (err) {
    console.error('Webhook failed:', err.message);
  }
}

// ── HTTP + WebSocket Server ─────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, clients: foundryClients.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`Foundry client connected (${ip})`);
  foundryClients.add(ws);

  ws.send(JSON.stringify({ type: 'ready' }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'foundry' && msg.author && msg.content) {
        postToDiscord(msg.author, msg.content);
      }
    } catch {}
  });

  ws.on('close', () => {
    foundryClients.delete(ws);
    console.log(`Foundry client disconnected (${foundryClients.size} remaining)`);
  });

  ws.on('error', () => foundryClients.delete(ws));
});

// ── Start ───────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Relay listening on ws://0.0.0.0:${PORT}${WS_PATH}`);
  // Start polling after initial baseline fetch
  pollDiscord().then(() => {
    console.log(`Polling #${CHANNEL_ID} every ${POLL_INTERVAL}ms`);
    setInterval(pollDiscord, POLL_INTERVAL);
  });
});

// ── Shutdown ────────────────────────────────────────────────────────────
function shutdown() {
  for (const ws of foundryClients) ws.close();
  wss.close();
  httpServer.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
