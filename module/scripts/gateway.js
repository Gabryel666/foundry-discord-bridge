/**
 * Discord Gateway Client + message routing
 */

const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`[${MODULE_ID}]`, ...args);
const debugLog = (...args) => {
    try { if (game.settings?.get(MODULE_ID, 'debug')) console.log(`[${MODULE_ID}][debug]`, ...args); } catch(e) {}
};

// ── Chat message type constants — handle v13/v14 differences ────────────
const _isV14 = typeof CONST.CHAT_MESSAGE_STYLES !== 'undefined';
const MSG = {
    v14: _isV14,
    whisper: (targetIds) => _isV14
        ? { style: CONST.CHAT_MESSAGE_STYLES.OOC, whisper: targetIds }
        : { type: CONST.CHAT_MESSAGE_TYPES.WHISPER, whisper: targetIds },
    public: () => _isV14
        ? { style: CONST.CHAT_MESSAGE_STYLES.IC }
        : { type: CONST.CHAT_MESSAGE_TYPES.IC },
    other: () => _isV14
        ? { style: CONST.CHAT_MESSAGE_STYLES.OTHER }
        : { type: CONST.CHAT_MESSAGE_TYPES.OTHER },
};

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

// ── Webhook health alert (notification Foundry native) ───────────────

function showWebhookError(message) {
    ui.notifications.error('⚠️ ' + message);
}

function showWebhookRecovered() {
    ui.notifications.info('✅ Webhook Discord — connexion rétablie');
}

// ── Guild channels cache (peuplé depuis le gateway, pas de REST) ────

let _guildChannels = {};
let _messageCount = 0;
let _guildName = '';

// Pont pour la config — évite les imports croisés entre modules
window.__fdbBridge = {
    get guildChannels() { return _guildChannels; },
    get connected() { return Object.keys(_guildChannels).length > 0; },
    get botName() { return botInfo.username || 'Bot Discord'; },
    get messageCount() { return _messageCount; },
    get guildName() { return _guildName; },
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

                    botInfo = {
                        id: d.user.id,
                        username: d.user.username,
                        avatar: d.user.avatar
                    };
                    log(`Ready as ${d.user.username} (${d.user.id})`);
                    updateButtonAvatar();
                } else if (t === 'MESSAGE_CREATE' && d.channel_id === this.#channelId) {
                    _messageCount++;
                    if (d.webhook_id) {
                        debugLog('MESSAGE_CREATE filtered (webhook):', d.author?.username, d.content?.substring(0, 30));
                        break;
                    }
                    debugLog('MESSAGE_CREATE received from:', d.author?.username, 'content:', d.content?.substring(0, 50));
                    this.#onMessage?.({
                        id: d.id,
                        author: d.member?.nick || d.author?.global_name || d.author?.username,
                        content: d.content || '',
                        avatar: d.author?.avatar
                            ? `https://cdn.discordapp.com/avatars/${d.author.id}/${d.author.avatar}.png?size=64`
                            : null,
                        attachments: d.attachments || [],
                        embeds: d.embeds || [],
                    });
                } else if (t === 'GUILD_CREATE' && d.id === this.#guildId) {
                    _guildName = d.name || '';
                    // Trier par position pour respecter l'ordre Discord
                    const sorted = (d.channels || []).sort((a, b) => (a.position || 0) - (b.position || 0));
                    _guildChannels[d.id] = sorted;
                    log('Cached', sorted.length, 'channels for guild', d.id);
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

/** Transforme les URLs d'images en balises <img> dans du texte déjà raw */
function embedImages(rawText, embedPageUrls = new Set()) {
    const imageRegex = /(https?:\/\/[^\s<]*?\.(?:png|jpg|jpeg|gif|webp|bmp|svg)(?:\?[^\s<]*)?)/gi;
    const parts = rawText.split(imageRegex);
    let result = '';
    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
            // Partie texte — échapper le HTML, et retirer les URLs
            // déjà couvertes par un embed (GIPHY, Tenor, etc.)
            let text = parts[i];
            if (embedPageUrls.size > 0) {
                text = text.replace(/https?:\/\/[^\s<"]+/gi, url => {
                    return embedPageUrls.has(url) ? '' : url;
                });
            }
            result += escapeHtml(text);
        } else {
            // URL d'image — balise img directe
            result += `<img src="${parts[i]}" class="fdb-embed-image" loading="lazy" />`;
        }
    }
    return result;
}

