import play from "play-dl";
import type { Track } from "./types.js";

type SearchChoice = { name: string; value: string };
type CachedSuggestionVideo = { title: string; duration: string; expiresAt: number };

const SPOTIFY_HOSTS = new Set(["open.spotify.com", "spotify.com"]);
const APPLE_MUSIC_HOSTS = new Set(["music.apple.com", "geo.music.apple.com"]);
const SEARCH_TIMEOUT_MS = 8_000;
const SUGGESTION_CACHE_TTL_MS = 30_000;
const suggestionCache = new Map<string, { expiresAt: number; choices: SearchChoice[] }>();
const suggestionVideoCache = new Map<string, CachedSuggestionVideo>();

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength - 1) + "…";
}

function isYouTubeUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

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

export async function searchSuggestions(query: string): Promise<SearchChoice[]> {
  const normalized = query.trim();
  if (normalized.length < 2) return [];

  const cacheKey = normalized.toLowerCase();
  const cached = suggestionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.choices;

  try {
    const results = await withTimeout(
      play.search(normalized, { limit: 8, source: { youtube: "video" } }),
      SEARCH_TIMEOUT_MS,
      "La recherche YouTube a dépassé le délai.",
    );
    const choices = results
      .filter((video) => Boolean(video.url && video.title))
      .slice(0, 8)
      .map((video) => {
        const url = video.url!;
        const title = video.title!;
        const duration = video.durationRaw ?? "inconnue";
        suggestionVideoCache.set(url, {
          title,
          duration,
          expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS,
        });
        return {
          name: truncate(title + (video.durationRaw ? " · " + video.durationRaw : ""), 100),
          value: url,
        };
      });
    suggestionCache.set(cacheKey, { expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS, choices });
    return choices;
  } catch {
    return [];
  }
}
export async function findTrack(query: string, requestedBy: string): Promise<Track> {
  const normalized = query.trim();
  if (!normalized) throw new Error("La recherche est vide.");

  if (isYouTubeUrl(normalized)) {
    const cachedVideo = suggestionVideoCache.get(normalized);
    if (cachedVideo && cachedVideo.expiresAt > Date.now()) {
      return {
        title: cachedVideo.title,
        url: normalized,
        duration: cachedVideo.duration,
        requestedBy,
        source: "recherche",
      };
    }
    suggestionVideoCache.delete(normalized);

    const info = await withTimeout(
      play.video_info(normalized),
      SEARCH_TIMEOUT_MS,
      "YouTube ne répond pas à temps.",
    );
    return {
      title: info.video_details.title ?? "Vidéo YouTube",
      url: normalized,
      duration: info.video_details.durationRaw ?? "inconnue",
      requestedBy,
      source: "recherche",
    };
  }

  const { term, source } = await resolveSearchTerm(normalized);
  const results = await withTimeout(
    play.search(term, {
      limit: 1,
      source: { youtube: "video" },
    }),
    SEARCH_TIMEOUT_MS,
    "La recherche YouTube a dépassé le délai.",
  );
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