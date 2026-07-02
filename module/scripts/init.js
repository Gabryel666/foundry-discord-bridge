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

    // Strategy 1: Find the control button row at the top of the chat
    // In Foundry v13, these are <a> or <button> elements in a flex row
    // above the chat input. The "self" button is typically the last one
    // in the left group (person icon).

    // Find all anchor/button elements that look like roll-mode controls
    // They sit above the chat input in a horizontal row
    const chatMessage = document.getElementById('chat-message');
    if (!chatMessage) return false;

    // Walk up from the input to find the container that holds
    // both the control buttons AND the input
    const chatPanel = chatMessage.closest('.chat-log')
        || chatMessage.closest('#chat')
        || chatMessage.closest('[class*="chat"]')
        || chatMessage.parentElement?.parentElement;
    if (!chatPanel) return false;

    // Find the button row — it's a flex container with small square buttons
    // before the input area. Look for a container of <a> elements with
    // icons (fa-dice, fa-eye, fa-user, etc.)
    const allBtnContainers = chatPanel.querySelectorAll('div');
    let controlRow = null;
    for (const div of allBtnContainers) {
        const links = div.querySelectorAll(':scope > a, :scope > button');
        if (links.length >= 3 && links.length <= 8) {
            // Check if they contain <i> icons (typical of control buttons)
            const hasIcons = Array.from(links).some(l => l.querySelector('i'));
            if (hasIcons) {
                controlRow = div;
                break;
            }
        }
    }

    if (controlRow) {
        // Find the last button before the "utility" buttons (save/trash)
        // The roll-mode buttons are typically the first group
        // We insert after the last roll-mode button
        const btn = createJasraButton();
        controlRow.appendChild(btn);
        log('Button injected into control row:', controlRow.className);
        updateButtonAvatar();
        return true;
    }

    // Fallback: insert before the chat input
    const parent = chatMessage.parentElement;
    if (!parent) return false;

    const btn = createJasraButton();
    parent.insertBefore(btn, chatMessage);
    log('Button injected before chat input (fallback)');
    updateButtonAvatar();
    return true;
}

function createJasraButton() {
    const btn = document.createElement('a');
    btn.id = 'fdb-jasra-btn';
    btn.className = 'button fdb-jasra-btn';
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
