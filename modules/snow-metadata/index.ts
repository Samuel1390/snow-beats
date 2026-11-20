import { requireOptionalNativeModule } from 'expo-modules-core';

export interface NativeTrackTags {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    artworkUri?: string | null;
    dominantColor?: string | null;
}

interface SnowMetadataNativeModule {
    readTrackTags(uri: string, trackId: string): Promise<NativeTrackTags | null>;
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