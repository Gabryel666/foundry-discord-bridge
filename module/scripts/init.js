import { registerSettings } from './settings.js';
import { BridgeConfig } from './config-app.js';
import { GatewayClient, onDiscordMessage, sendJasraMessage, getBotInfo, setupWhisperPrefixStrip } from './gateway.js';

const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`[${MODULE_ID}]`, ...args);

let gateway = null;

// ── Jasra mode flag — toggled by button, consumed by intercept ──────────
// Using module-level flag avoids ProseMirror manipulation entirely
let jasraActive = false;

// Guard: when true, the setting change was made by Jasra's own toggle
// and should NOT trigger deactivation
let jasraSettingChange = false;

// ── Chat message type constants — handle v13/v14 differences ────────────
// v14: type → style (numeric from CHAT_MESSAGE_STYLES), whisper array controls visibility
// v13: type (string: 'whisper', 'ic', 'other'), no style field
const _isV14 = typeof CONST.CHAT_MESSAGE_STYLES !== 'undefined';
const MSG = {
    v14: _isV14,
    // For whispers: v14 uses style:OOC + whisper[], v13 uses type:'whisper' + whisper[]
    whisper: (targetIds) => _isV14
        ? { style: CONST.CHAT_MESSAGE_STYLES.OOC, whisper: targetIds }
        : { type: CONST.CHAT_MESSAGE_TYPES.WHISPER, whisper: targetIds },
    // For public messages: v14 uses style:IC, v13 uses type:'ic'
    public: () => _isV14
        ? { style: CONST.CHAT_MESSAGE_STYLES.IC }
        : { type: CONST.CHAT_MESSAGE_TYPES.IC },
    // For notification: v14 uses style:OTHER, v13 uses type:'other'
    other: () => _isV14
        ? { style: CONST.CHAT_MESSAGE_STYLES.OTHER }
        : { type: CONST.CHAT_MESSAGE_TYPES.OTHER },
};

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

        // ⛔ Mode lock: when Jasra is active, user cannot change mode manually
        // In Foundry v14, the mode buttons use split-button internal mechanics,
        // so setting hooks don't reliably intercept. We block clicks directly.
        setupModeLock();
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

let previousMessageMode = 'public';

function toggleJasraMode() {
    jasraActive = !jasraActive;

    const btn = document.getElementById('fdb-jasra-btn');
    if (btn) {
        btn.setAttribute('aria-pressed', String(jasraActive));
        btn.classList.toggle('active', jasraActive);
    }

    if (jasraActive) {
        // Sync Foundry message mode with module settings
        const chatMode = game.settings.get(MODULE_ID, 'chatMode');
        const modeMap = { invisible: 'gm', notification: 'gm', public: 'public' };
        const targetMode = modeMap[chatMode] || 'public';

        // Save current mode to restore later
        try {
            previousMessageMode = game.settings.get('core', 'messageMode') || 'public';
        } catch(e) {
            try { previousMessageMode = game.settings.get('core', 'rollMode') || 'public'; }
            catch(e2) { previousMessageMode = 'public'; }
        }

        // Apply target mode (guard prevents hook from deactivating us)
        jasraSettingChange = true;
        try {
            game.settings.set('core', 'messageMode', targetMode);
        } catch(e) {
            game.settings.set('core', 'rollMode', targetMode);
        }
        jasraSettingChange = false;

        // Synchro visuelle: forcer le bouton cible actif
        requestAnimationFrame(() => {
            document.querySelectorAll('#message-modes [data-action="messageMode"]').forEach(b => {
                const isTarget = b.dataset.mode === targetMode;
                b.classList.toggle('active', isTarget);
                b.setAttribute('aria-pressed', isTarget ? 'true' : 'false');
            });
        });

        const chatInput = document.getElementById('chat-message');
        if (chatInput) chatInput.focus();

        log('Jasra mode activated → Foundry mode:', targetMode);
    } else {
        // Restore previous mode on deactivate
        jasraSettingChange = true;
        try {
            game.settings.set('core', 'messageMode', previousMessageMode);
        } catch(e) {
            game.settings.set('core', 'rollMode', previousMessageMode);
        }
        jasraSettingChange = false;

        // Synchro visuelle: forcer les boutons à refléter le mode restauré
        requestAnimationFrame(() => {
            document.querySelectorAll('#message-modes [data-action="messageMode"]').forEach(b => {
                const isTarget = b.dataset.mode === previousMessageMode;
                b.classList.toggle('active', isTarget);
                b.setAttribute('aria-pressed', isTarget ? 'true' : 'false');
            });
        });

        log('Jasra mode deactivated → restored:', previousMessageMode);
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
        // ⛔ Loop prevention: skip messages created by our own module
        // (retour Discord→Foundry, ou les whispers créés par l'intercept lui-même)
        if (data.flags?.[MODULE_ID]?.source) return true;

        const rawContent = data.content || '';
        const plainContent = getPlainText(rawContent);

        // Check: @Jasra prefix in content (for v13/v14 consistency) OR jasra mode toggled
        const isJasra = plainContent.startsWith('@Jasra ') || jasraActive;
        if (!isJasra) return true;

        // Extract text, removing @Jasra prefix if present
        const text = plainContent.replace(/^@Jasra\s*/, '').trim();
        if (!text) return false;

        // Don't clear jasra mode — stays active until user clicks again
        // So they can send multiple messages to Jasra in a row

        const mode = game.settings.get(MODULE_ID, 'chatMode');
        const authorName = game.user.name || 'MJ';

        sendJasraMessage(authorName, text);

        if (mode === 'invisible') {
            ChatMessage.create(Object.assign({
                content: `<div class="fdb-message"><span class="fdb-content">${escapeHtml(text)}</span></div>`,
                speaker: { alias: authorName },
                flags: { [MODULE_ID]: { source: 'jasra-private' } },
            }, MSG.whisper([game.user.id])));
            return false;
        }

        if (mode === 'notification') {
            ChatMessage.create(Object.assign({
                content: `<div class="fdb-message"><span class="fdb-content">${escapeHtml(text)}</span></div>`,
                speaker: { alias: authorName },
                flags: { [MODULE_ID]: { source: 'jasra-private' } },
            }, MSG.whisper([game.user.id])));
            ChatMessage.create(Object.assign({
                content: `<em class="fdb-notification">${escapeHtml(authorName)} échange avec Jasra...</em>`,
                speaker: { alias: authorName },
                flags: { [MODULE_ID]: { source: 'jasra-notify' } },
            }, MSG.other()));
            return false;
        }

        // Public
        message.updateSource({
            flags: { [MODULE_ID]: { source: 'jasra-public' } }
        });
        return true;
    });
}

