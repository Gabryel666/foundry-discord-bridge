import { registerSettings } from './settings.js';
import { BridgeConfig } from './config-app.js';
import { GatewayClient, onDiscordMessage, sendJasraMessage } from './gateway.js';

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

// ── Jasra Button — Universal Injection ──────────────────────────────────

function injectJasraButton() {
    if (buttonInjected) return;

    // Try multiple strategies to find where to put the button
    const attempt = () => {
        if (buttonInjected) return true;

        // Strategy 1: #chat-form
        let form = document.getElementById('chat-form');
        if (form) {
            const submitBtn = form.querySelector('button[type="submit"], button:not([id])');
            if (submitBtn) {
                const btn = createButton();
                submitBtn.parentNode.insertBefore(btn, submitBtn);
                buttonInjected = true;
                log('Button injected (chat-form)');
                return true;
            }
        }

        // Strategy 2: .chat-input container (some systems)
        const chatInput = document.getElementById('chat-message');
        if (chatInput) {
            const container = chatInput.closest('form') || chatInput.parentElement;
            if (container) {
                const btn = createButton();
                container.insertBefore(btn, container.firstChild);
                buttonInjected = true;
                log('Button injected (chat-message parent)');
                return true;
            }
        }

        // Strategy 3: append to #chat-log sidebar area
        const chatLog = document.getElementById('chat-log');
        if (chatLog) {
            const btn = createButton();
            btn.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:1000;width:36px;height:36px;border-radius:50%;';
            document.body.appendChild(btn);
            buttonInjected = true;
            log('Button injected (floating)');
            return true;
        }

        return false;
    };

    // Try immediately
    if (attempt()) return;

    // Retry with delays (system might render chat later)
    const retry = setInterval(() => {
        if (attempt() || buttonInjected) clearInterval(retry);
    }, 500);

    // Stop after 10 seconds
    setTimeout(() => clearInterval(retry), 10000);
}

function createButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'fdb-jasra-btn';
    btn.className = 'fdb-jasra-btn';
    btn.title = game.i18n.localize('FDB.Button.Jasra');
    btn.innerHTML = '<i class="fas fa-ghost"></i>';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        insertJasraPrefix();
    });
    return btn;
}

function insertJasraPrefix() {
    const chatInput = document.getElementById('chat-message');
    if (!chatInput) {
        // Fallback: prompt
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

        // Send to Discord via webhook
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

// ── Gateway Connection ──────────────────────────────────────────────────

function connectGateway() {
    const token = game.settings.get(MODULE_ID, 'discordToken');
    const guildId = game.settings.get(MODULE_ID, 'discordGuildId');
    const channelId = game.settings.get(MODULE_ID, 'discordChannelId');

    if (!token || !guildId || !channelId) {
        log('Missing config — open Configure Bridge to set token, guild ID, channel ID');
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
