/**
 * Foundry-Discord Bridge v2 — Client Module
 * 
 * System-agnostic bridge between Foundry VTT and Discord.
 * 
 * - Discord → Foundry: WebSocket connection to the bridge server
 * - Foundry → Discord: Direct POST to Discord webhook (no server roundtrip)
 * 
 * Hooks into core ChatMessage API — works with any game system.
 */

// ── State ───────────────────────────────────────────────────────────────
let ws = null;
let reconnectTimer = null;
let reconnectDelay = 2000;
const MAX_RECONNECT_DELAY = 30000;

// ── Module Init ─────────────────────────────────────────────────────────
Hooks.once('init', () => {
  console.log('Foundry-Discord Bridge | Initializing');

  game.settings.register('foundry-discord-bridge', 'bridgeUrl', {
    name: 'Bridge WebSocket URL',
    hint: 'WebSocket URL of the bridge server for receiving Discord messages',
    scope: 'world',
    config: true,
    type: String,
    default: 'ws://localhost:3120/foundry-bridge',
  });

  game.settings.register('foundry-discord-bridge', 'discordWebhookUrl', {
    name: 'Discord Webhook URL',
    hint: 'Discord webhook URL for sending Foundry messages to Discord',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });

  game.settings.register('foundry-discord-bridge', 'bridgeEnabled', {
    name: 'Enable Bridge',
    hint: 'Connect to the Discord bridge and relay chat messages',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register('foundry-discord-bridge', 'showDiscordMessages', {
    name: 'Show Discord Messages',
    hint: 'Display incoming Discord messages in the Foundry chat',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register('foundry-discord-bridge', 'sendToDiscord', {
    name: 'Send to Discord',
    hint: 'Forward Foundry chat messages to Discord',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
});

// ── Module Ready ────────────────────────────────────────────────────────
Hooks.once('ready', () => {
  if (!game.settings.get('foundry-discord-bridge', 'bridgeEnabled')) {
    console.log('Foundry-Discord Bridge | Disabled by settings');
    return;
  }

  // Only GM connects to WebSocket (prevents duplicate messages)
  if (game.user.isGM) {
    connectBridge();
  }

  ui.notifications.info('Foundry-Discord Bridge | Active');
});

// ── WebSocket Connection (Discord → Foundry) ────────────────────────────
function connectBridge() {
  const url = game.settings.get('foundry-discord-bridge', 'bridgeUrl');

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error('Foundry-Discord Bridge | Failed to create WebSocket:', err);
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    console.log('Foundry-Discord Bridge | ✅ Connected to bridge');
    reconnectDelay = 2000;
    ui.notifications.info('Foundry-Discord Bridge | Connected to Discord');
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleBridgeMessage(msg);
    } catch (err) {
      console.error('Foundry-Discord Bridge | Invalid message:', err);
    }
  });

  ws.addEventListener('close', () => {
    console.log('Foundry-Discord Bridge | Disconnected');
    ws = null;
    scheduleReconnect();
  });

  ws.addEventListener('error', (err) => {
    console.error('Foundry-Discord Bridge | WebSocket error:', err);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    console.log(`Foundry-Discord Bridge | Reconnecting (delay: ${reconnectDelay}ms)...`);
    connectBridge();
    reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
  }, reconnectDelay);
}

// ── Handle Incoming Discord Messages ────────────────────────────────────
function handleBridgeMessage(msg) {
  if (msg.type === 'bridge-connected') {
    console.log('Foundry-Discord Bridge | Bridge:', msg.message);
    return;
  }

  if (msg.type !== 'discord-message') return;
  if (!game.settings.get('foundry-discord-bridge', 'showDiscordMessages')) return;

  // Sanitize content for safe display
  const safeAuthor = escapeHtml(msg.author);
  const safeContent = escapeHtml(msg.content);

  ChatMessage.create({
    content: `<div class="discord-bridge-msg">
      ${msg.avatar ? `<img src="${escapeHtml(msg.avatar)}" class="discord-avatar" alt="" />` : ''}
      <span class="discord-author">${safeAuthor}</span>
      <span class="discord-content">${safeContent}</span>
    </div>`,
    speaker: { alias: `💬 ${safeAuthor} (Discord)` },
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: {
      'foundry-discord-bridge': { source: 'discord' },
    },
  });
}

// ── Hook: Intercept Foundry Chat → Discord Webhook ──────────────────────
Hooks.on('createChatMessage', (message, options, userId) => {
  if (!game.settings.get('foundry-discord-bridge', 'sendToDiscord')) return;

  // Don't relay Discord echoes back
  if (message.flags?.['foundry-discord-bridge']?.source === 'discord') return;

  // Only from local client
  if (!game.user.isGM) return;

  // Extract plain text
  const temp = document.createElement('div');
  temp.innerHTML = message.content;
  const text = (temp.textContent || temp.innerText || '').trim();
  if (!text) return;

  const author = message.alias || message.author?.name || 'Unknown';

  sendToDiscordWebhook(author, text);
});

// ── Send via Discord Webhook (direct, no bridge server) ─────────────────
async function sendToDiscordWebhook(author, content) {
  const webhookUrl = game.settings.get('foundry-discord-bridge', 'discordWebhookUrl');
  if (!webhookUrl) {
    console.warn('Foundry-Discord Bridge | No webhook URL configured');
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**${author}**: ${content}`,
        username: `${author} (Foundry)`,
      }),
    });

    if (!res.ok) {
      console.error(`Foundry-Discord Bridge | Webhook error ${res.status}`);
    }
  } catch (err) {
    console.error('Foundry-Discord Bridge | Webhook failed:', err);
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────
Hooks.on('closeApplication', () => {
  if (ws) { ws.close(); ws = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
});

// ── Helpers ─────────────────────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text || ''));
  return div.innerHTML;
}
