import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronRight, Folder } from 'lucide-react-native';
import { FolderItem, getFolders, getTracksByFolder } from '../../storage/database/db';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';
import { TrackGroupDetail } from '../components/TrackGroupDetail';

interface FoldersTabProps {
    onOpenPlayer?: () => void;
    onLibraryChanged?: () => Promise<void> | void;
}

export const FoldersTab: React.FC<FoldersTabProps> = ({ onOpenPlayer, onLibraryChanged }) => {
    const { fgColor, mutedColor } = useTheme();
    const [showHidden, setShowHidden] = useState(false);
    const [folders, setFolders] = useState<FolderItem[]>([]);
    const [opened, setOpened] = useState<{ folder: FolderItem; tracks: Track[] } | null>(null);

    const loadFolders = useCallback(async () => {
        const list = await getFolders(showHidden);
        setFolders(list);
    }, [showHidden]);

    useEffect(() => {
        loadFolders();
    }, [loadFolders]);

    const openFolder = async (folder: FolderItem) => {
        const tracks = await getTracksByFolder(folder.path, showHidden);
        setOpened({ folder, tracks });
    };

    // Vista interna con las canciones de la carpeta seleccionada
    if (opened) {
        return (
            <TrackGroupDetail
                title={opened.folder.name}
                subtitle={opened.folder.path}
                tracks={opened.tracks}
                onBack={() => setOpened(null)}
                onOpenPlayer={onOpenPlayer}
                onTracksChanged={async () => {
                    const refreshed = await getTracksByFolder(opened.folder.path, showHidden);
                    setOpened((prev) => (prev ? { ...prev, tracks: refreshed } : null));
                    await loadFolders();
                    await onLibraryChanged?.();
                }}
            />
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.hiddenBar}>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.hiddenTitle, { color: fgColor }]}>¿Canciones no encontradas?</Text>
                    <Text style={{ color: mutedColor, fontSize: 12 }}>Mostrar archivos ocultos</Text>
                </View>
                <Switch value={showHidden} onValueChange={setShowHidden} />
            </View>

            <FlatList
                data={folders}
                keyExtractor={(item) => item.path}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={styles.row}
                        activeOpacity={0.7}
                        onPress={() => openFolder(item)}
                    >
                        <Folder size={22} color={fgColor} />
                        <View style={{ marginLeft: 12, flex: 1 }}>
                            <Text style={[styles.folderName, { color: fgColor }]} numberOfLines={1}>
                                {item.name}
                            </Text>
                            <Text style={{ color: mutedColor, fontSize: 12 }}>
                                {item.trackCount} {item.trackCount === 1 ? 'canción' : 'canciones'}
                            </Text>
                        </View>
                        <ChevronRight size={18} color={mutedColor} />
                    </TouchableOpacity>
                )}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, padding: 16 },
    hiddenBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: 14,
        marginBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(156,163,175,0.2)',
    },
    hiddenTitle: { fontSize: 14, fontWeight: '600' },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    folderName: { fontSize: 15, fontWeight: '600' },
});