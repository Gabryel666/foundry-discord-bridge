import { registerSettings } from './settings.js';
import { BridgeConfig } from './config-app.js';
import { GatewayClient, onDiscordMessage, sendJasraMessage, getBotInfo } from './gateway.js';

const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`[${MODULE_ID}]`, ...args);

let gateway = null;

function escapeHtml(text) {
    const el = document.createElement('span');
    el.textContent = text || '';
    return el.innerHTML;
}

// ── Init ────────────────────────────────────────────────────────────────

Hooks.once('init', () => {
    log('Initializing module');
    registerSettings();
    log('Settings registered');
});

// ── Ready ───────────────────────────────────────────────────────────────

Hooks.once('ready', () => {
    log('Ready');
    if (!game.settings.get(MODULE_ID, 'enabled')) {
        log('Disabled by settings');
        return;
    }

    if (game.user.isGM) {
        connectGateway();
        setupJasraIntercept();
        // Hook into ChatLog rendering — fires every time the chat updates
        Hooks.on('renderChatLog', onRenderChatLog);
    }

    Hooks.on('closeApplication', () => {
        if (gateway) { gateway.close(); gateway = null; }
    });
});

// ── Chat Button via renderChatLog ───────────────────────────────────────

function onRenderChatLog(chatLog, html, data) {
    // html is a jQuery object of the rendered chat
    // Skip if already injected
    if (html.find('#fdb-jasra-btn').length) return;

    // Try to find the chat input area
    const chatForm = html.find('#chat-form');
    if (chatForm.length) {
        const btn = $(`<a id="fdb-jasra-btn" class="fdb-jasra-btn" title="${game.i18n.localize('FDB.Button.Jasra')}"><i class="fas fa-ghost"></i></a>`);
        btn.on('click', (e) => { e.preventDefault(); insertJasraPrefix(); });
        chatForm.find('#chat-message').before(btn);
        log('Button injected via renderChatLog into chat-form');
        updateButtonAvatar();
        return;
    }

    // Fallback: find the input directly
    const chatInput = html.find('#chat-message');
    if (chatInput.length) {
        const btn = $(`<a id="fdb-jasra-btn" class="fdb-jasra-btn" title="${game.i18n.localize('FDB.Button.Jasra')}"><i class="fas fa-ghost"></i></a>`);
        btn.on('click', (e) => { e.preventDefault(); insertJasraPrefix(); });
        chatInput.before(btn);
        log('Button injected via renderChatLog before input');
        updateButtonAvatar();
    }
}

function updateButtonAvatar() {
    const info = getBotInfo();
    if (!info.id || !info.avatar) return;

    const avatarUrl = `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png?size=64`;
    const btn = document.getElementById('fdb-jasra-btn');
    if (btn) {
        btn.innerHTML = `<img src="${avatarUrl}" style="width:24px;height:24px;border-radius:50%;" alt="Jasra" />`;
        log('Button avatar updated');
    }
}

function insertJasraPrefix() {
    const chatInput = document.getElementById('chat-message');
    if (!chatInput) {
        const msg = prompt('Message pour Jasra :');
        if (msg) sendJasraMessage(game.user.name || 'MJ', msg);
        return;
    }

    if (chatInput.value.startsWith('@Jasra ')) {
        chatInput.focus();
        return;
    }

    chatInput.value = '@Jasra ' + chatInput.value;
    chatInput.focus();
    chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
}

// ── Intercept @Jasra Messages ───────────────────────────────────────────

function setupJasraIntercept() {
    Hooks.on('preCreateChatMessage', (message, data, options, userId) => {
        const content = data.content || '';
        if (!content.startsWith('@Jasra ')) return true;

        const text = content.replace(/^@Jasra\s*/, '').trim();
        if (!text) return false;

        const mode = game.settings.get(MODULE_ID, 'chatMode');
        const authorName = game.user.name || 'MJ';

        sendJasraMessage(authorName, text);

        if (mode === 'invisible') {
            ChatMessage.create({
                content: `<div class="fdb-message"><span class="fdb-author">@Jasra:</span> <span class="fdb-content">${escapeHtml(text)}</span></div>`,
                speaker: { alias: authorName },
                type: CONST.CHAT_MESSAGE_TYPES.WHISPER,
                whisper: [game.user.id],
                flags: { [MODULE_ID]: { source: 'jasra-private' } },
            });
            return false;
        }

        if (mode === 'notification') {
            ChatMessage.create({
                content: `<div class="fdb-message"><span class="fdb-author">@Jasra:</span> <span class="fdb-content">${escapeHtml(text)}</span></div>`,
                speaker: { alias: authorName },
                type: CONST.CHAT_MESSAGE_TYPES.WHISPER,
                whisper: [game.user.id],
                flags: { [MODULE_ID]: { source: 'jasra-private' } },
            });
            ChatMessage.create({
                content: `<em class="fdb-notification">[MJ] échange avec Jasra...</em>`,
                speaker: { alias: authorName },
                type: CONST.CHAT_MESSAGE_TYPES.OTHER,
                flags: { [MODULE_ID]: { source: 'jasra-notify' } },
            });
            return false;
        }

        // Public
        message.updateSource({
            flags: { [MODULE_ID]: { source: 'jasra-public' } }
        });
        return true;
    });
}

// ── Gateway ─────────────────────────────────────────────────────────────

function connectGateway() {
    const token = game.settings.get(MODULE_ID, 'discordToken');
    const guildId = game.settings.get(MODULE_ID, 'discordGuildId');
    const channelId = game.settings.get(MODULE_ID, 'discordChannelId');

    if (!token || !guildId || !channelId) {
        log('Missing config');
        return;
    }

    gateway = new GatewayClient({
        token, guildId, channelId,
        onMessage: onDiscordMessage
    });
    gateway.connect();
    ui.notifications.info('Foundry-Discord Bridge | Connecté à Discord');
    log('Gateway connecting...');
}
