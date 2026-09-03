import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import { logger } from "./logger.js";
import {
  describeCurrent,
  describeQueue,
  enqueueTrack,
  pauseGuild,
  resumeGuild,
  skipGuild,
  stopGuild,
} from "./player.js";
import { findTrack, searchSuggestions } from "./search.js";

const config = (() => {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const clientId = process.env["DISCORD_CLIENT_ID"];
  if (!token || !clientId) {
    throw new Error(
      "DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID are required to start the music bot.",
    );
  }
  return { token, clientId, guildId: process.env["DISCORD_GUILD_ID"] };
})();

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Recherche et joue une musique")
    .addStringOption((option) =>
      option
        .setName("recherche")
        .setDescription("Titre, artiste ou lien YouTube, Spotify ou Apple Music")
        .setAutocomplete(true)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Met la musique en pause"),
  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Reprend la musique"),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Passe à la musique suivante"),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Arrête la musique et vide la file"),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Affiche la file d’attente"),
  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Affiche la musique en cours"),
].map((command) => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

function memberVoiceChannel(
  interaction: ChatInputCommandInteraction,
): GuildMember["voice"]["channel"] {
  return (interaction.member as GuildMember | null)?.voice.channel ?? null;
}

function ensureGuild(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    throw new Error("Cette commande doit être utilisée sur un serveur Discord.");
  }
  return interaction.guild;
}

async function handlePlay(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = ensureGuild(interaction);
  const channel = memberVoiceChannel(interaction);
  if (!channel) {
    await interaction.reply("Rejoins un salon vocal avant de lancer une musique.");
    return;
  }

  await interaction.deferReply();
  const query = interaction.options.getString("recherche", true);
  try {
    const track = await findTrack(query, interaction.user.username);
    const result = await enqueueTrack(guild, channel, track);
    const status = result.started
      ? "Je la lance maintenant."
      : `Ajoutée en position ${result.position} dans la file.`;
    await interaction.editReply(`**${track.title}** · ${track.duration}\n${status}`);
  } catch (error) {
    logger.warn({ err: error, guildId: guild.id }, "Music search failed");
    await interaction.editReply(
      "Je n’ai pas trouvé cette musique. Essaie avec le titre et l’artiste, ou un lien YouTube.",
    );
  }
}

async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (interaction.commandName !== "play") {
    await interaction.respond([]);
    return;
  }

  const query = interaction.options.getString("recherche") ?? "";
  const choices = await searchSuggestions(query);
  await interaction.respond(choices);
}
async function handleInteraction(interaction: ChatInputCommandInteraction) {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case "play":
      await handlePlay(interaction);
      return;
    case "pause":
      await interaction.reply(
        pauseGuild(ensureGuild(interaction).id)
          ? "Musique mise en pause."
          : "Aucune musique n’est en cours.",
      );
      return;
    case "resume":
      await interaction.reply(
        resumeGuild(ensureGuild(interaction).id)
          ? "Lecture reprise."
          : "Aucune musique en pause.",
      );
      return;
    case "skip": {
      const guild = ensureGuild(interaction);
      const skipped = await skipGuild(guild);
      await interaction.reply(
        skipped ? `Musique passée : **${skipped.title}**.` : "Aucune musique n’est en cours.",
      );
      return;
    }
    case "stop": {
      const removed = stopGuild(ensureGuild(interaction).id);
      await interaction.reply(
        removed ? `Lecture arrêtée. ${removed} titre(s) retiré(s).` : "La file est déjà vide.",
      );
      return;
    }
    case "queue":
      await interaction.reply(describeQueue(ensureGuild(interaction).id));
      return;
    case "nowplaying":
      await interaction.reply(describeCurrent(ensureGuild(interaction).id));
      return;
    default:
      return;
  }
}

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: commands });
  logger.info(
    { scope: config.guildId ? "guild" : "global" },
    "Discord slash commands registered",
  );
}

export async function startMusicBot(): Promise<void> {
  await registerCommands();
  client.once("clientReady", (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Music bot connected to Discord");
  });
  client.on("interactionCreate", (interaction) => {
    if (interaction.isAutocomplete()) {
      void handleAutocomplete(interaction).catch(() => interaction.respond([]));
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    void handleInteraction(interaction).catch((error) => {
      logger.error({ err: error }, "Discord interaction failed");
      if (!interaction.isRepliable()) return;
      const response = {
        content: "Une erreur est survenue. Réessaie dans un instant.",
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        void interaction.editReply(response);
      } else {
        void interaction.reply(response);
      }
    });
  });
  await client.login(config.token);
}