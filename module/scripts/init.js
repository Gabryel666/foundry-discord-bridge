import { registerSettings } from './settings.js';
import { BridgeConfig } from './config-app.js';
import { GatewayClient, onDiscordMessage, sendJasraMessage } from './gateway.js';

const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`[${MODULE_ID}]`, ...args);

let gateway = null;

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

    // GM: connect gateway + intercept @Jasra
    if (game.user.isGM) {
        connectGateway();
        setupJasraIntercept();
    }

    // Add Jasra button to chat (GM only)
    Hooks.on('getChatControlButtons', addJasraButton);

    // Cleanup
    Hooks.on('closeApplication', () => {
        if (gateway) { gateway.close(); gateway = null; }
    });
});

// ── Jasra Button ────────────────────────────────────────────────────────

function addJasraButton(controls) {
    if (!game.user.isGM) return;

    const chatControls = controls.find(c => c.name === 'chat');
    if (!chatControls) return;

    chatControls.tools.push({
        name: 'jasra',
        title: game.i18n.localize('FDB.Button.Jasra'),
        icon: 'fas fa-ghost',
        button: true,
        onClick: () => insertJasraPrefix()
    });
}

function insertJasraPrefix() {
    const chatInput = document.getElementById('chat-message');
    if (!chatInput) return;

    // If already starts with @Jasra, don't duplicate
    if (chatInput.value.startsWith('@Jasra ')) {
        chatInput.focus();
        return;
    }

    chatInput.value = '@Jasra ' + chatInput.value;
    chatInput.focus();

    // Move cursor to end
    chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
}

// ── Intercept @Jasra Messages ───────────────────────────────────────────

function setupJasraIntercept() {
    Hooks.on('preCreateChatMessage', (message, data, options, userId) => {
        const content = data.content || '';
        if (!content.startsWith('@Jasra ')) return true; // let it through

        // Extract the actual message (remove @Jasra prefix)
        const text = content.replace(/^@Jasra\s*/, '').trim();
        if (!text) return false; // empty message, cancel

        const mode = game.settings.get(MODULE_ID, 'chatMode');
        const authorName = game.user.name || 'MJ';

        // Send to Discord via webhook
        sendJasraMessage(authorName, text);

        if (mode === 'invisible') {
            // Option 1: cancel message entirely — nothing in Foundry
            return false;
        }

        if (mode === 'notification') {
            // Option 2: cancel original, show whisper notification to everyone
            ChatMessage.create({
                content: `<em class="fdb-notification">[MJ] échange avec Jasra...</em>`,
                speaker: { alias: authorName },
                type: CONST.CHAT_MESSAGE_TYPES.OTHER,
                flags: { [MODULE_ID]: { source: 'jasra-notify' } },
            });
            return false; // cancel original
        }

        // Option 3: public — let the original message through
        // Just add a flag so we know it's a Jasra message
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
