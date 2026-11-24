import { EventSubscription, requireOptionalNativeModule } from 'expo-modules-core';

export interface NativeTrackTags {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    artworkUri?: string | null;
    dominantColor?: string | null;
}

export interface RenderShareCardOptions {
    mode: 'song' | 'lyrics';
    title: string;
    artist: string;
    artworkUri?: string | null;
    logoUri?: string | null;
    bgImageUri?: string | null;
    bgColor: string;
    bgColorBottom: string;
    textColor: string;
    mutedColor: string;
    fontStyle: 'classic' | 'wide' | 'narrow' | 'italic';
    textAlign: 'left' | 'center' | 'right';
    uppercase: boolean;
    lines: string[];
}

export interface MediaNotificationPayload {
    title: string;
    artist: string;
    album?: string;
    artworkUri?: string | null;
    isPlaying: boolean;
    isFavorite: boolean;
    positionMs: number;
    durationMs: number;
    speed?: number;
}

export interface MediaActionEvent {
    action: 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'favorite' | 'close' | 'seek';
    positionSec?: number;
}

export interface DownloadFormatOption {
    id: string;
    formatId: string;
    mediaType: 'audio' | 'video';
    label: string;
    ext: string;
    qualityRank: number;
    audioQuality?: string;
    height?: number;
    filesize: number;
}

export interface PlaylistDownloadEntry {
    id: string;
    index: number;
    title: string;
    artist: string;
    duration: number;
    thumbnail?: string | null;
    url: string;
}

export interface ExtractedMediaInfo {
    ok: boolean;
    errorCode?: string;
    errorMessage?: string;
    isPlaylist?: boolean;
    isAudioOnly?: boolean;
    extractionSource?: 'yt-dlp' | 'embed' | 'webview';
    title?: string;
    uploader?: string;
    domain?: string;
    platform?: string;
    thumbnail?: string | null;
    duration?: number;
    url?: string;
    directStreamUrl?: string | null;
    previewStreamUrl?: string | null;
    previewHeaders?: Record<string, string>;
    entries?: PlaylistDownloadEntry[];
    audioFormats?: DownloadFormatOption[];
    videoFormats?: DownloadFormatOption[];
}

export interface DownloadMediaOptions {
    taskId: string;
    url: string;
    formatId: string;
    mediaType: 'audio' | 'video';
    audioQuality?: string;
    targetPath: string;
    headers?: Record<string, string>;
    directStreamUrl?: string | null;
}

export interface DownloadMediaResult {
    ok: boolean;
    filePath?: string;
    fileName?: string;
    errorCode?: string;
    errorMessage?: string;
}

export interface DownloadProgressEvent {
    taskId: string;
    progress: number;
    etaSeconds: number;
    line?: string;
}

export interface PersistedCoverResult {
    artworkUri: string;
    dominantColor: string | null;
}

export interface PickedLyricsFileResult {
    ok: boolean;
    cancelled?: boolean;
    fileName?: string;
    content?: string;
    errorMessage?: string;
}

export interface ClipboardImageResult {
    ok: boolean;
    uri?: string;
    source?: 'clipboard_image' | 'clipboard_url';
    errorMessage?: string;
}

interface SnowMetadataNativeModule {
    readTrackTags(uri: string, trackId: string): Promise<NativeTrackTags | null>;
    readTrackLyrics?: (uri: string) => Promise<string | null>;
    renderShareCard?: (options: RenderShareCardOptions) => Promise<string | null>;
    requestNotificationPermission?: () => Promise<boolean>;
    updateMediaNotification?: (payload: MediaNotificationPayload) => Promise<boolean>;
    dismissMediaNotification?: () => Promise<boolean>;
    sendEmailWithAttachments?: (
        to: string,
        subject: string,
        plainBody: string,
        htmlBody: string,
        imageUris: string[]
    ) => Promise<boolean>;
    setScreenOrientation?: (mode: 'portrait' | 'landscape' | 'unspecified') => Promise<boolean>;
    hasStorageWritePermission?: () => Promise<boolean>;
    requestStorageWritePermission?: () => Promise<boolean>;
    extractMediaInfo?: (url: string) => Promise<ExtractedMediaInfo>;
    downloadMedia?: (options: DownloadMediaOptions) => Promise<DownloadMediaResult>;
    cancelDownload?: (taskId: string) => Promise<boolean>;
    persistCoverImage?: (sourceUri: string, trackId: string) => Promise<PersistedCoverResult | null>;
    pickLyricsFile?: () => Promise<PickedLyricsFileResult>;
    readClipboardImage?: () => Promise<ClipboardImageResult>;
    copyImageToClipboard?: (sourceUri: string) => Promise<boolean>;
    readClipboardText?: () => Promise<string>;
    copyTextToClipboard?: (text: string) => Promise<boolean>;
    addListener?: (eventName: string, listener: (event: any) => void) => EventSubscription;
}

