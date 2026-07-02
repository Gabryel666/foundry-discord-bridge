/**
 * Foundry-Discord Bridge v3
 *
 * Connecte Foundry VTT directement au gateway Discord depuis le navigateur.
 * Pas de serveur intermédiaire, pas de polling.
 *
 * Discord → Foundry : WebSocket gateway (push temps réel)
 * Foundry → Discord : Webhook POST
 */

const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

// ── Discord Gateway Constants ───────────────────────────────────────────
const GATEWAY_URL = 'wss://gateway.discord.gg';
const GATEWAY_VERSION = 10;
const GATEWAY_ENCODING = 'json';

const OpCode = {
  Dispatch: 0, Heartbeat: 1, Identify: 2,
  InvalidSession: 9, Hello: 10, HeartbeatAck: 11,
  Resume: 6, Reconnect: 7,
};

const Intent = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  MESSAGE_CONTENT: 1 << 15,
};

const State = { Closed: 'closed', Open: 'open', Ready: 'ready' };

// ── Gateway Client ──────────────────────────────────────────────────────
class GatewayClient {
  #ws = null;
  #hbInterval = null;
  #hbAcked = true;
  #seq = null;
  #sessionId = null;
  #resumeUrl = null;
  #status = State.Closed;
  #token; #guildId; #channelId; #onMessage;

  constructor({ token, guildId, channelId, onMessage }) {
    this.#token = token;
    this.#guildId = guildId;
    this.#channelId = channelId;
    this.#onMessage = onMessage;
  }

  get connected() { return this.#status === State.Ready; }

  connect() {
    if (this.#ws) this.close();
    this.#status = State.Open;
    const url = `${GATEWAY_URL}/?v=${GATEWAY_VERSION}&encoding=${GATEWAY_ENCODING}`;
    this.#ws = new WebSocket(url);
    this.#ws.addEventListener('open', () => log('Gateway connected'));
    this.#ws.addEventListener('close', (e) => { log(`Gateway closed (${e.code})`); this.#cleanup(); });
    this.#ws.addEventListener('error', () => {});
    this.#ws.addEventListener('message', (e) => this.#handle(JSON.parse(e.data)));
  }

  close() {
    if (this.#ws) { this.#ws.close(1000); this.#ws = null; }
    this.#cleanup();
  }

  #cleanup() {
    if (this.#hbInterval) { clearInterval(this.#hbInterval); this.#hbInterval = null; }
    this.#hbAcked = true;
    this.#status = State.Closed;
  }

  #send(data) {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(data));
  }

  #handle({ op, d, t, s }) {
    if (s != null) this.#seq = s;

    switch (op) {
      case OpCode.Hello:
        setTimeout(() => this.#heartbeat(), d.heartbeat_interval * Math.random());
        this.#hbInterval = setInterval(() => this.#heartbeat(), d.heartbeat_interval);
        this.#send({ op: OpCode.Identify, d: {
          token: this.#token,
          intents: Intent.GUILDS | Intent.GUILD_MESSAGES | Intent.MESSAGE_CONTENT,
          properties: { browser: 'FoundryVTT', device: 'foundry-discord-bridge', os: navigator.platform },
        }});
        break;

      case OpCode.Heartbeat: this.#heartbeat(); break;
      case OpCode.HeartbeatAck: this.#hbAcked = true; break;

      case OpCode.InvalidSession:
        setTimeout(() => d ? this.#resume() : this.connect(), 2000);
        break;

      case OpCode.Reconnect: this.#resume(); break;

      case OpCode.Dispatch:
        if (t === 'READY') {
          this.#sessionId = d.session_id;
          this.#resumeUrl = d.resume_gateway_url;
          this.#status = State.Ready;
          log(`Ready as ${d.user.username}`);
        } else if (t === 'MESSAGE_CREATE' && d.channel_id === this.#channelId && !d.author?.bot) {
          this.#onMessage?.({
            id: d.id,
            author: d.member?.nick || d.author?.global_name || d.author?.username,
            content: d.content || '',
            avatar: d.author?.avatar
              ? `https://cdn.discordapp.com/avatars/${d.author.id}/${d.author.avatar}.png?size=64`
              : null,
          });
        }
        break;
    }
  }

  #heartbeat() {
    if (this.#ws?.readyState !== WebSocket.OPEN) return;
    if (this.#status === State.Ready && !this.#hbAcked) { this.#resume(); return; }
    this.#hbAcked = false;
    this.#send({ op: OpCode.Heartbeat, d: this.#seq });
  }

  #resume() {
    if (!this.#sessionId || this.#seq == null) { this.connect(); return; }
    const url = `${this.#resumeUrl || GATEWAY_URL}/?v=${GATEWAY_VERSION}&encoding=${GATEWAY_ENCODING}`;
    this.#ws = new WebSocket(url);
    this.#ws.addEventListener('open', () => {
      this.#send({ op: OpCode.Resume, d: { token: this.#token, session_id: this.#sessionId, seq: this.#seq } });
      log('Resumed');
    });
    this.#ws.addEventListener('close', (e) => { log(`Resume closed (${e.code})`); this.#cleanup(); });
    this.#ws.addEventListener('error', () => {});
    this.#ws.addEventListener('message', (e) => this.#handle(JSON.parse(e.data)));
  }
}

