import { registerSettings } from './settings.js';
import { BridgeConfig } from './config-app.js';
import { GatewayClient, onDiscordMessage, sendJasraMessage, getBotInfo, setupWhisperPrefixStrip } from './gateway.js';

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
        setupWhisperPrefixStrip();
        registerChatControl();
    }

    Hooks.on('closeApplication', () => {
        if (gateway) { gateway.close(); gateway = null; }
    });
});

// ── Chat Control Button — Hooks-based injection ────────────────────────

function registerChatControl() {
    // Try immediately
    tryInjectButton();

    // Foundry v13 moves the chat input around via _toggleNotifications.
    // These hooks cover all the moments where the input may appear or move.
    const tryDebounced = () => setTimeout(tryInjectButton, 50);
    Hooks.on('renderChatLog', tryDebounced);
    Hooks.on('changeSidebarTab', tryDebounced);
    Hooks.on('toggleSidebar', tryDebounced);
    Hooks.on('renderSidebar', tryDebounced);
    Hooks.on('collapseChatLog', tryDebounced);
}

function tryInjectButton() {
    // Already injected and in DOM?
    if (document.getElementById('fdb-jasra-btn')) return true;

    // Target the roll-privacy split-button container directly
    const rollPrivacy = document.getElementById('roll-privacy');
    if (!rollPrivacy) return false;

    const btn = createJasraButton();
    rollPrivacy.appendChild(btn);
    log('Button injected into #roll-privacy');
    updateButtonAvatar();
    return true;
}

function createJasraButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'fdb-jasra-btn';
    btn.className = 'ui-control icon fdb-jasra-btn';
    btn.title = game.i18n.localize('FDB.Button.Jasra');
    btn.innerHTML = '<i class="fas fa-ghost"></i>';

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        insertJasraPrefix();
    });

    return btn;
}

function updateButtonAvatar() {
    const info = getBotInfo();
    if (!info.id || !info.avatar) {
        setTimeout(updateButtonAvatar, 3000);
        return;
    }

    const avatarUrl = `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png?size=64`;
    const btn = document.getElementById('fdb-jasra-btn');
    if (btn) {
        btn.innerHTML = `<img src="${avatarUrl}" style="width:22px;height:22px;border-radius:50%;" alt="Jasra" />`;
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
                speaker: { alias: 'Jasra' },
                type: CONST.CHAT_MESSAGE_TYPES.OOC,
                flags: { [MODULE_ID]: { source: 'jasra-private', visibleTo: [game.user.id] } },
            });
            return false;
        }

        if (mode === 'notification') {
            ChatMessage.create({
                content: `<div class="fdb-message"><span class="fdb-author">@Jasra:</span> <span class="fdb-content">${escapeHtml(text)}</span></div>`,
                speaker: { alias: 'Jasra' },
                type: CONST.CHAT_MESSAGE_TYPES.OOC,
                flags: { [MODULE_ID]: { source: 'jasra-private', visibleTo: [game.user.id] } },
            });
            ChatMessage.create({
                content: `<em class="fdb-notification">${escapeHtml(authorName)} échange avec Jasra...</em>`,
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