const SnowMetadata = requireOptionalNativeModule<SnowMetadataNativeModule>('SnowMetadata');

// Llama al módulo Kotlin para leer ID3 y carátula de una pista
export async function readTrackTags(
    uri: string,
    trackId: string
): Promise<NativeTrackTags | null> {
    if (!SnowMetadata || typeof SnowMetadata.readTrackTags !== 'function') {
        return null;
    }
    return SnowMetadata.readTrackTags(uri, trackId);
}

// Lee letras incrustadas (ID3/MP4/FLAC/OGG) o archivo .lrc hermano desde Kotlin
export async function readTrackLyrics(uri: string): Promise<string | null> {
    if (!SnowMetadata || typeof SnowMetadata.readTrackLyrics !== 'function') {
        return null;
    }
    return SnowMetadata.readTrackLyrics(uri);
}

// Renderiza la tarjeta PNG de canción o letra en alta resolución en Android
export async function renderShareCard(
    options: RenderShareCardOptions
): Promise<string | null> {
    if (!SnowMetadata || typeof SnowMetadata.renderShareCard !== 'function') {
        return null;
    }
    return SnowMetadata.renderShareCard(options);
}

// Solicita permiso POST_NOTIFICATIONS en Android 13+
export async function requestNotificationPermission(): Promise<boolean> {
    if (!SnowMetadata || typeof SnowMetadata.requestNotificationPermission !== 'function') {
        return false;
    }
    return SnowMetadata.requestNotificationPermission();
}

// Actualiza la notificación flotante clásica en la barra de notificaciones
export async function updateMediaNotification(
    payload: MediaNotificationPayload
): Promise<boolean> {
    if (!SnowMetadata || typeof SnowMetadata.updateMediaNotification !== 'function') {
        return false;
    }
    return SnowMetadata.updateMediaNotification(payload);
}

// Cierra la notificación flotante multimedia
export async function dismissMediaNotification(): Promise<boolean> {
    if (!SnowMetadata || typeof SnowMetadata.dismissMediaNotification !== 'function') {
        return false;
    }
    return SnowMetadata.dismissMediaNotification();
}

// Escucha botones y barra de progreso desde el control multimedia flotante
export function addMediaActionListener(
    listener: (event: MediaActionEvent) => void
): EventSubscription | null {
    if (!SnowMetadata || typeof SnowMetadata.addListener !== 'function') {
        return null;
    }
    return SnowMetadata.addListener('onMediaAction', listener);
}

// Envía correo nativo (solo apps de email) con cuerpo HTML y hasta 5 imágenes adjuntas vía FileProvider
export async function sendEmailWithAttachments(
    to: string,
    subject: string,
    plainBody: string,
    htmlBody: string,
    imageUris: string[]
): Promise<boolean> {
    if (!SnowMetadata || typeof SnowMetadata.sendEmailWithAttachments !== 'function') {
        return false;
    }
    return SnowMetadata.sendEmailWithAttachments(to, subject, plainBody, htmlBody, imageUris);
}

// Rota la orientación de pantalla en Android y oculta/restaura barras del sistema en modo horizontal
export async function setScreenOrientation(
    mode: 'portrait' | 'landscape' | 'unspecified'
): Promise<boolean> {
    if (!SnowMetadata || typeof SnowMetadata.setScreenOrientation !== 'function') {
        return false;
    }
    return SnowMetadata.setScreenOrientation(mode);
}

// Verifica si Android tiene concedido el permiso de escritura de almacenamiento
export async function hasStorageWritePermission(): Promise<boolean> {
    if (!SnowMetadata || typeof SnowMetadata.hasStorageWritePermission !== 'function') {
        return false;
    }
    return SnowMetadata.hasStorageWritePermission();
}

