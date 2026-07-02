import { registerSettings } from './settings.js';
import { BridgeConfig } from './config-app.js';

const MODULE_ID = 'foundry-discord-bridge';
const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

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
    log('Bridge enabled, token set:', !!game.settings.get(MODULE_ID, 'discordToken'));
});
