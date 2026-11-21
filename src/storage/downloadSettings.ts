import { getAppSetting, setAppSetting } from './database/db';

export const DEFAULT_VIDEO_DOWNLOAD_PATH =
    'Almacenamiento interno/Snow beats/Download/Snow beats video';
export const DEFAULT_AUDIO_DOWNLOAD_PATH =
    'Almacenamiento interno/Snow beats/Download/Snow beats audio';

const DOWNLOAD_PATHS_KEY = 'download_paths_config';

export interface DownloadPathsConfig {
    audioPath: string;
    videoPath: string;
}

// Obtiene las rutas configuradas para descargas de audio y video con valores por defecto
export async function getDownloadPaths(): Promise<DownloadPathsConfig> {
    try {
        const raw = await getAppSetting(DOWNLOAD_PATHS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                audioPath:
                    typeof parsed.audioPath === 'string' && parsed.audioPath.trim().length > 0
                        ? parsed.audioPath.trim()
                        : DEFAULT_AUDIO_DOWNLOAD_PATH,
                videoPath:
                    typeof parsed.videoPath === 'string' && parsed.videoPath.trim().length > 0
                        ? parsed.videoPath.trim()
                        : DEFAULT_VIDEO_DOWNLOAD_PATH,
            };
        }
    } catch { }

    return {
        audioPath: DEFAULT_AUDIO_DOWNLOAD_PATH,
        videoPath: DEFAULT_VIDEO_DOWNLOAD_PATH,
    };
}

// Guarda rutas personalizadas de descarga en SQLite local
export async function saveDownloadPaths(config: DownloadPathsConfig): Promise<DownloadPathsConfig> {
    const normalized: DownloadPathsConfig = {
        audioPath: config.audioPath.trim() || DEFAULT_AUDIO_DOWNLOAD_PATH,
        videoPath: config.videoPath.trim() || DEFAULT_VIDEO_DOWNLOAD_PATH,
    };
    await setAppSetting(DOWNLOAD_PATHS_KEY, JSON.stringify(normalized));
    return normalized;
}

// Restaura las rutas por defecto de Snow Beats
export async function resetDownloadPaths(): Promise<DownloadPathsConfig> {
    return saveDownloadPaths({
        audioPath: DEFAULT_AUDIO_DOWNLOAD_PATH,
        videoPath: DEFAULT_VIDEO_DOWNLOAD_PATH,
    });
}
