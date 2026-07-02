import { registerSettings } from './settings.js';
import { BridgeConfig } from './config-app.js';
import { GatewayClient, onDiscordMessage, sendToDiscord } from './gateway.js';

const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

let gateway = null;

Hooks.once('init', () => {
    log('Initializing module');
    registerSettings();
    log('Settings registered');
});

Hooks.once('ready', () => {
    log('Ready');
    if (!game.settings.get(MODULE_ID, 'enabled')) {
        log('Disabled by settings');
        return;
    }

    // Only GM connects to gateway (prevents duplicates)
    if (game.user.isGM) {
        connectGateway();
    }

    // Foundry → Discord via webhook
    Hooks.on('createChatMessage', (message) => {
        if (!game.user.isGM) return;
        sendToDiscord(message);
    });

    // Cleanup on close
    Hooks.on('closeApplication', () => {
        if (gateway) { gateway.close(); gateway = null; }
    });
});

function connectGateway() {
    const token = game.settings.get(MODULE_ID, 'discordToken');
    const guildId = game.settings.get(MODULE_ID, 'discordGuildId');
    const channelId = game.settings.get(MODULE_ID, 'discordChannelId');

    if (!token || !guildId || !channelId) {
        log('Missing config — open Configure Bridge to set token, guild ID, channel ID');
        return;
    }

    gateway = new GatewayClient({ token, guildId, channelId, onMessage: onDiscordMessage });
    gateway.connect();
    ui.notifications.info('Foundry-Discord Bridge | Connecté à Discord');
    log('Gateway connecting...');
}