// ── Mode Lock: Block manual mode changes when Jasra is active ──────────

function setupModeLock() {
    const jasraTargetMode = { invisible: 'gm', notification: 'gm', public: 'public' };

    // Intercept clicks on mode buttons (split-button items in v14)
    // Foundry utilise un event listener sur le conteneur parent (split-button),
    // donc stopImmediatePropagation sur le bouton n'empêche pas le parent.
    // Solution: laisser Foundry faire sa mise à jour, puis REVERT en raf.
    function blockManualModeChange(e) {
        if (!jasraActive) return;

        const targetMode = jasraTargetMode[game.settings.get(MODULE_ID, 'chatMode')] || 'public';
        const currentMode = game.settings.get('core', 'messageMode') || 'public';

        if (currentMode !== targetMode) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // Revert setting + visuel APRÈS que Foundry ait fini son rendering
            jasraSettingChange = true;
            game.settings.set('core', 'messageMode', targetMode);
            jasraSettingChange = false;

            // requestAnimationFrame: attend que Foundry ait peint sa modif,
            // puis on remet les visuels à leur état Jasra
            requestAnimationFrame(() => syncModeVisuals(targetMode));

            ui.notifications.warn('Jasra est actif — le mode de chat est verrouillé');
        }
    }

    // Sync visuelle: force le bouton cible à être actif, les autres inactifs
    function syncModeVisuals(targetMode) {
        document.querySelectorAll('#message-modes [data-action="messageMode"]').forEach(b => {
            const isTarget = b.dataset.mode === targetMode;
            b.classList.toggle('active', isTarget);
            b.setAttribute('aria-pressed', isTarget ? 'true' : 'false');
        });
        // Sync aussi le state interne de Foundry (setting déjà mis plus haut)
    }

    // Attache les intercepteurs de clic sur chaque bouton
    function attachModeLocks() {
        const modeContainer = document.getElementById('message-modes');
        if (!modeContainer) { setTimeout(attachModeLocks, 100); return; }

        modeContainer.querySelectorAll('[data-action="messageMode"]').forEach(btn => {
            btn.removeEventListener('click', blockManualModeChange, true);
            btn.addEventListener('click', blockManualModeChange, true);
        });
    }

    // Sync visuelle après chaque re-render du chat (quand Jasra est actif)
    function syncOnRender() {
        if (!jasraActive) return;
        const targetMode = jasraTargetMode[game.settings.get(MODULE_ID, 'chatMode')] || 'public';
        requestAnimationFrame(() => syncModeVisuals(targetMode));
    }

    Hooks.on('renderChatLog', () => { setTimeout(attachModeLocks, 50); syncOnRender(); });
    Hooks.on('renderChatControls', () => { setTimeout(attachModeLocks, 50); syncOnRender(); });
    attachModeLocks();
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
