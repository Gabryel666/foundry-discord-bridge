/**
 * Foundry-Discord Bridge Server
 * 
 * Relays chat messages between Foundry VTT (via WebSocket) and Discord.
 * Uses the existing Jasra bot for Discord connectivity.
 */

const { Client, GatewayIntentBits } = require('discord.js');
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('❌ config.json not found. Copy config.example.json and fill in your values.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// ── State ───────────────────────────────────────────────────────────────
const connectedClients = new Set();
let discordChannel = null;
let ready = false;

// ── Discord Client ──────────────────────────────────────────────────────
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

discord.once('ready', () => {
  console.log(`✅ Discord bot ready as ${discord.user.tag}`);
  discordChannel = discord.channels.cache.get(config.discord.channelId);
  if (!discordChannel) {
    console.error(`❌ Channel ${config.discord.channelId} not found!`);
    process.exit(1);
  }
  console.log(`📡 Listening on #${discordChannel.name} (${discordChannel.id})`);
  ready = true;
});

discord.on('messageCreate', (message) => {
  // Ignore bot messages and messages from other channels
  if (message.author.bot) return;
  if (message.channel.id !== config.discord.channelId) return;

  const payload = {
    type: 'discord-message',
    author: message.member?.displayName || message.author.username,
    content: message.content,
    avatar: message.author.displayAvatarURL({ size: 64 }),
    timestamp: message.createdTimestamp,
  };

  broadcastToFoundry(payload);
});

// ── WebSocket Server ────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      discord: ready,
      clients: connectedClients.size,
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

  // Send welcome
  ws.send(JSON.stringify({
    type: 'bridge-connected',
    message: 'Connected to Foundry-Discord Bridge',
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'foundry-message') {
        // Forward to Discord
        if (discordChannel && ready) {
          const displayName = msg.author || 'Unknown';
          const text = `**${displayName}**: ${msg.content}`;
          discordChannel.send(text).catch((err) => {
            console.error('❌ Failed to send to Discord:', err.message);
          });
        }
      }
    } catch (err) {
      console.error('❌ Invalid message from Foundry client:', err.message);
    }
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log(`🔌 Foundry client disconnected (${connectedClients.size} remaining)`);
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err.message);
    connectedClients.delete(ws);
  });
});

// ── Broadcast helper ────────────────────────────────────────────────────
function broadcastToFoundry(payload) {
  const data = JSON.stringify(payload);
  for (const ws of connectedClients) {
    if (ws.readyState === 1) { // OPEN
      ws.send(data);
    }
  }
}

// ── Start ───────────────────────────────────────────────────────────────
const PORT = config.websocket.port || 3120;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 WebSocket bridge listening on ws://0.0.0.0:${PORT}${config.websocket.path}`);
});

discord.login(config.discord.token).catch((err) => {
  console.error('❌ Discord login failed:', err.message);
  process.exit(1);
});

// ── Graceful shutdown ───────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down bridge...');
  for (const ws of connectedClients) ws.close();
  wss.close();
  discord.destroy();
  httpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  for (const ws of connectedClients) ws.close();
  wss.close();
  discord.destroy();
  httpServer.close();
  process.exit(0);
});