// ── Module State ────────────────────────────────────────────────────────

let gateway = null;

// ── Settings ────────────────────────────────────────────────────────────

Hooks.once('init', () => {
  log('Initializing');

  game.settings.register(MODULE_ID, 'enabled', {
    name: 'Activer le bridge',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.BooleanField(),
    default: true,
  });

  game.settings.register(MODULE_ID, 'discordToken', {
    name: 'Token du bot Discord',
    hint: 'Token du bot Discord pour écouter les messages (visible uniquement par le MJ)',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.StringField(),
    default: '',
  });

  game.settings.register(MODULE_ID, 'discordGuildId', {
    name: 'ID du serveur Discord',
    hint: 'Identifiant du serveur Discord (clic droit → Copier l\'identifiant)',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.StringField(),
    default: '',
  });

  game.settings.register(MODULE_ID, 'discordChannelId', {
    name: 'ID du salon Discord',
    hint: 'Identifiant du salon à écouter (clic droit → Copier l\'identifiant)',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.StringField(),
    default: '',
  });

  game.settings.register(MODULE_ID, 'discordWebhookUrl', {
    name: 'URL du webhook Discord',
    hint: 'Webhook du salon pour envoyer les messages Foundry → Discord',
    scope: 'world',
    config: true,
    type: new foundry.data.fields.StringField(),
    default: '',
  });

  log('Settings registered');
});

// ── Start ───────────────────────────────────────────────────────────────

Hooks.once('ready', () => {
  if (!game.settings.get(MODULE_ID, 'enabled')) return;

  // Connect if we are the active GM
  if (game.users.activeGM?.isSelf) connectGateway();

  // Toolbar toggle (GM only)
  Hooks.on('getSceneControlButtons', (controls) => {
    const tc = controls.find((c) => c.name === 'token');
    if (!tc) return;
    tc.tools.push({
      name: 'discord-bridge',
      title: 'Bridge Discord',
      icon: 'fa-brands fa-discord',
      toggle: true,
      active: gateway?.connected ?? false,
      onClick: (active) => { if (active) connectGateway(); else disconnectGateway(); },
    });
  });

  // If active GM changes, take over or release
  Hooks.on('userConnected', () => {
    if (!game.settings.get(MODULE_ID, 'enabled')) return;
    if (game.users.activeGM?.isSelf && !gateway?.connected) {
      connectGateway();
      log('Took over gateway (now active GM)');
    } else if (!game.users.activeGM?.isSelf && gateway?.connected) {
      disconnectGateway();
      log('Released gateway (no longer active GM)');
    }
  });
});

function connectGateway() {
  const token = game.settings.get(MODULE_ID, 'discordToken');
  const guildId = game.settings.get(MODULE_ID, 'discordGuildId');
  const channelId = game.settings.get(MODULE_ID, 'discordChannelId');
  if (!token || !guildId || !channelId) {
    log('Missing config');
    ui.notifications?.warn('Foundry-Discord Bridge : configuration incomplète');
    return;
  }

  gateway = new GatewayClient({ token, guildId, channelId, onMessage: onDiscordMessage });
  gateway.connect();
  ui.notifications?.info('Bridge Discord connecté');
}

function disconnectGateway() {
  gateway?.close();
  gateway = null;
}

// ── Discord → Foundry ───────────────────────────────────────────────────

function onDiscordMessage(msg) {
  ChatMessage.create({
    content: `<div class="fdb-message">
      ${msg.avatar ? `<img src="${msg.avatar}" class="fdb-avatar" />` : ''}
      <span class="fdb-author">${escape(msg.author)}</span>
      <span class="fdb-content">${escape(msg.content)}</span>
    </div>`,
    speaker: { alias: `${msg.author} (Discord)` },
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    flags: { [MODULE_ID]: { source: 'discord', discordId: msg.id } },
  });
}

// ── Foundry → Discord (webhook) ─────────────────────────────────────────

Hooks.on('createChatMessage', (message) => {
  if (!game.user.isGM) return;
  if (message.flags?.[MODULE_ID]?.source === 'discord') return;

  const webhookUrl = game.settings.get(MODULE_ID, 'discordWebhookUrl');
  if (!webhookUrl) return;

  const text = message.content.replace(/<[^>]+>/g, '').trim();
  if (!text) return;

  const author = message.alias || message.author?.name || 'Joueur';

  fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `**${author}**: ${text}`, username: author }),
  }).catch((err) => log('Webhook error:', err));
});

// ── Cleanup ─────────────────────────────────────────────────────────────

Hooks.on('closeApplication', () => disconnectGateway());

// ── Helpers ─────────────────────────────────────────────────────────────

function escape(text) {
  const el = document.createElement('span');
  el.textContent = text || '';
  return el.innerHTML;
}
