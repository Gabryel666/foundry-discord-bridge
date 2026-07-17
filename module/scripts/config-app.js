const MODULE_ID = 'foundry-discord-bridge';

export class BridgeConfig extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'fdb-config',
            title: game.i18n.localize('FDB.ConfigMenu.Name'),
            template: `modules/${MODULE_ID}/templates/config.html`,
            width: 620,
            height: 520,
            resizable: true,
            closeOnSubmit: true,
            classes: ['fdb-config-window']
        });
    }

    getData() {
        const channelId = game.settings.get(MODULE_ID, 'discordChannelId');
        const guildId = game.settings.get(MODULE_ID, 'discordGuildId');
        const bridge = window.__fdbBridge;
        let channelName = '';

        // Chercher le nom du salon dans le cache du gateway
        if (channelId && guildId && bridge?.guildChannels?.[guildId]) {
            const ch = bridge.guildChannels[guildId].find(c => c.id === channelId);
            if (ch) channelName = '# ' + (ch.name || ch.id);
        }

        return {
            discordToken: game.settings.get(MODULE_ID, 'discordToken'),
            discordGuildId: guildId,
            discordChannelId: channelId,
            discordChannelName: channelName || channelId || '',
            discordWebhookUrl: game.settings.get(MODULE_ID, 'discordWebhookUrl'),
            debug: game.settings.get(MODULE_ID, 'debug'),
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        // Bouton "Salons" → peuple le select depuis le cache du gateway
        html.find('#fdb-load-channels').click((ev) => {
            ev.preventDefault();
            const guildId = html.find('[name="discordGuildId"]').val();
            const select = html.find('[name="discordChannelId"]');
            const statusEl = document.getElementById('fdb-channel-status');

            if (!guildId) {
                statusEl.textContent = '⚠️ Remplis d\'abord l\'ID du serveur.';
                return;
            }

            const bridge = window.__fdbBridge;
            const channels = guildId && bridge?.guildChannels?.[guildId];

            if (!channels || !channels.length) {
                statusEl.textContent = '⏳ Serveur pas encore chargé — réessaie dans quelques secondes.';
                return;
            }

            const textChannels = channels.filter(c => c.type === 0);
            const currentId = select.val();

            select.empty();
            textChannels.forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch.id;
                opt.textContent = '# ' + (ch.name || ch.id);
                select.append(opt);
            });

            // Pré-sélectionner la valeur actuelle
            if (currentId && textChannels.some(c => c.id === currentId)) {
                select.val(currentId);
            }

            statusEl.textContent = `✅ ${textChannels.length} salons textuels.`;
        });

        // Test de connexion complet
        html.find('#fdb-test-connection').click(async (ev) => {
            ev.preventDefault();
            const btn = ev.currentTarget;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Test...';

            const guildId = html.find('[name="discordGuildId"]').val();
            const channelId = html.find('[name="discordChannelId"]').val();
            const webhookUrl = html.find('[name="discordWebhookUrl"]').val();
            const statusEl = document.getElementById('fdb-test-result');
            const bridge = window.__fdbBridge;

            const results = [];
            let allOk = true;

            // 1. Gateway / Token
            if (bridge && bridge.connected) {
                results.push('✅ Gateway: connecté (' + bridge.botName + ')');
            } else {
                results.push('❌ Gateway: non connecté — vérifie le token');
                allOk = false;
            }

            // 2. Serveur
            if (guildId && bridge?.guildChannels?.[guildId]) {
                results.push('✅ Serveur: ' + (bridge.guildName || guildId) + ' (' + bridge.guildChannels[guildId].length + ' salons)');
            } else if (!guildId) {
                results.push('❌ Serveur: ID non défini');
                allOk = false;
            } else {
                results.push('❌ Serveur: introuvable — vérifie l\'ID');
                allOk = false;
            }

            // 3. Salon
            if (guildId && channelId && bridge?.guildChannels?.[guildId]) {
                const ch = bridge.guildChannels[guildId].find(c => c.id === channelId);
                if (ch) {
                    results.push(ch.type === 0 ? '✅ Salon: #' + ch.name + ' (textuel)' : '⚠️ Salon: #' + ch.name + ' (non textuel)');
                } else {
                    results.push('❌ Salon: introuvable dans ce serveur');
                    allOk = false;
                }
            } else if (!channelId) {
                results.push('❌ Salon: non défini');
                allOk = false;
            }

            // 4. Webhook (vérification GET)
            if (webhookUrl) {
                try {
                    const resp = await fetch(webhookUrl, { method: 'GET' });
                    if (resp.ok) {
                        const data = await resp.json();
                        results.push('✅ Webhook: actif (#' + (data.name || '?') + ')');
                    } else if (resp.status === 404) {
                        results.push('❌ Webhook: introuvable (supprimé ?)');
                        allOk = false;
                    } else {
                        results.push('❌ Webhook: erreur ' + resp.status);
                        allOk = false;
                    }
                } catch (e) {
                    results.push('❌ Webhook: injoignable');
                    allOk = false;
                }
            } else {
                results.push('❌ Webhook: URL non définie');
                allOk = false;
            }

            // 5. Discord → Foundry
            if (bridge && bridge.connected) {
                const activeId = bridge.activeChannelId || '(inconnu)';
                if (channelId && activeId !== channelId) {
                    results.push('❌ Discord → Foundry: le gateway écoute le salon ' + activeId + ' mais le formulaire a ' + channelId + ' — sauvegarde et recharge Foundry');
                    allOk = false;
                } else if (channelId) {
                    const matching = bridge.guildChannels?.[guildId]?.some(c => c.id === channelId);
                    results.push(matching ? '✅ Discord → Foundry: gateway à l\'écoute sur #' + (bridge.guildChannels[guildId].find(c => c.id === channelId)?.name || channelId) : '❌ Discord → Foundry: salon invalide');
                    if (!matching) allOk = false;
                }
            }

            statusEl.innerHTML = results.join('<br>');
            statusEl.className = 'fdb-test-result ' + (allOk ? 'fdb-test-ok' : 'fdb-test-fail');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plug"></i> ' + game.i18n.localize('FDB.Config.TestConnection');
        });
    }

    async _updateObject(event, formData) {
        const data = foundry.utils.expandObject(formData);
        if (!('debug' in data)) data.debug = false;
        for (const [key, value] of Object.entries(data)) {
            await game.settings.set(MODULE_ID, key, value);
        }

        // Mettre à jour le channel du gateway sans reconnecter
        if (data.discordChannelId && window.__fdbBridge?.gatewayInstance?.setChannel) {
            window.__fdbBridge.gatewayInstance.setChannel(data.discordChannelId);
        }

        ui.notifications.info('Foundry-Discord Bridge | Configuration sauvegardée');
    }
}
