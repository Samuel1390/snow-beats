import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { CollageArtwork } from '../components/CollageArtWork';
import { getArtistsSummary, getTracksByArtist } from '../../storage/database/db';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';
import { TrackGroupDetail } from '../components/TrackGroupDetail';

interface ArtistsTabProps {
    onOpenPlayer?: () => void;
    onLibraryChanged?: () => Promise<void> | void;
}

export const ArtistsTab: React.FC<ArtistsTabProps> = ({ onOpenPlayer, onLibraryChanged }) => {
    const { fgColor, mutedColor } = useTheme();
    const [artists, setArtists] = useState<
        { name: string; trackCount: number; recentArtworks: (string | null)[] }[]
    >([]);
    const [opened, setOpened] = useState<{ name: string; tracks: Track[] } | null>(null);

    const loadArtists = useCallback(async () => {
        setArtists(await getArtistsSummary());
    }, []);

    useEffect(() => {
        loadArtists();
    }, [loadArtists]);

    const openArtist = async (name: string) => {
        const tracks = await getTracksByArtist(name);
        setOpened({ name, tracks });
    };

    // Vista interna con las canciones del artista seleccionado
    if (opened) {
        return (
            <TrackGroupDetail
                title={opened.name}
                tracks={opened.tracks}
                onBack={() => setOpened(null)}
                onOpenPlayer={onOpenPlayer}
                onTracksChanged={async () => {
                    const refreshed = await getTracksByArtist(opened.name);
                    setOpened((prev) => (prev ? { ...prev, tracks: refreshed } : null));
                    await loadArtists();
                    await onLibraryChanged?.();
                }}
            />
        );
    }

    return (
        <FlatList
            data={artists}
            keyExtractor={(item) => item.name}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
                <TouchableOpacity
                    style={styles.row}
                    activeOpacity={0.7}
                    onPress={() => openArtist(item.name)}
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