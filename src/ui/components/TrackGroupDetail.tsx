import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    Alert,
    BackHandler,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { ArrowLeft, Play, Shuffle } from 'lucide-react-native';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';
import { usePlayer } from '../../audio-engine/PlayerContext';
import { softDeleteTracks } from '../../storage/database/db';
import { SongCard } from './SongCard';
import { SelectionActionBar } from './SelectionActionBar';
import { AddToPlaylistModal } from './AddToPlaylistModal';

interface TrackGroupDetailProps {
    title: string;
    subtitle?: string;
    tracks: Track[];
    onBack: () => void;
    onOpenPlayer?: () => void;
    onTracksChanged?: () => Promise<void> | void;
}

// Vista reutilizable de detalle de canciones para Carpetas, Artistas y Álbumes
export const TrackGroupDetail: React.FC<TrackGroupDetailProps> = ({
    title,
    subtitle,
    tracks,
    onBack,
    onOpenPlayer,
    onTracksChanged,
}) => {
    const { fgColor, mutedColor } = useTheme();
    const { playTrack, addToQueue } = usePlayer();

    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [playlistModalOpen, setPlaylistModalOpen] = useState(false);

    // Maneja el botón físico Atrás en Android para salir de selección o volver a la lista
    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (selectedIds.length > 0) {
                setSelectedIds([]);
                return true;
            }
            onBack();
            return true;
        });
        return () => sub.remove();
    }, [onBack, selectedIds.length]);

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
        );
    };

    const selectedTracks = tracks.filter((t) => selectedIds.includes(t.id));

    const handlePlayAll = () => {
        if (tracks.length === 0) return;
        playTrack(tracks[0], tracks);
        onOpenPlayer?.();
    };

    const handleShufflePlay = () => {
        if (tracks.length === 0) return;
        const shuffled = [...tracks].sort(() => Math.random() - 0.5);
        playTrack(shuffled[0], shuffled);
        onOpenPlayer?.();
    };

    const handleShareSelected = async () => {
        if (selectedTracks.length === 0) return;
        if (!(await Sharing.isAvailableAsync())) {
            Alert.alert('Compartir', 'No disponible en este dispositivo.');
            return;
        }
        // expo-sharing comparte un archivo a la vez en Android
        if (selectedTracks.length > 1) {
            Alert.alert(
                'Compartir',
                `Android permite compartir 1 archivo por vez. Se compartirá "${selectedTracks[0].title}".`,
                [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                        text: 'Compartir',
                        onPress: async () => {
                            await Sharing.shareAsync(selectedTracks[0].uri);
                            setSelectedIds([]);
                        },
                    },
                ]
            );
            return;
        }
        await Sharing.shareAsync(selectedTracks[0].uri);
        setSelectedIds([]);
    };

    const handleDeleteSelected = () => {
        if (selectedIds.length === 0) return;
        Alert.alert(
            'Mover a papelera',
            `¿Mover ${selectedIds.length} ${selectedIds.length === 1 ? 'canción' : 'canciones'} a Eliminados recientemente?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Mover a papelera',
                    style: 'destructive',
                    onPress: async () => {
                        await softDeleteTracks(selectedIds);
                        setSelectedIds([]);
                        await onTracksChanged?.();
                    },
                },
            ]
        );
    };

    return (
        <View style={styles.container}>
            {selectedIds.length > 0 ? (
                <SelectionActionBar
                    selectedCount={selectedIds.length}
                    totalCount={tracks.length}
                    onClear={() => setSelectedIds([])}
                    onToggleSelectAll={() =>
                        setSelectedIds(
                            selectedIds.length >= tracks.length ? [] : tracks.map((t) => t.id)
                        )
                    }
                    onAddToQueue={() => {
                        addToQueue(selectedTracks);
                        Alert.alert(
                            'Cola actualizada',
                            `Se agregaron ${selectedTracks.length} canciones a la cola.`
                        );
                        setSelectedIds([]);
                    }}
                    onAddToPlaylist={() => setPlaylistModalOpen(true)}
                    onShare={handleShareSelected}
                    onDelete={handleDeleteSelected}
                />
            ) : (
                <View style={styles.header}>
                    <TouchableOpacity onPress={onBack} style={styles.backBtn}>
                        <ArrowLeft size={22} color={fgColor} />
                    </TouchableOpacity>
                    <View style={styles.titleBox}>
                        <Text style={[styles.title, { color: fgColor }]} numberOfLines={1}>
                            {title}
                        </Text>
                        <Text style={[styles.subtitle, { color: mutedColor }]} numberOfLines={1}>
                            {subtitle ? `${subtitle} • ` : ''}
                            {tracks.length} {tracks.length === 1 ? 'canción' : 'canciones'}
                        </Text>
                    </View>
                    {tracks.length > 0 && (
                        <View style={styles.quickActions}>
                            <TouchableOpacity onPress={handleShufflePlay} style={styles.quickBtn}>
                                <Shuffle size={18} color={fgColor} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handlePlayAll} style={styles.playAllBtn}>
                                <Play size={16} color="#000000" fill="#000000" />
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            )}

            <FlatList
                data={tracks}
                keyExtractor={(item) => item.id}
                initialNumToRender={15}
                maxToRenderPerBatch={10}
                windowSize={5}
                renderItem={({ item }) => (
                    <SongCard
                        track={item}
                        selected={selectedIds.includes(item.id)}
                        onPress={(selected) => {
                            if (selectedIds.length > 0) {
                                toggleSelect(selected.id);
                            } else {
                                playTrack(selected, tracks);
                                onOpenPlayer?.();
                            }
                        }}
                        onLongPress={(selected) => toggleSelect(selected.id)}
                        onArtworkPress={(selected) => toggleSelect(selected.id)}
                    />
                )}
                ListEmptyComponent={
                    <Text style={[styles.emptyText, { color: mutedColor }]}>
                        No hay canciones disponibles en este grupo.
                    </Text>
                }
            />

            <AddToPlaylistModal
                visible={playlistModalOpen}
                trackIds={selectedIds}
                onClose={() => setPlaylistModalOpen(false)}
                onAdded={() => setSelectedIds([])}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(156,163,175,0.2)',
    },
    backBtn: { padding: 6 },
    titleBox: { flex: 1, marginLeft: 8 },
    title: { fontSize: 17, fontWeight: '700' },
    subtitle: { fontSize: 12, marginTop: 2 },
    quickActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginLeft: 8,
    },
    quickBtn: {
        padding: 8,
    },
    playAllBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyText: {
        textAlign: 'center',
        marginTop: 32,
        fontSize: 14,
    },
});