export function onDiscordMessage(msg) {
    debugLog('Discord message received:', msg.author, msg.content?.substring(0, 50));
    try {
        const mode = game.settings.get(MODULE_ID, 'chatMode');

        // Collecter les URLs des pages d'embed (GIPHY, Tenor, etc.) pour
        // les retirer du texte brut — l'embed fournit déjà le média
        const embedPageUrls = new Set((msg.embeds || []).map(e => e.url).filter(Boolean));

        // Construire le contenu: texte + images du content + attachments + embeds
        let bodyHtml = embedImages(msg.content || '', embedPageUrls);

        // Collecter les URLs déjà embarquées dans le texte pour dédoublonner les embeds
        const alreadyEmbedded = new Set();
        const urlRegex = /https?:\/\/[^\s<]*?\.(?:png|jpg|jpeg|gif|webp|bmp|svg)(?:\?[^\s<]*)?/gi;
        let m;
        while ((m = urlRegex.exec(msg.content || '')) !== null) {
            alreadyEmbedded.add(m[0]);
        }

        // Attachments (fichiers uploadés — images/GIF)
        if (msg.attachments?.length) {
            const imgExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
            msg.attachments.forEach(att => {
                const ext = (att.filename || '').split('.').pop()?.toLowerCase();
                if (att.content_type?.startsWith('image/') || imgExts.includes(ext)) {
                    bodyHtml += `\n<img src="${att.url}" class="fdb-embed-image" loading="lazy" />`;
                    alreadyEmbedded.add(att.url);
                }
            });
        }

        // Embeds (GIF picker, previews de liens — Tenor, GIPHY, etc.)
        // Skip si l'URL est déjà dans le texte ou les attachments
        if (msg.embeds?.length) {
            debugLog('Embeds:', msg.embeds.map(e => ({
                type: e.type,
                img: (e.image?.url || '').substring(0, 80),
                vid: (e.video?.url || '').substring(0, 80),
                thumb: (e.thumbnail?.url || '').substring(0, 80),
            })));
            msg.embeds.forEach(embed => {
                // Vidéos animées (Tenor/GIPHY — MP4 dans embed.video.url)
                // Priorité : si vidéo dispo, c'est l'animé → on saute l'image statique
                const videoUrl = embed.video?.url || null;
                if (videoUrl && !alreadyEmbedded.has(videoUrl)) {
                    bodyHtml += `\n<video src="${videoUrl}" class="fdb-embed-video" autoplay loop muted playsinline></video>`;
                    alreadyEmbedded.add(videoUrl);
                }
                // Images (embed.image.url) — seulement si pas de vidéo
                if (!videoUrl) {
                    const imgUrl = embed.image?.url || embed.thumbnail?.url || null;
                    if (imgUrl && !alreadyEmbedded.has(imgUrl)) {
                        bodyHtml += `\n<img src="${imgUrl}" class="fdb-embed-image" loading="lazy" />`;
                        alreadyEmbedded.add(imgUrl);
                    }
                }
            });
        }

        const content = `<div class="fdb-message">
            ${msg.avatar ? `<img src="${msg.avatar}" class="fdb-avatar" />` : ''}
            <span class="fdb-content">${bodyHtml}</span>
        </div>`;

        const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
        debugLog('Creating ChatMessage, mode:', mode, 'author:', msg.author);

        if (mode === 'public') {
            ChatMessage.create(Object.assign({
                content,
                speaker: { alias: msg.author },
                flags: { [MODULE_ID]: { source: 'discord', discordId: msg.id } },
            }, MSG.public())).then(() => debugLog('ChatMessage created (public)'))
              .catch(err => log('ChatMessage.create error:', err));
        } else {
            ChatMessage.create(Object.assign({
                content,
                speaker: { alias: msg.author },
                flags: { [MODULE_ID]: { source: 'discord', discordId: msg.id } },
            }, MSG.whisper(gmIds))).then(() => debugLog('ChatMessage created (whisper)'))
              .catch(err => log('ChatMessage.create error:', err));
        }
    } catch (err) {
        log('onDiscordMessage error:', err);
    }
}

// ── Foundry → Discord (Jasra webhook) ───────────────────────────────────

export function sendJasraMessage(authorName, text) {
    const webhookUrl = game.settings.get(MODULE_ID, 'discordWebhookUrl');
    if (!webhookUrl) {
        log('No webhook URL configured');
        return;
    }

    let avatarUrl = undefined;
    const userAvatar = game.user?.avatar;
    if (userAvatar) {
        avatarUrl = userAvatar.startsWith('http')
            ? userAvatar
            : window.location.origin + '/' + userAvatar.replace(/^\//, '');
    }

    fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content: text,
            username: authorName,
            avatar_url: avatarUrl,
        }),
    }).then(resp => {
        if (!resp.ok) {
            showWebhookError(`Webhook Discord : erreur ${resp.status}`);
            log('Webhook error:', resp.status, resp.statusText);
        } else {
            showWebhookRecovered();
        }
    }).catch((err) => {
        showWebhookError('Webhook Discord injoignable — vérifie la config ou la connexion réseau.');
        log('Webhook fetch error:', err);
    });
}

// ── Whisper prefix handling for Jasra messages ─────────────────────────

export function setupWhisperPrefixStrip() {
    Hooks.on('renderChatMessageHTML', (message, html, data) => {
        try {
            if (!message.flags?.[MODULE_ID]?.source) return;
            const src = message.flags[MODULE_ID].source;

            const el = html instanceof HTMLElement ? html : html?.querySelector ? html : null;
            if (!el) return;

            // For MJ→Jasra whispers: replace "À: [MJ name]" with "À: Jasra"
            if (src === 'jasra-private') {
                const whisperHeader = el.querySelector('.whisper-to');
                if (whisperHeader) {
                    whisperHeader.textContent = whisperHeader.textContent
                        .replace(/À: .+/, 'À: Jasra')
                        .replace(/A: .+/, 'A: Jasra')
                        .replace(/whispers to .+/i, 'whispers to Jasra')
                        .replace(/chuchote à .+/i, 'chuchote à Jasra');
                }
            }
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