// Abre o solicita el permiso de almacenamiento en Android
export async function requestStorageWritePermission(): Promise<boolean> {
    if (!SnowMetadata || typeof SnowMetadata.requestStorageWritePermission !== 'function') {
        return false;
    }
    return SnowMetadata.requestStorageWritePermission();
}

// Extrae información, streaming y lista de formatos (o playlist) usando yt-dlp nativo
export async function extractMediaInfo(url: string): Promise<ExtractedMediaInfo> {
    if (!SnowMetadata || typeof SnowMetadata.extractMediaInfo !== 'function') {
        return {
            ok: false,
            errorCode: 'NATIVE_REQUIRED',
            errorMessage:
                'El motor yt-dlp requiere la compilación nativa de Android (npx expo run:android).',
        };
    }
    return SnowMetadata.extractMediaInfo(url);
}

// Inicia una descarga gestionada por yt-dlp nativo
export async function downloadMedia(
    options: DownloadMediaOptions
): Promise<DownloadMediaResult> {
    if (!SnowMetadata || typeof SnowMetadata.downloadMedia !== 'function') {
        return {
            ok: false,
            errorCode: 'NATIVE_REQUIRED',
            errorMessage:
                'El motor yt-dlp requiere la compilación nativa de Android (npx expo run:android).',
        };
    }
    return SnowMetadata.downloadMedia(options);
}

// Cancela una descarga en curso de yt-dlp por su taskId
export async function cancelDownload(taskId: string): Promise<boolean> {
    if (!SnowMetadata || typeof SnowMetadata.cancelDownload !== 'function') {
        return false;
    }
    return SnowMetadata.cancelDownload(taskId);
}

// Escucha el progreso en tiempo real de las descargas yt-dlp
export function addDownloadProgressListener(
    listener: (event: DownloadProgressEvent) => void
): EventSubscription | null {
    if (!SnowMetadata || typeof SnowMetadata.addListener !== 'function') {
        return null;
    }
    return SnowMetadata.addListener('onDownloadProgress', listener);
}

// Copia la carátula 1:1 recortada al almacenamiento persistente de la app y calcula color dominante
export async function persistCoverImage(
    sourceUri: string,
    trackId: string
): Promise<PersistedCoverResult | null> {
    if (!SnowMetadata || typeof SnowMetadata.persistCoverImage !== 'function') {
        return { artworkUri: sourceUri, dominantColor: null };
    }
    return SnowMetadata.persistCoverImage(sourceUri, trackId);
}

// Abre el selector nativo de documentos Android para importar letras (.lrc / .txt)
export async function pickLyricsFile(): Promise<PickedLyricsFileResult> {
    if (!SnowMetadata || typeof SnowMetadata.pickLyricsFile !== 'function') {
        return {
            ok: false,
            errorMessage: 'La importación nativa de archivos .lrc/.txt requiere compilar la app Android.',
        };
    }
    return SnowMetadata.pickLyricsFile();
}

// Lee una imagen o URL de imagen copiada en el portapapeles de Android
export async function readClipboardImage(): Promise<ClipboardImageResult> {
    if (!SnowMetadata || typeof SnowMetadata.readClipboardImage !== 'function') {
        return {
            ok: false,
            errorMessage: 'Lectura de imagen desde el portapapeles no disponible.',
        };
    }
    return SnowMetadata.readClipboardImage();
}

// Copia la carátula actual al portapapeles de Android
export async function copyImageToClipboard(sourceUri: string): Promise<boolean> {
    if (!SnowMetadata || typeof SnowMetadata.copyImageToClipboard !== 'function') {
        return false;
    }
    return SnowMetadata.copyImageToClipboard(sourceUri);
}

// Lee texto del portapapeles de Android
export async function readClipboardText(): Promise<string> {
    if (!SnowMetadata || typeof SnowMetadata.readClipboardText !== 'function') {
        return '';
    }
    return SnowMetadata.readClipboardText();
}

// Copia texto al portapapeles de Android
export async function copyTextToClipboard(text: string): Promise<boolean> {
    if (!SnowMetadata || typeof SnowMetadata.copyTextToClipboard !== 'function') {
        return false;
    }
    return SnowMetadata.copyTextToClipboard(text);
}