import type { VoiceBasedChannel } from "discord.js";

export type Track = {
  title: string;
  url: string;
  duration: string;
  requestedBy: string;
  source: "YouTube" | "Spotify" | "Apple Music" | "recherche";
};

export type GuildPlayer = {
  queue: Track[];
  connectionChannel: VoiceBasedChannel;
  currentTrack: Track | null;
};