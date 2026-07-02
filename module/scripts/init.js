import { registerSettings } from './settings.js';
import { BridgeConfig } from './config-app.js';
import { GatewayClient, onDiscordMessage, sendJasraMessage, getBotInfo } from './gateway.js';

const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`[${MODULE_ID}]`, ...args);

let gateway = null;
let buttonInjected = false;

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
        // Try to inject button multiple times until it works
        injectSidebarButton();
    }

    Hooks.on('closeApplication', () => {
        if (gateway) { gateway.close(); gateway = null; }
    });
});

// ── Sidebar Button — DOM Injection ──────────────────────────────────────

function injectSidebarButton() {
    if (buttonInjected) return;

    // Try immediately
    if (tryInject()) return;

    // Retry with intervals
    const interval = setInterval(() => {
        if (tryInject() || buttonInjected) clearInterval(interval);
    }, 1000);

    // Stop after 15 seconds
    setTimeout(() => clearInterval(interval), 15000);
}

function tryInject() {
    if (buttonInjected) return true;

    // Find sidebar tabs - multiple selectors for compatibility
    const sidebarTabs = document.querySelector('#sidebar-tabs')
        || document.querySelector('.sidebar-tabs')
        || document.querySelector('[data-tab-group="sidebar"]');

    if (!sidebarTabs) {
        log('Sidebar tabs not found yet');
        return false;
    }

    // Create button
    const btn = document.createElement('a');
    btn.className = 'item fdb-sidebar-btn';
    btn.title = game.i18n.localize('FDB.Button.Jasra');
    btn.innerHTML = '<i class="fas fa-ghost"></i>';

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        insertJasraPrefix();
    });

    // Append to sidebar tabs
    sidebarTabs.appendChild(btn);
    buttonInjected = true;
    log('Sidebar button injected');

    // Update with bot avatar if available
    updateSidebarAvatar();

    return true;
}

function updateSidebarAvatar() {
    const info = getBotInfo();
    if (!info.id || !info.avatar) return;

    const avatarUrl = `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png?size=64`;
    const btn = document.querySelector('.fdb-sidebar-btn');
    if (btn) {
        btn.innerHTML = `<img src="${avatarUrl}" style="width:24px;height:24px;border-radius:50%;" alt="Jasra" />`;
        log('Sidebar avatar updated');
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
