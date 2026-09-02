import play from "play-dl";
import type { Track } from "./types.js";

const SPOTIFY_HOSTS = new Set(["open.spotify.com", "spotify.com"]);
const APPLE_MUSIC_HOSTS = new Set(["music.apple.com", "geo.music.apple.com"]);

function getSource(value: string): Track["source"] {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    if (SPOTIFY_HOSTS.has(host)) return "Spotify";
    if (APPLE_MUSIC_HOSTS.has(host)) return "Apple Music";
  } catch {
    // This is a search string, not a URL.
  }
  return "recherche";
}

async function titleFromSpotifyUrl(url: string): Promise<string | null> {
  const response = await fetch(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
  );
  if (!response.ok) return null;

  const body = (await response.json()) as { title?: unknown };
  return typeof body.title === "string" ? body.title : null;
}

async function titleFromAppleMusicUrl(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: { "user-agent": "HirosakiMusicBot/1.0" },
  });
  if (!response.ok) return null;

  const html = await response.text();
  const titleMatch = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  );
  return titleMatch?.[1]?.trim() ?? null;
}

async function resolveSearchTerm(query: string): Promise<{
  term: string;
  source: Track["source"];
}> {
  const source = getSource(query);
  if (source === "recherche") return { term: query, source };

  const title =
    source === "Spotify"
      ? await titleFromSpotifyUrl(query)
      : await titleFromAppleMusicUrl(query);

  return { term: title ?? query, source };
}

export async function findTrack(query: string, requestedBy: string): Promise<Track> {
  const { term, source } = await resolveSearchTerm(query.trim());
  const results = await play.search(term, {
    limit: 1,
    source: { youtube: "video" },
  });
  const video = results[0];

  if (!video?.url) {
    throw new Error("Aucun résultat trouvé pour cette recherche.");
  }

  return {
    title: video.title ?? term,
    url: video.url,
    duration: video.durationRaw ?? "inconnue",
    requestedBy,
    source,
  };
}