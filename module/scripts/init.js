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
        watchForChatArea();
    }

    Hooks.on('closeApplication', () => {
        if (gateway) { gateway.close(); gateway = null; }
    });
});

// ── Watch for Chat Area with MutationObserver ───────────────────────────

function watchForChatArea() {
    if (buttonInjected) return;

    // Try immediately
    if (tryInject()) return;

    // Use MutationObserver to detect when chat area appears
    const observer = new MutationObserver((mutations) => {
        if (buttonInjected) {
            observer.disconnect();
            return;
        }
        if (tryInject()) {
            observer.disconnect();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Safety timeout
    setTimeout(() => observer.disconnect(), 30000);
}

function tryInject() {
    if (buttonInjected) return true;

    const chatMessage = document.getElementById('chat-message');
    if (!chatMessage) return false;

    // Walk up to find the chat form container
    const chatForm = chatMessage.closest('form') || chatMessage.closest('#chat-form') || chatMessage.parentElement;
    if (!chatForm) return false;

    // Find the visibility buttons — they are siblings or nearby elements
    // Look for the control group that contains whisper buttons
    // In Foundry v13, these are typically .control-buttons or similar
    const controlGroup = chatForm.querySelector('.control-buttons, .chat-control-btns, .controls');

    if (controlGroup) {
        // Insert after the last button in the control group
        const btn = createJasraButton();
        controlGroup.appendChild(btn);
        buttonInjected = true;
        log('Button injected into control group');
        updateButtonAvatar();
        return true;
    }

    // Fallback: look for any buttons inside the form that look like whisper targets
    const buttons = chatForm.querySelectorAll('button, a.button, [role="button"]');
    if (buttons.length > 0) {
        // Find the last button and insert after it
        const lastBtn = buttons[buttons.length - 1];
        const btn = createJasraButton();
        lastBtn.parentNode.insertBefore(btn, lastBtn.nextSibling);
        buttonInjected = true;
        log('Button injected after last chat button');
        updateButtonAvatar();
        return true;
    }

    // Last resort: insert before the textarea/input
    const btn = createJasraButton();
    chatMessage.parentNode.insertBefore(btn, chatMessage);
    buttonInjected = true;
    log('Button injected before chat input');
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
        // Retry avatar update later
        setTimeout(updateButtonAvatar, 3000);
        return;
    }

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
