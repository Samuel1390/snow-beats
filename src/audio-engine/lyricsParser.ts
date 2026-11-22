import { Platform } from 'react-native';
import { readTrackLyrics } from '../../modules/snow-metadata';
import { getTrackLyrics, updateTrackLyrics } from '../storage/database/db';
import { Track } from '../types/music';

export interface LyricLine {
    id: string;
    text: string;
    // Tiempo en segundos para letras sincronizadas (.lrc / SYLT); null si es letra plana
    timeSec: number | null;
}

export interface ParsedLyrics {
    lines: LyricLine[];
    isSynced: boolean;
    rawText: string;
}

// Caché LRU simple en RAM para evitar releer SQLite o disco al volver a la misma pista
const lyricsMemoryCache = new Map<string, ParsedLyrics | null>();

const TIMESTAMP_REGEX = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_REGEX = /^\[offset:([+-]?\d+)\]$/i;
const METADATA_TAG_REGEX = /^\[(ti|ar|al|au|by|re|ve|length):.*\]$/i;

// Parsea texto LRC sincronizado o texto plano de letras en una lista ordenada
export function parseLyricsText(raw: string): ParsedLyrics {
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!normalized) {
        return { lines: [], isSynced: false, rawText: '' };
    }

    const rawLines = normalized.split('\n');
    let offsetSec = 0;

    for (const line of rawLines) {
        const offsetMatch = line.trim().match(OFFSET_REGEX);
        if (offsetMatch) {
            offsetSec = parseInt(offsetMatch[1], 10) / 1000;
            break;
        }
    }

    const syncedLines: LyricLine[] = [];
    let counter = 0;

    for (const line of rawLines) {
        const trimmed = line.trim();
        if (!trimmed || OFFSET_REGEX.test(trimmed) || METADATA_TAG_REGEX.test(trimmed)) {
            continue;
        }

        const timestamps: number[] = [];
        TIMESTAMP_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null = TIMESTAMP_REGEX.exec(trimmed);
        while (match) {
            const mins = parseInt(match[1], 10);
            const secs = parseInt(match[2], 10);
            const fracRaw = match[3] ?? '0';
            const frac =
                fracRaw.length === 1
                    ? parseInt(fracRaw, 10) / 10
                    : fracRaw.length === 2
                    ? parseInt(fracRaw, 10) / 100
                    : parseInt(fracRaw, 10) / 1000;
            timestamps.push(Math.max(0, mins * 60 + secs + frac - offsetSec));
            match = TIMESTAMP_REGEX.exec(trimmed);
        }

        if (timestamps.length > 0) {
            const text = trimmed.replace(TIMESTAMP_REGEX, '').trim();
            if (text.length > 0) {
                for (const t of timestamps) {
                    syncedLines.push({
                        id: `l-${counter++}`,
                        text,
                        timeSec: t,
                    });
                }
            }
        }
    }

    if (syncedLines.length > 0) {
        syncedLines.sort((a, b) => (a.timeSec ?? 0) - (b.timeSec ?? 0));
        return {
            lines: syncedLines,
            isSynced: true,
            rawText: normalized,
        };
    }

    // Fallback: letra plana sin marcas de tiempo
    const plainLines: LyricLine[] = rawLines
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((text, idx) => ({
            id: `p-${idx}`,
            text,
            timeSec: null,
        }));

    return {
        lines: plainLines,
        isSynced: false,
        rawText: normalized,
    };
}

