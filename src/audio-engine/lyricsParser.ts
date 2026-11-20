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
