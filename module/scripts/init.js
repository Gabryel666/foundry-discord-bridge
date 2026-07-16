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

    // Listen for chat rendering — v13 hooks + v14's dedicated hook
    const tryDebounced = () => setTimeout(tryInjectButton, 50);
    Hooks.on('renderChatLog', tryDebounced);
    Hooks.on('changeSidebarTab', tryDebounced);
    Hooks.on('toggleSidebar', tryDebounced);
    Hooks.on('renderSidebar', tryDebounced);
    Hooks.on('collapseChatLog', tryDebounced);

    // Foundry v14: fires when chat input is reparented
    // Provides elements that were moved so we can target them directly
    Hooks.on('renderChatInput', tryDebounced);
}

function tryInjectButton() {
    // Already injected and in DOM?
    if (document.getElementById('fdb-jasra-btn')) return true;

    const btn = createJasraButton();

    // ── Strategy 1: Foundry v13 — #roll-privacy (split-button container) ──
    const rollPrivacy = document.getElementById('roll-privacy');
    if (rollPrivacy) {
        rollPrivacy.appendChild(btn);
        log('Button injected into #roll-privacy (v13)');
        updateButtonAvatar();
        return true;
    }

    // ── Strategy 2: Foundry v14 — Message mode toolbar buttons ──
    // In v14, mode buttons use data-action="messageMode" in the chat controls bar
    const modeButtons = document.querySelectorAll('[data-action="messageMode"]');
    if (modeButtons.length > 0) {
        const parent = modeButtons[modeButtons.length - 1].parentElement;
        if (parent && parent !== document.body) {
            parent.appendChild(btn);
            log('Button injected into message mode toolbar (v14)');
            updateButtonAvatar();
            return true;
        }
    }

    // ── Strategy 3: Foundry v14 — #chat-controls container ──
    const chatControls = document.querySelector('#chat-controls, .chat-controls');
    if (chatControls) {
        chatControls.appendChild(btn);
        log('Button injected into chat controls');
        updateButtonAvatar();
        return true;
    }

    // ── Strategy 4: Foundry — chat footer area ──
    const chatFooter = document.querySelector('footer.chat-footer, section#chat > footer');
    if (chatFooter) {
        chatFooter.appendChild(btn);
        log('Button injected into chat footer');
        updateButtonAvatar();
        return true;
    }

    // ── Strategy 5: Fallback — insert before chat input ──
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

    // ── Strategy 6: Last resort — inject into #chat itself ──
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

    // Foundry v13: textarea with .value
    if (chatInput.tagName === 'TEXTAREA') {
        if (chatInput.value.startsWith('@Jasra ')) {
            chatInput.focus();
            return;
        }
        chatInput.value = '@Jasra ' + chatInput.value;
        chatInput.focus();
        chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
        return;
    }

    // Foundry v14: ProseMirror contenteditable div
    // Use the ChatInputPlugin API if available, otherwise fallback to textContent
    if (chatInput.isContentEditable) {
        // Focus the editor first
        chatInput.focus();

        // Try ProseMirror API
        const view = chatInput._pmView || chatInput.closest('[data-pm-view]')?._pmView;
        if (view && view.dispatch) {
            const { tr, Selection } = view.state;
            const doc = view.state.doc;
            const text = '@Jasra ';
            if (!doc.textBetween(0, doc.content.size, '\n', '\n').startsWith(text)) {
                const tr2 = view.state.tr.insertText(text, 0);
                view.dispatch(tr2);
            }
            return;
        }

        // Fallback: manual DOM manipulation
        if (!chatInput.textContent.startsWith('@Jasra ')) {
            chatInput.textContent = '@Jasra ' + chatInput.textContent;
        }
        // Place cursor at end
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(chatInput);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }
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
