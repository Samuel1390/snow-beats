import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Track } from '../../types/music';
import { upsertScannedTracks } from '../database/db';

// Limpia la extensión del archivo para mostrar un título legible en Fase 1
function parseTitleFromFilename(filename: string): string {
    return filename.replace(/\.[^/.]+$/, '').trim();
}

// Extrae la ruta de la carpeta contenedora desde la URI del archivo
function extractFolderPath(uri: string): string {
    const parts = uri.split('/');
    parts.pop();
    return parts.join('/') || 'Unknown';
}

// Escanea todos los archivos de audio locales de forma paginada y los guarda en SQLite
export async function scanLocalAudioLibrary(
    onProgress?: (message: string) => void
): Promise<number> {
    if (Platform.OS === 'web') {
        return 0;
    }

    const collected: Track[] = [];
    let hasNextPage = true;
    let after: string | undefined = undefined;
    let totalAssetsRead = 0;

    while (hasNextPage) {
        const page = await MediaLibrary.getAssetsAsync({
            mediaType: 'audio',
            first: 500,
            after,
        });

        totalAssetsRead += page.assets.length;
        onProgress?.(`Escaneando archivos (${totalAssetsRead} revisados)...`);

        for (const asset of page.assets) {
            const duration = asset.duration ?? 0;

            // Filtra audios muy cortos (ej. notas de voz o sonidos de sistema < 5s)
            if (duration < 5) continue;

            collected.push({
                id: asset.id,
                uri: asset.uri,
                filename: asset.filename,
                title: parseTitleFromFilename(asset.filename),
                artist: 'Artista desconocido',
                album: 'Álbum desconocido',
                duration,
                artworkUri: null,
                hasLyrics: false,
                folderPath: extractFolderPath(asset.uri),
                creationTime: asset.modificationTime || asset.creationTime || 0,
                playCount: 0,
                isFavorite: false,
                isHidden: false,
                isDeleted: false,
            });
        }

        // Evita bucles infinitos si el cursor no avanza
        if (!page.hasNextPage || page.assets.length === 0 || page.endCursor === after) {
            hasNextPage = false;
        } else {
            after = page.endCursor;
        }
    }

    onProgress?.(`Guardando ${collected.length} canciones...`);
    await upsertScannedTracks(collected);
    return collected.length;
}

// Escaneo incremental rápido: conserva las canciones ya en pantalla, filtra las existentes e inserta solo las nuevas
export async function scanMissingAudioTracks(
    existingIds: Set<string>,
    existingUris: Set<string>,
    existingFilenames?: Set<string>
): Promise<Track[]> {
    if (Platform.OS === 'web') {
        return [];
    }

    const missing: Track[] = [];
    const seenIds = new Set<string>(existingIds);
    const seenUris = new Set<string>(existingUris);
    let hasNextPage = true;
    let after: string | undefined = undefined;

    while (hasNextPage) {
        const page = await MediaLibrary.getAssetsAsync({
            mediaType: 'audio',
            first: 500,
            after,
            sortBy: [MediaLibrary.SortBy.creationTime],
        });

        for (const asset of page.assets) {
            const duration = asset.duration ?? 0;
            if (duration < 5) continue;

            if (seenIds.has(asset.id) || seenUris.has(asset.uri)) {
                continue;
            }
            if (existingFilenames && existingFilenames.has(asset.filename.toLowerCase())) {
                // Evita duplicar si el archivo ya fue insertado por ruta directa antes de indexarse en MediaStore
                continue;
            }

            seenIds.add(asset.id);
            seenUris.add(asset.uri);
            missing.push({
                id: asset.id,
                uri: asset.uri,
                filename: asset.filename,
                title: parseTitleFromFilename(asset.filename),
                artist: 'Artista desconocido',
                album: 'Álbum desconocido',
                duration,
                artworkUri: null,
                hasLyrics: false,
                folderPath: extractFolderPath(asset.uri),
                creationTime: asset.modificationTime || asset.creationTime || Date.now(),
                playCount: 0,
                isFavorite: false,
                isHidden: false,
                isDeleted: false,
            });
        }

        if (!page.hasNextPage || page.assets.length === 0 || page.endCursor === after) {
            hasNextPage = false;
        } else {
            after = page.endCursor;
        }
    }

    if (missing.length > 0) {
        await upsertScannedTracks(missing);
    }
    return missing;
}

// Construye y persiste una única pista recién descargada para agregarla a la UI sin recargar toda la lista
export async function upsertSingleDownloadedAudio(params: {
    filePath?: string;
    fileName?: string;
    title: string;
    thumbnail?: string | null;
    existingIds: Set<string>;
    existingUris: Set<string>;
    existingFilenames: Set<string>;
}): Promise<Track | null> {
    if (Platform.OS === 'web') return null;

    // 1. Intenta localizarla recién indexada en MediaStore (solo las páginas más recientes)
    try {
        const recentPage = await MediaLibrary.getAssetsAsync({
            mediaType: 'audio',
            first: 40,
            sortBy: [MediaLibrary.SortBy.creationTime],
        });
        const targetNameLower = (params.fileName || '').toLowerCase();
        const normalizedPath = (params.filePath || '').replace(/^file:\/\//i, '');

        const matched = recentPage.assets.find((a) => {
            if (params.existingIds.has(a.id) || params.existingUris.has(a.uri)) return false;
            if (targetNameLower && a.filename.toLowerCase() === targetNameLower) return true;
            if (normalizedPath && a.uri.includes(normalizedPath)) return true;
            return false;
        });

        if (matched) {
            const track: Track = {
                id: matched.id,
                uri: matched.uri,
                filename: matched.filename,
                title: parseTitleFromFilename(matched.filename) || params.title,
                artist: 'Artista desconocido',
                album: 'Álbum desconocido',
                duration: matched.duration ?? 0,
                artworkUri: null,
                hasLyrics: false,
                folderPath: extractFolderPath(matched.uri),
                creationTime: matched.modificationTime || matched.creationTime || Date.now(),
                playCount: 0,
                isFavorite: false,
                isHidden: false,
                isDeleted: false,
            };
            await upsertScannedTracks([track]);
            return track;
        }
    } catch { }

    // 2. Respaldo directo con la ruta física devuelta por yt-dlp si MediaStore aún no terminó de indexar
    if (!params.filePath) return null;
    const uri = params.filePath.startsWith('file://') || params.filePath.startsWith('content://')
        ? params.filePath
        : `file://${params.filePath}`;
    const filename =
        params.fileName ||
        params.filePath.split('/').pop() ||
        `${params.title}.mp3`;

    if (params.existingUris.has(uri) || params.existingFilenames.has(filename.toLowerCase())) {
        return null;
    }

    const fallbackTrack: Track = {
        id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        uri,
        filename,
        title: parseTitleFromFilename(filename) || params.title || 'Canción descargada',
        artist: 'Artista desconocido',
        album: 'Álbum desconocido',
        duration: 0,
        artworkUri: null,
        hasLyrics: false,
        folderPath: extractFolderPath(uri),
        creationTime: Date.now(),
        playCount: 0,
        isFavorite: false,
        isHidden: false,
        isDeleted: false,
    };
    await upsertScannedTracks([fallbackTrack]);
    return fallbackTrack;
}