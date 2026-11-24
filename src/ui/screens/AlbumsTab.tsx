import React, { useCallback, useMemo, useState } from 'react';
import {
    FlatList,
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    RefreshControl,
} from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';
import { CollageArtwork } from '../components/CollageArtWork';
import { TrackGroupDetail } from '../components/TrackGroupDetail';

interface AlbumGroup {
    name: string;
    trackCount: number;
    recentArtworks: (string | null)[];
    tracks: Track[];
}

interface AlbumsTabProps {
    tracks: Track[];
    onOpenPlayer?: () => void;
    onLibraryChanged?: () => Promise<void> | void;
    refreshing?: boolean;
    onRefresh?: () => void;
}

const ROW_HEIGHT = 76;

const AlbumRow: React.FC<{
    item: AlbumGroup;
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

export const AlbumsTab: React.FC<AlbumsTabProps> = React.memo(
    ({ tracks, onOpenPlayer, onLibraryChanged, refreshing = false, onRefresh }) => {
        const { fgColor, mutedColor } = useTheme();
        const [openedAlbumName, setOpenedAlbumName] = useState<string | null>(null);

        // Agrupación O(N) en una sola pasada en memoria (~1-2ms para 1300+ pistas, sin bloquear SQLite)
        const albums = useMemo<AlbumGroup[]>(() => {
            const map = new Map<string, AlbumGroup>();
            for (let i = 0; i < tracks.length; i++) {
                const t = tracks[i];
                let entry = map.get(t.album);
                if (!entry) {
                    entry = { name: t.album, trackCount: 0, recentArtworks: [], tracks: [] };
                    map.set(t.album, entry);
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
            if (!openedAlbumName) return null;
            const found = albums.find((a) => a.name === openedAlbumName);
            if (!found) return null;
            return {
                name: found.name,
                tracks: [...found.tracks].sort((a, b) => a.title.localeCompare(b.title)),
            };
        }, [albums, openedAlbumName]);

        const handleSelectAlbum = useCallback((name: string) => {
            setOpenedAlbumName(name);
        }, []);

        const handleBack = useCallback(() => {
            setOpenedAlbumName(null);
        }, []);

        const renderItem = useCallback(
            ({ item }: { item: AlbumGroup }) => (
                <AlbumRow
                    item={item}
                    fgColor={fgColor}
                    mutedColor={mutedColor}
                    onSelect={handleSelectAlbum}
                />
            ),
            [fgColor, mutedColor, handleSelectAlbum]
        );

        const getItemLayout = useCallback(
            (_: ArrayLike<AlbumGroup> | null | undefined, index: number) => ({
                length: ROW_HEIGHT,
                offset: ROW_HEIGHT * index,
                index,
            }),
            []
        );

        // Vista interna con las canciones del álbum seleccionado
        if (openedGroup) {
            return (
                <TrackGroupDetail
                    title={openedGroup.name}
                    tracks={openedGroup.tracks}
                    onBack={handleBack}
                    onOpenPlayer={onOpenPlayer}
                    onTracksChanged={onLibraryChanged}
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                />
            );
        }

        return (
            <FlatList
                data={albums}
                keyExtractor={(item) => item.name}
                getItemLayout={getItemLayout}
                initialNumToRender={14}
                maxToRenderPerBatch={10}
                windowSize={5}
                contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, flexGrow: 1 }}
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
                renderItem={renderItem}
                ListEmptyComponent={
                    <Text style={[styles.fallbackText, { color: mutedColor }]}>
                        No hay álbumes disponibles.
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