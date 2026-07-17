const MODULE_ID = 'foundry-discord-bridge';

import { getCachedChannels, isGatewayReady } from './gateway.js';

export class BridgeConfig extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'fdb-config',
            title: game.i18n.localize('FDB.ConfigMenu.Name'),
            template: `modules/${MODULE_ID}/templates/config.html`,
            width: 520,
            closeOnSubmit: true,
            classes: ['fdb-config-window']
        });
    }

    getData() {
        return {
            discordToken: game.settings.get(MODULE_ID, 'discordToken'),
            discordGuildId: game.settings.get(MODULE_ID, 'discordGuildId'),
            discordChannelId: game.settings.get(MODULE_ID, 'discordChannelId'),
            discordWebhookUrl: game.settings.get(MODULE_ID, 'discordWebhookUrl'),
            debug: game.settings.get(MODULE_ID, 'debug'),
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        // Charger les salons depuis le cache du gateway Discord
        html.find('#fdb-load-channels').click((ev) => {
            ev.preventDefault();
            const btn = ev.currentTarget;
            const guildId = html.find('[name="discordGuildId"]').val();
            const select = html.find('#fdb-channel-select');
            const statusEl = document.getElementById('fdb-channel-status');

            if (!guildId) {
                statusEl.textContent = '⚠️ Remplis d\'abord l\'ID du serveur.';
                statusEl.className = 'fdb-channel-status fdb-test-fail';
                return;
            }

            if (!isGatewayReady()) {
                statusEl.textContent = '⏳ Connexion au gateway Discord en cours… réessaie dans quelques secondes.';
                statusEl.className = 'fdb-channel-status fdb-test-fail';
                return;
            }

            const channels = getCachedChannels(guildId);
            if (!channels) {
                statusEl.textContent = '❌ Serveur introuvable dans le cache. Vérifie l\'ID du serveur.';
                statusEl.className = 'fdb-channel-status fdb-test-fail';
                return;
            }

            // Filtrer salons textuels (type 0)
            const textChannels = channels.filter(c => c.type === 0);

            select.empty();
            const defaultOpt = document.createElement('option');
            defaultOpt.value = '';
            defaultOpt.textContent = '— Choisir un salon —';
            select.append(defaultOpt);

            textChannels.forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch.id;
                opt.textContent = '# ' + ch.name;
                select.append(opt);
            });

            // Pré-sélectionner celui déjà configuré
            const currentId = html.find('[name="discordChannelId"]').val();
            if (currentId) select.val(currentId);

            statusEl.textContent = `✅ ${textChannels.length} salons textuels trouvés. Sélectionne un salon.`;
            statusEl.className = 'fdb-channel-status fdb-test-ok';
        });

        // Quand on choisit un salon, mettre à jour le champ ID
        html.find('#fdb-channel-select').change((ev) => {
            const val = ev.currentTarget.value;
            if (val) {
                html.find('[name="discordChannelId"]').val(val);
            }
        });
    }

    async _updateObject(event, formData) {
        const data = foundry.utils.expandObject(formData);
        if (!('debug' in data)) data.debug = false;

        for (const [key, value] of Object.entries(data)) {
            await game.settings.set(MODULE_ID, key, value);
        }
        ui.notifications.info('Foundry-Discord Bridge | Configuration sauvegardée');
    }
}
