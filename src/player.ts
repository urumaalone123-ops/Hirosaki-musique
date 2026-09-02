import {
  AudioPlayerStatus,
  AudioResource,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import type { Guild } from "discord.js";
import play from "play-dl";
import { logger } from "./logger";
import type { GuildPlayer, Track } from "./types";

type RuntimePlayer = GuildPlayer & {
  audioPlayer: AudioPlayer;
  connection: VoiceConnection;
  activeResource: AudioResource | null;
};

const players = new Map<string, RuntimePlayer>();

function formatTrack(track: Track): string {
  return `**${track.title}** · ${track.duration} · ${track.source}`;
}

async function playNext(guild: Guild): Promise<void> {
  const state = players.get(guild.id);
  if (!state) return;

  const nextTrack = state.queue.shift();
  if (!nextTrack) {
    state.currentTrack = null;
    state.activeResource = null;
    return;
  }

  try {
    const stream = await play.stream(nextTrack.url, {
      quality: 2,
      discordPlayerCompatibility: true,
    });
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });
    resource.volume?.setVolume(0.65);

    state.currentTrack = nextTrack;
    state.activeResource = resource;
    state.audioPlayer.play(resource);
  } catch (error) {
    logger.error({ err: error, guildId: guild.id }, "Unable to stream track");
    state.currentTrack = null;
    await playNext(guild);
  }
}

function createPlayer(guild: Guild, channel: GuildPlayer["connectionChannel"]): RuntimePlayer {
  const audioPlayer = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Stop },
  });
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  const state: RuntimePlayer = {
    queue: [],
    connectionChannel: channel,
    currentTrack: null,
    audioPlayer,
    connection,
    activeResource: null,
  };

  connection.subscribe(audioPlayer);
  audioPlayer.on(AudioPlayerStatus.Idle, () => {
    void playNext(guild);
  });
  audioPlayer.on("error", (error) => {
    logger.error({ err: error, guildId: guild.id }, "Audio player error");
    void playNext(guild);
  });

  players.set(guild.id, state);
  return state;
}

export function getGuildPlayer(guildId: string): RuntimePlayer | undefined {
  return players.get(guildId);
}

export async function enqueueTrack(
  guild: Guild,
  channel: GuildPlayer["connectionChannel"],
  track: Track,
): Promise<{ started: boolean; position: number }> {
  const state = players.get(guild.id) ?? createPlayer(guild, channel);
  const wasIdle = state.currentTrack === null && state.queue.length === 0;
  state.queue.push(track);

  if (wasIdle) await playNext(guild);

  return {
    started: wasIdle,
    position: state.queue.length,
  };
}

export function pauseGuild(guildId: string): boolean {
  const state = players.get(guildId);
  return Boolean(state && state.audioPlayer.pause());
}

export function resumeGuild(guildId: string): boolean {
  const state = players.get(guildId);
  return Boolean(state && state.audioPlayer.unpause());
}

export async function skipGuild(guild: Guild): Promise<Track | null> {
  const state = players.get(guild.id);
  if (!state) return null;

  const skipped = state.currentTrack;
  state.audioPlayer.stop(true);
  return skipped;
}

export function stopGuild(guildId: string): number {
  const state = players.get(guildId);
  if (!state) return 0;

  const removed = state.queue.length + (state.currentTrack ? 1 : 0);
  state.queue.length = 0;
  state.currentTrack = null;
  state.audioPlayer.stop(true);
  state.connection.destroy();
  players.delete(guildId);
  return removed;
}

export function describeQueue(guildId: string): string {
  const state = players.get(guildId);
  if (!state?.currentTrack && !state?.queue.length) {
    return "La file d’attente est vide.";
  }

  const lines: string[] = [];
  if (state.currentTrack) {
    lines.push(`Lecture : ${formatTrack(state.currentTrack)}`);
  }
  state.queue.slice(0, 10).forEach((track, index) => {
    lines.push(`${index + 1}. ${formatTrack(track)}`);
  });
  if (state.queue.length > 10) {
    lines.push(`… et ${state.queue.length - 10} autre(s).`);
  }
  return lines.join("\n");
}

export function describeCurrent(guildId: string): string {
  const track = players.get(guildId)?.currentTrack;
  return track ? `Lecture : ${formatTrack(track)}` : "Aucune musique n’est en cours.";
}