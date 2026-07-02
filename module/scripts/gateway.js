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

// Bot info (populated on READY)
let botInfo = { id: null, username: null, avatar: null };
export function getBotInfo() { return botInfo; }

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

                    // Store bot info for avatar
                    botInfo = {
                        id: d.user.id,
                        username: d.user.username,
                        avatar: d.user.avatar
                    };
                    log(`Ready as ${d.user.username} (${d.user.id})`);

                    // Update button avatar if already injected
                    updateButtonAvatar();
                } else if (t === 'MESSAGE_CREATE' && d.channel_id === this.#channelId) {
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

// ── Button Avatar Update ────────────────────────────────────────────────

function updateButtonAvatar() {
    const btn = document.getElementById('fdb-jasra-btn');
    if (!btn || !botInfo.id || !botInfo.avatar) return;

    const avatarUrl = `https://cdn.discordapp.com/avatars/${botInfo.id}/${botInfo.avatar}.png?size=64`;
    btn.innerHTML = `<img src="${avatarUrl}" style="width:28px;height:28px;border-radius:50%;" alt="Jasra" />`;
    log('Button avatar updated');
}

// ── Discord → Foundry ───────────────────────────────────────────────────

export function onDiscordMessage(msg) {
    const mode = game.settings.get(MODULE_ID, 'chatMode');
    const content = `<div class="fdb-message">
        ${msg.avatar ? `<img src="${msg.avatar}" class="fdb-avatar" />` : ''}
        <span class="fdb-content">${escapeHtml(msg.content)}</span>
    </div>`;

    if (mode === 'public') {
        ChatMessage.create({
            content,
            speaker: { alias: msg.author },
            type: CONST.CHAT_MESSAGE_TYPES.IC,
            flags: { [MODULE_ID]: { source: 'discord', discordId: msg.id } },
        });
    } else {
        // Invisible / Notification: whisper to GM only
        const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
        ChatMessage.create({
            content,
            speaker: { alias: msg.author },
            type: CONST.CHAT_MESSAGE_TYPES.WHISPER,
            whisper: gmIds,
            flags: { [MODULE_ID]: { source: 'discord', discordId: msg.id } },
        });
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
            content: text,
            username: authorName
        }),
    }).catch((err) => log('Webhook error:', err));
}

// ── Strip whisper prefix from Discord messages ──────────────────────────

export function setupWhisperPrefixStrip() {
    Hooks.on('renderChatMessage', (message, html) => {
        try {
            // Only for our Discord whisper messages
            if (!message.flags?.[MODULE_ID]?.source) return;
            const src = message.flags[MODULE_ID].source;
            if (src !== 'discord' && src !== 'jasra-private') return;
            if (!message.whisper?.length) return;

            // Remove Foundry's auto-generated whisper header
            const el = html instanceof jQuery ? html[0] : html;
            if (!el) return;

            const whisperHeaders = el.querySelectorAll('.whisper-to, .chat-card .whisper');
            whisperHeaders.forEach(h => h.remove());
        } catch (e) {
            // Never break message rendering
        }
    });
}

// ── Helpers ─────────────────────────────────────────────────────────────

function escapeHtml(text) {
    const el = document.createElement('span');
    el.textContent = text || '';
    return el.innerHTML;
}
