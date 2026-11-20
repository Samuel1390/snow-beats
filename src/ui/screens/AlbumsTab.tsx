import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { getAlbumsSummary, getTracksByAlbum } from '../../storage/database/db';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';
import { CollageArtwork } from '../components/CollageArtWork';
import { TrackGroupDetail } from '../components/TrackGroupDetail';

interface AlbumsTabProps {
    onOpenPlayer?: () => void;
    onLibraryChanged?: () => Promise<void> | void;
}

export const AlbumsTab: React.FC<AlbumsTabProps> = ({ onOpenPlayer, onLibraryChanged }) => {
    const { fgColor, mutedColor } = useTheme();
    const [albums, setAlbums] = useState<
        { name: string; trackCount: number; recentArtworks: (string | null)[] }[]
    >([]);
    const [opened, setOpened] = useState<{ name: string; tracks: Track[] } | null>(null);

    const loadAlbums = useCallback(async () => {
        setAlbums(await getAlbumsSummary());
    }, []);

    useEffect(() => {
        loadAlbums();
    }, [loadAlbums]);

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

    return (
        <FlatList
            data={albums}
            keyExtractor={(item) => item.name}
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
        />
    );
};

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    name: { fontSize: 15, fontWeight: '600' },
});