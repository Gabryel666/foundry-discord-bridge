import { registerSettings } from './settings.js';
import { BridgeConfig } from './config-app.js';
import { GatewayClient, onDiscordMessage, sendJasraMessage, getBotInfo, setupWhisperPrefixStrip } from './gateway.js';

const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`[${MODULE_ID}]`, ...args);

let gateway = null;

// ── Jasra mode flag — toggled by button, consumed by intercept ──────────
// Using module-level flag avoids ProseMirror manipulation entirely
let jasraActive = false;

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
    tryInjectButton();

    const tryDebounced = () => setTimeout(tryInjectButton, 50);
    Hooks.on('renderChatLog', tryDebounced);
    Hooks.on('changeSidebarTab', tryDebounced);
    Hooks.on('toggleSidebar', tryDebounced);
    Hooks.on('renderSidebar', tryDebounced);
    Hooks.on('collapseChatLog', tryDebounced);
    Hooks.on('renderChatInput', tryDebounced);
}

function tryInjectButton() {
    if (document.getElementById('fdb-jasra-btn')) return true;

    const btn = createJasraButton();

    // Strategy 1: Foundry v14 — inject into #chat-controls after modes
    const messageModes = document.getElementById('message-modes');
    if (messageModes && messageModes.parentElement) {
        messageModes.parentElement.insertBefore(btn, messageModes.nextSibling);
        log('Button injected into #chat-controls (v14)');
        updateButtonAvatar();
        return true;
    }

    // Strategy 2: Foundry v13 — #roll-privacy (legacy split-button)
    const rollPrivacy = document.getElementById('roll-privacy');
    if (rollPrivacy) {
        rollPrivacy.appendChild(btn);
        log('Button injected into #roll-privacy (v13)');
        updateButtonAvatar();
        return true;
    }

    // Strategy 3: data-action selector (works both v13 and v14)
    const modeButtons = document.querySelectorAll('[data-action="messageMode"]');
    if (modeButtons.length > 0) {
        const parent = modeButtons[modeButtons.length - 1].parentElement;
        if (parent && parent !== document.body) {
            parent.appendChild(btn);
            log('Button injected via data-action messageMode');
            updateButtonAvatar();
            return true;
        }
    }

    // Strategy 4: #chat-controls container
    const chatControls = document.getElementById('chat-controls');
    if (chatControls) {
        chatControls.appendChild(btn);
        log('Button injected into #chat-controls');
        updateButtonAvatar();
        return true;
    }

    // Strategy 5: Insert before chat input
    const chatMessage = document.getElementById('chat-message');
    if (chatMessage) {
        const parent = chatMessage.parentElement;
        if (parent) {
            parent.insertBefore(btn, chatMessage);
            log('Button injected before chat input (fallback)');
            updateButtonAvatar();
            return true;
        }
    }

    // Strategy 6: Last resort — inject into #chat
    const chat = document.getElementById('chat');
    if (chat) {
        chat.appendChild(btn);
        log('Button injected into #chat (last resort)');
        updateButtonAvatar();
        return true;
    }

    return false;
}

function createJasraButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'fdb-jasra-btn';
    btn.className = 'ui-control icon fdb-jasra-btn';
    btn.title = game.i18n.localize('FDB.Button.Jasra');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = '<i class="fas fa-ghost"></i>';

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleJasraMode();
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

// ── Toggle Jasra Mode ──────────────────────────────────────────────────

function toggleJasraMode() {
    jasraActive = !jasraActive;

    const btn = document.getElementById('fdb-jasra-btn');
    if (btn) {
        btn.setAttribute('aria-pressed', String(jasraActive));
        btn.classList.toggle('active', jasraActive);
    }

    if (jasraActive) {
        log('Jasra mode activated');
        // Focus the chat input so user can start typing
        const chatInput = document.getElementById('chat-message');
        if (chatInput) chatInput.focus();
    } else {
        log('Jasra mode deactivated');
    }
}

/** Strip HTML tags and get plain text content */
function getPlainText(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || '';
}

// ── Intercept @Jasra Messages ───────────────────────────────────────────

function setupJasraIntercept() {
    Hooks.on('preCreateChatMessage', (message, data, options, userId) => {
        const rawContent = data.content || '';
        const plainContent = getPlainText(rawContent);

        // Check: @Jasra prefix in content (for v13/v14 consistency) OR jasra mode toggled
        const isJasra = plainContent.startsWith('@Jasra ') || jasraActive;
        if (!isJasra) return true;

        // Extract text, removing @Jasra prefix if present
        const text = plainContent.replace(/^@Jasra\s*/, '').trim();
        if (!text) return false;

        // Clear jasra mode after intercept
        jasraActive = false;
        const btn = document.getElementById('fdb-jasra-btn');
        if (btn) {
            btn.setAttribute('aria-pressed', 'false');
            btn.classList.remove('active');
        }

        const mode = game.settings.get(MODULE_ID, 'chatMode');
        const authorName = game.user.name || 'MJ';

        sendJasraMessage(authorName, text);

        if (mode === 'invisible') {
            ChatMessage.create({
                content: `<div class="fdb-message"><span class="fdb-content">${escapeHtml(text)}</span></div>`,
                speaker: { alias: authorName },
                type: CONST.CHAT_MESSAGE_TYPES.WHISPER,
                whisper: [game.user.id],
                flags: { [MODULE_ID]: { source: 'jasra-private' } },
            });
            return false;
        }

        if (mode === 'notification') {
            ChatMessage.create({
                content: `<div class="fdb-message"><span class="fdb-content">${escapeHtml(text)}</span></div>`,
                speaker: { alias: authorName },
                type: CONST.CHAT_MESSAGE_TYPES.WHISPER,
                whisper: [game.user.id],
                flags: { [MODULE_ID]: { source: 'jasra-private' } },
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
