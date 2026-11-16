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