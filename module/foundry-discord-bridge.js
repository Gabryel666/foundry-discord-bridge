/**
 * Foundry-Discord Bridge — Module Foundry
 *
 * Connecte Foundry au serveur relay via WebSocket.
 * Envoie les messages du chat Foundry → relay → Discord.
 * Reçoit les messages Discord → relay → chat Foundry.
 *
 * Système-agnostic : utilise l'API ChatMessage core.
 */

let socket = null;
let retryTimer = null;
let retryDelay = 2000;

// ── Init ────────────────────────────────────────────────────────────────
Hooks.once('init', () => {
  game.settings.register('foundry-discord-bridge', 'relayUrl', {
    name: 'URL du relay',
    hint: 'Adresse WebSocket du serveur relay',
    scope: 'world', config: true, type: String, default: '',
  });
  game.settings.register('foundry-discord-bridge', 'enabled', {
    name: 'Activer le bridge',
    scope: 'world', config: true, type: Boolean, default: true,
  });
  game.settings.register('foundry-discord-bridge', 'showDiscord', {
    name: 'Afficher les messages Discord',
    scope: 'client', config: true, type: Boolean, default: true,
  });
});

// ── Ready ───────────────────────────────────────────────────────────────
Hooks.once('ready', () => {
  if (!game.settings.get('foundry-discord-bridge', 'enabled')) return;
  if (game.user.isGM) connect();
});

// ── WebSocket ───────────────────────────────────────────────────────────
function connect() {
  const url = game.settings.get('foundry-discord-bridge', 'relayUrl');
  if (!url) return;

  socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    retryDelay = 2000;
    ui.notifications.info('Bridge Discord connecté');
  });

  socket.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'discord' && game.settings.get('foundry-discord-bridge', 'showDiscord')) {
        displayDiscordMessage(msg);
      }
    } catch {}
  });

  socket.addEventListener('close', () => {
    socket = null;
    retryTimer = setTimeout(() => {
      connect();
      retryDelay = Math.min(retryDelay * 1.5, 30000);
    }, retryDelay);
  });

  socket.addEventListener('error', () => {});
}

// ── Display Discord message in Foundry ──────────────────────────────────
function displayDiscordMessage(msg) {
  const author = escape(msg.author || 'Discord');
  const content = escape(msg.content || '');
  const avatar = msg.avatar
    ? `<img src="${escape(msg.avatar)}" class="fdb-avatar" />`
    : '';

  ChatMessage.create({
    content: `<div class="fdb-message">${avatar}<span class="fdb-author">${author}</span> ${content}</div>`,
    speaker: { alias: `${author} (Discord)` },
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: { 'foundry-discord-bridge': { source: 'discord' } },
  });
}

// ── Send Foundry chat → relay ───────────────────────────────────────────
Hooks.on('createChatMessage', (message) => {
  if (!game.user.isGM) return;
  if (message.flags?.['foundry-discord-bridge']?.source === 'discord') return;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  const text = message.content.replace(/<[^>]+>/g, '').trim();
  if (!text) return;

  const author = message.alias || message.author?.name || 'Joueur';

  socket.send(JSON.stringify({ type: 'foundry', author, content: text }));
});

// ── Cleanup ─────────────────────────────────────────────────────────────
Hooks.on('closeApplication', () => {
  if (socket) { socket.close(); socket = null; }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
});

// ── Utils ───────────────────────────────────────────────────────────────
function escape(text) {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}
