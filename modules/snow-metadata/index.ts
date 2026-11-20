import { requireOptionalNativeModule } from 'expo-modules-core';

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

interface SnowMetadataNativeModule {
    readTrackTags(uri: string, trackId: string): Promise<NativeTrackTags | null>;
    readTrackLyrics?: (uri: string) => Promise<string | null>;
    renderShareCard?: (options: RenderShareCardOptions) => Promise<string | null>;
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