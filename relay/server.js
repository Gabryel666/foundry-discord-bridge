/**
 * Foundry-Discord Relay Server
 *
 * Bridges chat between Foundry VTT and Discord in real time.
 *
 * Discord → Foundry : bot listens the channel, forwards via WebSocket
 * Foundry → Discord : module sends to relay, relay posts via webhook
 *
 * No polling. Pure event-driven.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Client, GatewayIntentBits } = require('discord.js');
const { WebSocketServer } = require('ws');
const http = require('http');

// ── Config ──────────────────────────────────────────────────────────────
const required = ['DISCORD_TOKEN', 'DISCORD_CHANNEL_ID', 'DISCORD_WEBHOOK_URL'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing env var: ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const PORT = parseInt(process.env.RELAY_PORT || '3120', 10);
const PATH = process.env.RELAY_PATH || '/foundry-bridge';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// ── State ───────────────────────────────────────────────────────────────
const foundryClients = new Set();

// ── Discord Bot (receive only) ──────────────────────────────────────────
const discord = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

discord.once('ready', () => {
  console.log(`Discord bot ready as ${discord.user.tag}`);
  const ch = discord.channels.cache.get(CHANNEL_ID);
  console.log(`Listening on #${ch?.name || 'unknown'} (${CHANNEL_ID})`);
});

discord.on('messageCreate', (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id !== CHANNEL_ID) return;

  const payload = JSON.stringify({
    type: 'discord',
    author: msg.member?.displayName || msg.author.globalName || msg.author.username,
    content: msg.content,
    avatar: msg.author.displayAvatarURL({ size: 64 }),
  });

  for (const ws of foundryClients) {
    if (ws.readyState === 1) ws.send(payload);
  }
});

// ── Discord Webhook (send only) ─────────────────────────────────────────
async function postToDiscord(author, content) {
  try {
    const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
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

const wss = new WebSocketServer({ server: httpServer, path: PATH });

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
  console.log(`Relay listening on ws://0.0.0.0:${PORT}${PATH}`);
});

discord.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('Discord login failed:', err.message);
  process.exit(1);
});

// ── Shutdown ────────────────────────────────────────────────────────────
function shutdown() {
  for (const ws of foundryClients) ws.close();
  wss.close();
  discord.destroy();
  httpServer.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
