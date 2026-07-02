/**
 * Discord Gateway Client + message routing
 */

const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`[${MODULE_ID}]`, ...args);

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

// ── Gateway Client ──────────────────────────────────────────────────────

export class GatewayClient {
    #ws = null;
    #hbInterval = null;
    #hbAcked = true;
    #seq = null;
    #sessionId = null;
    #resumeUrl = null;
    #connected = false;
    #token; #guildId; #channelId; #onMessage;

    constructor({ token, guildId, channelId, onMessage }) {
        this.#token = token;
        this.#guildId = guildId;
        this.#channelId = channelId;
        this.#onMessage = onMessage;
    }

    get connected() { return this.#connected; }

    connect() {
        if (this.#ws) this.close();
        const url = `${GATEWAY_URL}/?v=${GATEWAY_VERSION}&encoding=${GATEWAY_ENCODING}`;
        this.#ws = new WebSocket(url);
        this.#ws.addEventListener('open', () => log('Gateway connected'));
        this.#ws.addEventListener('close', (e) => {
            log(`Gateway closed (${e.code})`);
            this.#cleanup();
        });
        this.#ws.addEventListener('error', (err) => log('Gateway error:', err));
        this.#ws.addEventListener('message', (e) => this.#handle(JSON.parse(e.data)));
    }

    close() {
        if (this.#ws) { this.#ws.close(1000); this.#ws = null; }
        this.#cleanup();
    }

    #cleanup() {
        if (this.#hbInterval) { clearInterval(this.#hbInterval); this.#hbInterval = null; }
        this.#hbAcked = true;
        this.#connected = false;
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
                this.#send({
                    op: OpCode.Identify,
                    d: {
                        token: this.#token,
                        intents: Intent.GUILDS | Intent.GUILD_MESSAGES | Intent.MESSAGE_CONTENT,
                        properties: { browser: 'FoundryVTT', device: 'foundry-discord-bridge', os: navigator.platform },
                    },
                });
                break;

            case OpCode.Heartbeat:
                this.#heartbeat();
                break;

            case OpCode.HeartbeatAck:
                this.#hbAcked = true;
                break;

            case OpCode.InvalidSession:
                setTimeout(() => d ? this.#resume() : this.connect(), 2000);
                break;

            case OpCode.Reconnect:
                this.#resume();
                break;

            case OpCode.Dispatch:
                if (t === 'READY') {
                    this.#sessionId = d.session_id;
                    this.#resumeUrl = d.resume_gateway_url;
                    this.#connected = true;
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
        if (this.#connected && !this.#hbAcked) { this.#resume(); return; }
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

// ── Discord → Foundry ───────────────────────────────────────────────────

export function onDiscordMessage(msg) {
    const mode = game.settings.get(MODULE_ID, 'chatMode');
    const content = `<div class="fdb-message">
        ${msg.avatar ? `<img src="${msg.avatar}" class="fdb-avatar" />` : ''}
        <span class="fdb-author">${escapeHtml(msg.author)}</span>
        <span class="fdb-content">${escapeHtml(msg.content)}</span>
    </div>`;

    const messageData = {
        content,
        speaker: { alias: `${msg.author} (Discord)` },
        type: CONST.CHAT_MESSAGE_TYPES.OTHER,
        flags: { [MODULE_ID]: { source: 'discord', discordId: msg.id } },
    };

    if (mode === 'public') {
        // Public: everyone sees Discord messages
        ChatMessage.create(messageData);
    } else {
        // Invisible / Notification: whisper to GM only
        const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
        messageData.whisper = gmIds;
        ChatMessage.create(messageData);
    }
}

// ── Foundry → Discord (Jasra webhook) ───────────────────────────────────

export function sendJasraMessage(authorName, text) {
    const webhookUrl = game.settings.get(MODULE_ID, 'discordWebhookUrl');
    if (!webhookUrl) {
        log('No webhook URL configured');
        return;
    }

    fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content: `**${authorName}** (Foundry): ${text}`,
            username: `${authorName} (Foundry)`
        }),
    }).catch((err) => log('Webhook error:', err));
}

// ── Helpers ─────────────────────────────────────────────────────────────

function escapeHtml(text) {
    const el = document.createElement('span');
    el.textContent = text || '';
    return el.innerHTML;
}