// Búsqueda binaria O(log N) para hallar la línea activa según el segundo actual
export function findActiveLyricIndex(lines: LyricLine[], positionSec: number): number {
    if (lines.length === 0 || lines[0].timeSec === null) return -1;
    // Pequeño adelanto de 0.15s para que la transición visual coincida con la voz
    const target = positionSec + 0.15;
    let lo = 0;
    let hi = lines.length - 1;
    let result = -1;

    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = lines[mid].timeSec ?? 0;
        if (t <= target) {
            result = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    return result;
}

// Carga letras con prioridad: caché RAM -> SQLite -> lector nativo Kotlin (y persiste en SQLite)
export async function loadTrackLyrics(track: Track): Promise<ParsedLyrics | null> {
    if (lyricsMemoryCache.has(track.id)) {
        return lyricsMemoryCache.get(track.id) ?? null;
    }

    try {
        const cachedDb = await getTrackLyrics(track.id);
        if (cachedDb) {
            const parsed = parseLyricsText(cachedDb);
            const finalVal = parsed.lines.length > 0 ? parsed : null;
            lyricsMemoryCache.set(track.id, finalVal);
            return finalVal;
        }

        if (Platform.OS !== 'web') {
            const extracted = await readTrackLyrics(track.uri);
            if (extracted) {
                const parsed = parseLyricsText(extracted);
                if (parsed.lines.length > 0) {
                    lyricsMemoryCache.set(track.id, parsed);
                    updateTrackLyrics(track.id, extracted).catch(() => {});
                    return parsed;
                }
            }
        }
    } catch { }

    lyricsMemoryCache.set(track.id, null);
    return null;
}

// Actualiza la caché RAM de letras inmediatamente después de guardar o reemplazar manualmente
export function setCachedTrackLyrics(trackId: string, rawText: string | null): ParsedLyrics | null {
    const clean = rawText?.trim() ?? '';
    if (!clean) {
        lyricsMemoryCache.set(trackId, null);
        return null;
    }
    const parsed = parseLyricsText(clean);
    const finalVal = parsed.lines.length > 0 ? parsed : null;
    lyricsMemoryCache.set(trackId, finalVal);
    return finalVal;
}

export function invalidateTrackLyricsCache(trackId: string): void {
    lyricsMemoryCache.delete(trackId);
}

const UNKNOWN_ARTIST_TOKENS = new Set([
    '',
    'unknown',
    'unknown artist',
    '<unknown>',
    'artista desconocido',
    'desconocido',
    'sin artista',
    'varios artistas',
    'various artists',
]);

function slugifyArtistForLetras(raw: string): string {
    return raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, 'e')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

// Genera el enlace www.letras.com/{artista}/ (o búsqueda por título si el artista es desconocido)
export function buildLetrasComUrl(
    artist: string,
    title: string
): { url: string; displayUrl: string; isSearchFallback: boolean } {
    const cleanArtist = artist.trim();
    const cleanTitle = title.trim();
    const isUnknown = UNKNOWN_ARTIST_TOKENS.has(cleanArtist.toLowerCase());
    const artistSlug = !isUnknown ? slugifyArtistForLetras(cleanArtist) : '';

    if (artistSlug) {
        return {
            url: `https://www.letras.com/${artistSlug}/`,
            displayUrl: `www.letras.com/${artistSlug}/`,
            isSearchFallback: false,
        };
    }

    const q = cleanTitle || cleanArtist || 'musica';
    return {
        url: `https://www.letras.com/?q=${encodeURIComponent(q)}`,
        displayUrl: `www.letras.com/?q=${q}`,
        isSearchFallback: true,
    };
}

export interface LrclibCandidate {
    id: number;
    trackName: string;
    artistName: string;
    albumName: string;
    duration: number;
    syncedLyrics: string | null;
    plainLyrics: string | null;
}

// Busca letras sincronizadas (.lrc) o planas en la API pública gratuita LRCLIB (sin login)
export async function searchLrclibLyrics(
    title: string,
    artist: string,
    durationSec?: number
): Promise<LrclibCandidate[]> {
    const cleanTitle = title.trim();
    const cleanArtist = artist.trim();
    const isUnknownArtist = UNKNOWN_ARTIST_TOKENS.has(cleanArtist.toLowerCase());

    const runQuery = async (url: string): Promise<LrclibCandidate[]> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        try {
            const resp = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'SnowBeats/1.0 (https://github.com/snow-beats)',
                },
                signal: controller.signal,
            });
            if (!resp.ok) return [];
            const data = await resp.json();
            if (!Array.isArray(data)) return [];
            return data
                .filter((item: any) => Boolean(item?.syncedLyrics || item?.plainLyrics))
                .map((item: any) => ({
                    id: Number(item.id) || Math.random(),
                    trackName: String(item.trackName || item.name || cleanTitle),
                    artistName: String(item.artistName || cleanArtist || 'Artista'),
                    albumName: String(item.albumName || ''),
                    duration: Number(item.duration) || 0,
                    syncedLyrics:
                        typeof item.syncedLyrics === 'string' && item.syncedLyrics.trim().length > 0
                            ? item.syncedLyrics.trim()
                            : null,
                    plainLyrics:
                        typeof item.plainLyrics === 'string' && item.plainLyrics.trim().length > 0
                            ? item.plainLyrics.trim()
                            : null,
                }));
        } finally {
            clearTimeout(timer);
        }
    };

    let results: LrclibCandidate[] = [];
    if (cleanTitle && !isUnknownArtist) {
        const params = `track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
        results = await runQuery(`https://lrclib.net/api/search?${params}`);
    }
    if (results.length === 0 && cleanTitle) {
        const query = isUnknownArtist ? cleanTitle : `${cleanTitle} ${cleanArtist}`;
        results = await runQuery(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
    }

    // Prioriza resultados con .lrc sincronizado y duración cercana a la pista
    return results
        .sort((a, b) => {
            const syncScoreA = a.syncedLyrics ? 0 : 1;
            const syncScoreB = b.syncedLyrics ? 0 : 1;
            if (syncScoreA !== syncScoreB) return syncScoreA - syncScoreB;
            if (durationSec && durationSec > 0) {
                return Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec);
            }
            return 0;
        })
        .slice(0, 6);
}

