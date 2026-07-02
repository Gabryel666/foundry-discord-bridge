const MODULE_ID = 'foundry-discord-bridge';

export class BridgeConfig extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'fdb-config',
            title: game.i18n.localize('FDB.ConfigMenu.Name'),
            template: `modules/${MODULE_ID}/templates/config.html`,
            width: 500,
            closeOnSubmit: true,
            classes: ['fdb-config-window']
        });
    }

    getData() {
        return {
            discordToken: game.settings.get(MODULE_ID, 'discordToken'),
            discordGuildId: game.settings.get(MODULE_ID, 'discordGuildId'),
            discordChannelId: game.settings.get(MODULE_ID, 'discordChannelId'),
            discordWebhookUrl: game.settings.get(MODULE_ID, 'discordWebhookUrl')
        };
    }

    async _updateObject(event, formData) {
        for (const [key, value] of Object.entries(formData)) {
            await game.settings.set(MODULE_ID, key, value);
        }
        ui.notifications.info('Foundry-Discord Bridge | Configuration sauvegardée');
    }
}
