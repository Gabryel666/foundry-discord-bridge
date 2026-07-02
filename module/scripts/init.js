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
        injectJasraButton();
    }

    Hooks.on('closeApplication', () => {
        if (gateway) { gateway.close(); gateway = null; }
    });
});

// ── Jasra Button — Near Chat Input ──────────────────────────────────────

function injectJasraButton() {
    if (buttonInjected) return;

    const attempt = () => {
        if (buttonInjected) return true;

        // Find the whisper/visibility buttons above chat input
        // These are inside #chat-form or near #chat-message
        const chatForm = document.getElementById('chat-form');
        if (!chatForm) return false;

        // The visibility buttons are typically in a .chat-control-btns or similar
        // Look for existing buttons (Everyone, GM only, etc.)
        const existingBtns = chatForm.querySelectorAll('button, .chat-control-group button, a.button');

        // If we found buttons, insert after the last one
        if (existingBtns.length > 0) {
            const lastBtn = existingBtns[existingBtns.length - 1];
            const btn = createJasraButton();
            lastBtn.parentNode.insertBefore(btn, lastBtn.nextSibling);
            buttonInjected = true;
            log('Button injected after chat control buttons');
            updateButtonAvatar();
            return true;
        }

        // Fallback: look for the input itself and prepend before it
        const chatInput = document.getElementById('chat-message');
        if (chatInput) {
            const container = chatInput.closest('.flexrow') || chatInput.parentElement;
            if (container) {
                const btn = createJasraButton();
                container.insertBefore(btn, container.firstChild);
                buttonInjected = true;
                log('Button injected before chat input');
                updateButtonAvatar();
                return true;
            }
        }

        return false;
    };

    if (attempt()) return;

    // Retry
    const interval = setInterval(() => {
        if (attempt()) clearInterval(interval);
    }, 1000);

    setTimeout(() => clearInterval(interval), 15000);
}

function createJasraButton() {
    const btn = document.createElement('a');
    btn.className = 'button fdb-jasra-btn';
    btn.title = game.i18n.localize('FDB.Button.Jasra');
    btn.innerHTML = '<i class="fas fa-ghost"></i>';
    btn.style.cssText = 'cursor:pointer; display:flex; align-items:center; justify-content:center; margin:0 2px; padding:2px 6px; color:#5865f2; transition:all 0.2s;';

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        insertJasraPrefix();
    });

    btn.addEventListener('mouseenter', () => {
        btn.style.color = '#7289da';
        btn.style.textShadow = '0 0 8px rgba(88,101,242,0.5)';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.color = '#5865f2';
        btn.style.textShadow = 'none';
    });

    return btn;
}

function updateButtonAvatar() {
    const info = getBotInfo();
    if (!info.id || !info.avatar) return;

    const avatarUrl = `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png?size=64`;
    const btn = document.querySelector('.fdb-jasra-btn');
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
