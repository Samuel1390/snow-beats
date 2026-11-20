import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
} from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { getAlbumsSummary, getTracksByAlbum } from '../../storage/database/db';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';
import { CollageArtwork } from '../components/CollageArtWork';
import { TrackGroupDetail } from '../components/TrackGroupDetail';

interface AlbumsTabProps {
    onOpenPlayer?: () => void;
    onLibraryChanged?: () => Promise<void> | void;
    refreshKey?: number;
}

export const AlbumsTab: React.FC<AlbumsTabProps> = ({
    onOpenPlayer,
    onLibraryChanged,
    refreshKey = 0,
}) => {
    const { fgColor, mutedColor } = useTheme();
    const [albums, setAlbums] = useState<
        { name: string; trackCount: number; recentArtworks: (string | null)[] }[]
    >([]);
    const [loading, setLoading] = useState(true);
    const [opened, setOpened] = useState<{ name: string; tracks: Track[] } | null>(null);

    const loadAlbums = useCallback(async () => {
        try {
            const list = await getAlbumsSummary();
            setAlbums(list);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAlbums();
    }, [loadAlbums, refreshKey]);

    const openAlbum = async (name: string) => {
        const tracks = await getTracksByAlbum(name);
        setOpened({ name, tracks });
    };

    // Vista interna con las canciones del álbum seleccionado
    if (opened) {
        return (
            <TrackGroupDetail
                title={opened.name}
                tracks={opened.tracks}
                onBack={() => setOpened(null)}
                onOpenPlayer={onOpenPlayer}
                onTracksChanged={async () => {
                    const refreshed = await getTracksByAlbum(opened.name);
                    setOpened((prev) => (prev ? { ...prev, tracks: refreshed } : null));
                    await loadAlbums();
                    await onLibraryChanged?.();
                }}
            />
        );
    }

    if (loading && albums.length === 0) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="small" color={fgColor} />
                <Text style={[styles.fallbackText, { color: mutedColor }]}>Cargando álbumes...</Text>
            </View>
        );
    }

    return (
        <FlatList
            data={albums}
            keyExtractor={(item) => item.name}
            initialNumToRender={15}
            maxToRenderPerBatch={12}
            windowSize={5}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
                <TouchableOpacity
                    style={styles.row}
                    activeOpacity={0.7}
                    onPress={() => openAlbum(item.name)}
                >
                    <CollageArtwork artworks={item.recentArtworks} totalTracks={item.trackCount} />
                    <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text style={[styles.name, { color: fgColor }]} numberOfLines={1}>
                            {item.name}
                        </Text>
                        <Text style={{ color: mutedColor, fontSize: 12 }}>
                            {item.trackCount} {item.trackCount === 1 ? 'canción' : 'canciones'}
                        </Text>
                    </View>
                    <ChevronRight size={18} color={mutedColor} />
                </TouchableOpacity>
            )}
            ListEmptyComponent={
                <Text style={[styles.fallbackText, { color: mutedColor, marginTop: 32 }]}>
                    No hay álbumes disponibles.
                </Text>
            }
        />
    );
};

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    name: { fontSize: 15, fontWeight: '600' },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    fallbackText: { fontSize: 13, marginTop: 10, textAlign: 'center' },
});