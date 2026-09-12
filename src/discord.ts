import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { DiscordController } from './discord-controller.js';
import type { Engine } from './engine.js';
import { runtime } from './runtime.js';
import type { Task } from './domain.js';

export function routeChannel(task: Task, channels: Record<'engineering' | 'ui_ux' | 'performance', string>) {
  // Once discussion starts, ownership stays fixed even if a revision suggests a different team.
  return task.discord?.channelId ?? channels[task.plans[0]?.team ?? 'engineering'] ?? channels.engineering;
}

export function discordSettings() {
  for (const key of ['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'DISCORD_CHANNEL_ID', 'DISCORD_APPROVER_IDS']) {
    if (!process.env[key]?.trim()) throw new Error(`Set ${key} before starting Discord. See docs/DISCORD_DEMO.md.`);
  }
  const guildId = process.env.DISCORD_GUILD_ID!.trim();
  const channelId = process.env.DISCORD_CHANNEL_ID!.trim();
  const channels = { engineering: channelId, ui_ux: process.env.DISCORD_UI_UX_CHANNEL_ID?.trim() || channelId,
    performance: process.env.DISCORD_PERFORMANCE_CHANNEL_ID?.trim() || channelId };
  const approverIds = new Set(process.env.DISCORD_APPROVER_IDS!.split(',').map(id => id.trim()).filter(Boolean));
  if (![guildId, ...Object.values(channels), ...approverIds].every(id => /^\d{17,20}$/.test(id))) throw new Error('Discord IDs must be numeric IDs copied with Developer Mode.');
  return { token: process.env.DISCORD_BOT_TOKEN!, guildId, channelId, channels, approverIds };
}

export async function startDiscord(engine: Engine, runJobs = true) {
  const settings = discordSettings();
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    allowedMentions: { parse: [], repliedUser: false } });
  client.on(Events.Error, error => console.error('Discord connection error:', error.message));
  try {
    await client.login(settings.token);
    if (!client.isReady()) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Discord did not become ready within 30 seconds.')), 30_000);
      client.once(Events.ClientReady, () => { clearTimeout(timer); resolve(); });
    });
    const controllers = new Map<string, DiscordController>();
    for (const channelId of new Set(Object.values(settings.channels))) {
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText || channel.guildId !== settings.guildId) {
        throw new Error('DISCORD_CHANNEL_ID must be a text channel in DISCORD_GUILD_ID.');
      }
      const member = channel.guild.members.me ?? await channel.guild.members.fetchMe();
      if (!channel.permissionsFor(member).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory])) {
        throw new Error('Grant the bot View Channel, Send Messages, and Read Message History in the configured channel.');
      }
      const controller = new DiscordController(engine, { ...settings, channelId, botId: client.user!.id,
        consoleUrl: `http://127.0.0.1:${process.env.DEMO_OPERATOR_PORT || Number(process.env.FEEDBACK_PORT || 4318) + 1}/`,
        route: task => routeChannel(task, settings.channels) }, {
        async send(text, replyTo, controls) {
          const ids: string[] = [];
          // Mention parsing and link previews are disabled for customer/model-generated content.
          const characters = Array.from(text);
          for (let offset = 0; offset < characters.length; offset += 950) {
            const sent = await channel.send({ content: characters.slice(offset, offset + 950).join(''),
              allowedMentions: { parse: [], repliedUser: false }, flags: MessageFlags.SuppressEmbeds,
              ...(controls && offset + 950 >= characters.length ? { components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`orbit:approve:${controls.taskId}:${controls.version}`).setLabel(`Approve v${controls.version}`).setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`orbit:changes:${controls.taskId}:${controls.version}`).setLabel('Request changes').setStyle(ButtonStyle.Secondary),
              )] } : {}),
              ...(replyTo ? { reply: { messageReference: replyTo, failIfNotExists: false } } : {}) });
            ids.push(sent.id);
          }
          return ids;
        },
      });
      controllers.set(channelId, controller);
    }
    // Preserve arrival order across human comments and approvals; model jobs run independently.
    let incoming = Promise.resolve();
    client.on(Events.InteractionCreate, interaction => {
      if (!interaction.isButton() && !interaction.isModalSubmit()) return;
      const match = /^orbit:(approve|changes|submit):([a-f0-9-]{36}):(\d+)$/.exec(interaction.customId);
      if (!match) return;
      void (async () => {
        const controller = controllers.get(interaction.channelId ?? '');
        const task = engine.get(match[2]!);
        if (!controller || task.discord?.channelId !== interaction.channelId || task.discord.guildId !== interaction.guildId) throw new Error('This action does not belong to this channel.');
        if (interaction.isButton() && match[1] === 'changes') {
          await interaction.showModal(new ModalBuilder().setCustomId(`orbit:submit:${task.id}:${match[3]}`).setTitle(`Request changes to plan v${match[3]}`)
            .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
              .setCustomId('feedback').setLabel('What should Codex change?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000))));
          return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const content = interaction.isModalSubmit()
          ? `<@${client.user!.id}> changes ${match[3]} ${interaction.fields.getTextInputValue('feedback')}`
          : `<@${client.user!.id}> approve ${match[3]}`;
        incoming = incoming.then(() => controller.handle({ id: interaction.id, guildId: interaction.guildId,
          channelId: interaction.channelId!, authorId: interaction.user.id, bot: false, content, replyTo: task.discord!.messageId }));
        await incoming;
        await interaction.editReply('Processed. See the task reply in this channel for the outcome.');
      })().catch(async error => {
        const message = error instanceof Error ? error.message : 'Could not process this action.';
        if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => {});
        else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
      });
    });
    client.on(Events.MessageCreate, message => {
      const controller = controllers.get(message.channelId);
      if (!controller) return;
      incoming = incoming.then(() => controller.handle({ id: message.id, guildId: message.guildId,
        channelId: message.channelId, authorId: message.author.id, bot: message.author.bot,
        webhook: !!message.webhookId, content: message.content, replyTo: message.reference?.messageId }))
        .catch(error => console.error('Discord message failed:', error instanceof Error ? error.message : error));
    });
    let syncing: Promise<void> | undefined;
    let working: Promise<void> | undefined;
    const tick = () => {
      if (!syncing) syncing = (async () => { for (const controller of controllers.values()) await controller.sync(); })()
        .catch(error => console.error('Discord notification failed:', error.message))
        .finally(() => { syncing = undefined; });
      if (runJobs && !working && process.env.JOB_RUNNER !== 'inngest') {
        working = engine.drain().catch(error => console.error('Discord worker failed:', error.message))
          .finally(() => { working = undefined; });
      }
    };
    tick();
    const timer = setInterval(tick, 1500);
    console.log(`Discord connected as ${client.user!.tag} in ${controllers.size} configured channel(s). ${engine.provider.label}`);
    return async () => { clearInterval(timer); client.removeAllListeners(Events.MessageCreate); client.removeAllListeners(Events.InteractionCreate); await incoming; await working; await syncing;
      for (const controller of controllers.values()) await controller.stop(); await client.destroy(); };
  } catch (error) { await client.destroy(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const main = async () => {
    discordSettings();
    const { engine, store } = runtime();
    try {
      const stop = await startDiscord(engine);
      let stopping = false;
      const shutdown = async () => { if (stopping) return; stopping = true; await stop(); store.close(); };
      process.once('SIGINT', () => { void shutdown(); });
      process.once('SIGTERM', () => { void shutdown(); });
    } catch (error) { store.close(); throw error; }
  };
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
