import * as MediaLibrary from 'expo-media-library';
import { Linking } from 'react-native';

export interface PermissionResult {
    granted: boolean;
    canAskAgain: boolean;
}

// Solicita el permiso granular de audio usando expo-media-library
export async function requestAudioPermission(openSettingsIfBlocked = false): Promise<PermissionResult> {
    const current = await MediaLibrary.getPermissionsAsync(false, ['audio']);

    if (current.granted) {
        return { granted: true, canAskAgain: true };
    }

    // Si Android ya no permite mostrar el diálogo, abre Ajustes si el usuario pulsó el botón
    if (!current.canAskAgain) {
        if (openSettingsIfBlocked) {
            await Linking.openSettings();
        }
        return { granted: false, canAskAgain: false };
    }

    const response = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
    return {
        granted: response.granted,
        canAskAgain: response.canAskAgain,
    };
}