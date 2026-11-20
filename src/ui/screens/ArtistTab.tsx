import React, { useCallback, useMemo, useState } from 'react';
import {
    FlatList,
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
} from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { CollageArtwork } from '../components/CollageArtWork';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';
import { TrackGroupDetail } from '../components/TrackGroupDetail';

interface ArtistGroup {
    name: string;
    trackCount: number;
    recentArtworks: (string | null)[];
    tracks: Track[];
}

interface ArtistsTabProps {
    tracks: Track[];
    onOpenPlayer?: () => void;
    onLibraryChanged?: () => Promise<void> | void;
}

const ROW_HEIGHT = 76;

const ArtistRow: React.FC<{
    item: ArtistGroup;
    fgColor: string;
    mutedColor: string;
    onSelect: (name: string) => void;
}> = React.memo(({ item, fgColor, mutedColor, onSelect }) => (
    <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => onSelect(item.name)}
    >
        <CollageArtwork artworks={item.recentArtworks} totalTracks={item.trackCount} />
        <View style={styles.info}>
            <Text style={[styles.name, { color: fgColor }]} numberOfLines={1}>
                {item.name}
            </Text>
            <Text style={{ color: mutedColor, fontSize: 12 }}>
                {item.trackCount} {item.trackCount === 1 ? 'canción' : 'canciones'}
            </Text>
        </View>
        <ChevronRight size={18} color={mutedColor} />
    </TouchableOpacity>
));

export const ArtistsTab: React.FC<ArtistsTabProps> = React.memo(
    ({ tracks, onOpenPlayer, onLibraryChanged }) => {
        const { fgColor, mutedColor } = useTheme();
        const [openedArtistName, setOpenedArtistName] = useState<string | null>(null);

        // Agrupación O(N) en una sola pasada en memoria (~1-2ms para 1300+ pistas, sin bloquear SQLite)
        const artists = useMemo<ArtistGroup[]>(() => {
            const map = new Map<string, ArtistGroup>();
            for (let i = 0; i < tracks.length; i++) {
                const t = tracks[i];
                let entry = map.get(t.artist);
                if (!entry) {
                    entry = { name: t.artist, trackCount: 0, recentArtworks: [], tracks: [] };
                    map.set(t.artist, entry);
                }
                entry.trackCount += 1;
                entry.tracks.push(t);
                if (t.artworkUri && entry.recentArtworks.length < 4) {
                    entry.recentArtworks.push(t.artworkUri);
                }
            }
            return Array.from(map.values()).sort(
                (a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name)
            );
        }, [tracks]);

        const openedGroup = useMemo(() => {
            if (!openedArtistName) return null;
            const found = artists.find((a) => a.name === openedArtistName);
            if (!found) return null;
            return {
                name: found.name,
                tracks: [...found.tracks].sort(
                    (a, b) => a.album.localeCompare(b.album) || a.title.localeCompare(b.title)
                ),
            };
        }, [artists, openedArtistName]);

        const handleSelectArtist = useCallback((name: string) => {
            setOpenedArtistName(name);
        }, []);

        const handleBack = useCallback(() => {
            setOpenedArtistName(null);
        }, []);

        const renderItem = useCallback(
            ({ item }: { item: ArtistGroup }) => (
                <ArtistRow
                    item={item}
                    fgColor={fgColor}
                    mutedColor={mutedColor}
                    onSelect={handleSelectArtist}
                />
            ),
            [fgColor, mutedColor, handleSelectArtist]
        );

        const getItemLayout = useCallback(
            (_: ArrayLike<ArtistGroup> | null | undefined, index: number) => ({
                length: ROW_HEIGHT,
                offset: ROW_HEIGHT * index,
                index,
            }),
            []
        );

        // Vista interna con las canciones del artista seleccionado
        if (openedGroup) {
            return (
                <TrackGroupDetail
                    title={openedGroup.name}
                    tracks={openedGroup.tracks}
                    onBack={handleBack}
                    onOpenPlayer={onOpenPlayer}
                    onTracksChanged={onLibraryChanged}
                />
            );
        }

        return (
            <FlatList
                data={artists}
                keyExtractor={(item) => item.name}
                getItemLayout={getItemLayout}
                initialNumToRender={14}
                maxToRenderPerBatch={10}
                windowSize={5}
                contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
                renderItem={renderItem}
                ListEmptyComponent={
                    <Text style={[styles.fallbackText, { color: mutedColor }]}>
                        No hay artistas disponibles.
                    </Text>
                }
            />
        );
    }
);

const styles = StyleSheet.create({
    row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center' },
    info: { marginLeft: 12, flex: 1 },
    name: { fontSize: 15, fontWeight: '600' },
    fallbackText: { fontSize: 13, marginTop: 32, textAlign: 'center' },
});