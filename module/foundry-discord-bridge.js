/**
 * Foundry-Discord Bridge — Client Module
 * 
 * Hooks into Foundry's core ChatMessage API (system-agnostic)
 * and relays messages to/from a Discord channel via WebSocket bridge.
 */

// ── State ───────────────────────────────────────────────────────────────
let ws = null;
let reconnectTimer = null;
let reconnectDelay = 2000;
const MAX_RECONNECT_DELAY = 30000;

// Track messages we sent to avoid echo loops
const sentToDiscord = new Set();

// ── Module Init ─────────────────────────────────────────────────────────
Hooks.once('init', () => {
  console.log('Foundry-Discord Bridge | Initializing');

  game.settings.register('foundry-discord-bridge', 'bridgeUrl', {
    name: 'Bridge WebSocket URL',
    hint: 'The WebSocket URL of the bridge server (e.g., ws://your-vps:3120/foundry-bridge)',
    scope: 'world',
    config: true,
    type: String,
    default: 'ws://localhost:3120/foundry-bridge',
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

  // Only GM connects to the bridge (prevents duplicate messages)
  if (game.user.isGM) {
    connectBridge();
  }

  ui.notifications.info('Foundry-Discord Bridge | Connecting...');
});

// ── WebSocket Connection ────────────────────────────────────────────────
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
    reconnectDelay = 2000; // Reset backoff
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
    console.log('Foundry-Discord Bridge | Bridge says:', msg.message);
    return;
  }

  if (msg.type !== 'discord-message') return;
  if (!game.settings.get('foundry-discord-bridge', 'showDiscordMessages')) return;

  // Create a chat message in Foundry from Discord
  const content = `<div class="discord-bridge-msg">
    <img src="${msg.avatar || ''}" class="discord-avatar" alt="" />
    <span class="discord-author">${escapeHtml(msg.author)}</span>
    <span class="discord-content">${escapeHtml(msg.content)}</span>
  </div>`;

  ChatMessage.create({
    content,
    speaker: { alias: `💬 ${msg.author} (Discord)` },
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: {
      'foundry-discord-bridge': { source: 'discord' },
    },
  });
}

// ── Hook: Intercept Foundry Chat ────────────────────────────────────────
Hooks.on('createChatMessage', (message, options, userId) => {
  if (!game.settings.get('foundry-discord-bridge', 'sendToDiscord')) return;

  // Don't relay our own Discord echoes back
  if (message.flags?.['foundry-discord-bridge']?.source === 'discord') return;

  // Only relay from the local client to avoid duplicates
  if (!game.user.isGM) return;

  // Extract plain text content (strip HTML)
  const temp = document.createElement('div');
  temp.innerHTML = message.content;
  const textContent = temp.textContent || temp.innerText || '';

  if (!textContent.trim()) return;

  // Get author name
  const author = message.alias || message.author?.name || 'Unknown';

  sendToBridge(author, textContent.trim());
});

// ── Send to Bridge ──────────────────────────────────────────────────────
function sendToBridge(author, content) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('Foundry-Discord Bridge | Not connected, message not sent');
    return;
  }

  ws.send(JSON.stringify({
    type: 'foundry-message',
    author,
    content,
  }));
}

// ── Cleanup on unload ───────────────────────────────────────────────────
Hooks.on('closeApplication', () => {
  if (ws) {
    ws.close();
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────
function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
