import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    FlatList,
    Switch,
    TouchableOpacity,
    StyleSheet,
    RefreshControl,
} from 'react-native';
import { ChevronRight, Folder } from 'lucide-react-native';
import { FolderItem, getFolders, getTracksByFolder } from '../../storage/database/db';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';
import { TrackGroupDetail } from '../components/TrackGroupDetail';

interface FoldersTabProps {
    tracks: Track[];
    onOpenPlayer?: () => void;
    onLibraryChanged?: () => Promise<void> | void;
    refreshKey?: number;
    refreshing?: boolean;
    onRefresh?: () => void;
}

export const FoldersTab: React.FC<FoldersTabProps> = React.memo(
    ({ tracks, onOpenPlayer, onLibraryChanged, refreshKey = 0, refreshing = false, onRefresh }) => {
        const { fgColor, mutedColor } = useTheme();
        const [showHidden, setShowHidden] = useState(false);
        const [hiddenFolders, setHiddenFolders] = useState<FolderItem[]>([]);
        const [opened, setOpened] = useState<{ folder: FolderItem; tracks: Track[] } | null>(null);

        // Agrupa carpetas en O(N) desde memoria cuando no se incluyen archivos ocultos
        const visibleFolders = useMemo<FolderItem[]>(() => {
            const counts = new Map<string, number>();
            for (let i = 0; i < tracks.length; i++) {
                const path = tracks[i].folderPath;
                counts.set(path, (counts.get(path) ?? 0) + 1);
            }
            return Array.from(counts.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([path, trackCount]) => {
                    const parts = path.split('/');
                    return { path, name: parts[parts.length - 1] || path, trackCount };
                });
        }, [tracks]);

        // Solo consulta SQLite cuando el usuario activa explícitamente "Mostrar archivos ocultos"
        const loadHiddenFolders = useCallback(async () => {
            if (!showHidden) return;
            setHiddenFolders(await getFolders(true));
        }, [showHidden]);

        useEffect(() => {
            loadHiddenFolders();
        }, [loadHiddenFolders, refreshKey]);

        const folders = showHidden ? hiddenFolders : visibleFolders;

        const openFolder = useCallback(
            async (folder: FolderItem) => {
                if (!showHidden) {
                    const list = tracks
                        .filter((t) => t.folderPath === folder.path)
                        .sort((a, b) => a.title.localeCompare(b.title));
                    setOpened({ folder, tracks: list });
                    return;
                }
                const list = await getTracksByFolder(folder.path, true);
                setOpened({ folder, tracks: list });
            },
            [showHidden, tracks]
        );

        // Mantiene actualizada la vista abierta si llegan nuevas canciones tras un pull-to-refresh
        useEffect(() => {
            if (!opened || showHidden) return;
            const list = tracks
                .filter((t) => t.folderPath === opened.folder.path)
                .sort((a, b) => a.title.localeCompare(b.title));
            setOpened((prev) => (prev ? { ...prev, tracks: list } : null));
        }, [tracks, showHidden, opened?.folder.path]);

        const handleBack = useCallback(() => setOpened(null), []);

        // Vista interna con las canciones de la carpeta seleccionada
        if (opened) {
            return (
                <TrackGroupDetail
                    title={opened.folder.name}
                    subtitle={opened.folder.path}
                    tracks={opened.tracks}
                    onBack={handleBack}
                    onOpenPlayer={onOpenPlayer}
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                    onTracksChanged={async () => {
                        if (showHidden) {
                            const refreshed = await getTracksByFolder(opened.folder.path, true);
                            setOpened((prev) => (prev ? { ...prev, tracks: refreshed } : null));
                            await loadHiddenFolders();
                        }
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
                    initialNumToRender={15}
                    maxToRenderPerBatch={10}
                    windowSize={5}
                    contentContainerStyle={{ flexGrow: 1 }}
                    refreshControl={
                        onRefresh ? (
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={onRefresh}
                                colors={['#38BDF8', '#1E3A8A']}
                                tintColor="#38BDF8"
                                progressBackgroundColor="#111827"
                            />
                        ) : undefined
                    }
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
    }
);

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