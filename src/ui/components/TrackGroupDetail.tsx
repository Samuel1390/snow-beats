import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    View,
    Text,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    Alert,
    BackHandler,
    RefreshControl,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { ArrowLeft, Play, Shuffle } from 'lucide-react-native';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';
import { useI18n } from '../../i18n';
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
    refreshing?: boolean;
    onRefresh?: () => void;
}

// Vista reutilizable de detalle de canciones para Carpetas, Artistas y Álbumes
export const TrackGroupDetail: React.FC<TrackGroupDetailProps> = ({
    title,
    subtitle,
    tracks,
    onBack,
    onOpenPlayer,
    onTracksChanged,
    refreshing = false,
    onRefresh,
}) => {
    const { fgColor, mutedColor } = useTheme();
    const { t } = useI18n();
    const { currentTrack, isPlaying, playTrack, addToQueue } = usePlayer();

    const [localTracks, setLocalTracks] = useState<Track[]>(tracks);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
    const enterAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        setLocalTracks(tracks);
    }, [tracks]);

    // Entrada suave lateral al abrir una carpeta, artista o álbum
    useEffect(() => {
        Animated.spring(enterAnim, {
            toValue: 1,
            damping: 22,
            stiffness: 230,
            useNativeDriver: true,
        }).start();
    }, [enterAnim]);

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

    const selectedTracks = localTracks.filter((track) => selectedIds.includes(track.id));

    const handlePlayAll = () => {
        if (localTracks.length === 0) return;
        playTrack(localTracks[0], localTracks);
        onOpenPlayer?.();
    };

    const handleShufflePlay = () => {
        if (localTracks.length === 0) return;
        const shuffled = [...localTracks].sort(() => Math.random() - 0.5);
        playTrack(shuffled[0], shuffled);
        onOpenPlayer?.();
    };

    const handleShareSelected = async () => {
        if (selectedTracks.length === 0) return;
        if (!(await Sharing.isAvailableAsync())) {
            Alert.alert(t('common.share'), t('songs.shareUnavailable'));
            return;
        }
        // expo-sharing comparte un archivo a la vez en Android
        if (selectedTracks.length > 1) {
            Alert.alert(
                t('common.share'),
                t('songs.shareSingleAndroid', { title: selectedTracks[0].title }),
                [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                        text: t('common.share'),
                        onPress: async () => {
                            const uri = selectedTracks[0].uri;
                            setSelectedIds([]);
                            await Sharing.shareAsync(uri);
                        },
                    },
                ]
            );
            return;
        }
        const uri = selectedTracks[0].uri;
        setSelectedIds([]);
        await Sharing.shareAsync(uri);
    };

    const handleDeleteSelected = () => {
        if (selectedIds.length === 0) return;
        const idsToDelete = [...selectedIds];
        const unit =
            idsToDelete.length === 1 ? t('common.songSingular') : t('common.songPlural');
        Alert.alert(
            t('songs.moveToTrashTitle'),
            t('songs.moveToTrashConfirm', { count: idsToDelete.length, unit }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('songs.moveToTrashTitle'),
                    style: 'destructive',
                    onPress: () => {
                        // Desactiva el selector y retira las pistas de la UI al instante (optimista)
                        const idSet = new Set(idsToDelete);
                        setSelectedIds([]);
                        setLocalTracks((prev) => prev.filter((track) => !idSet.has(track.id)));
                        softDeleteTracks(idsToDelete)
                            .then(() => onTracksChanged?.())
                            .catch(() => { });
                    },
                },
            ]
        );
    };

    const translateX = enterAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [32, 0],
    });

    return (
        <Animated.View
            style={[
                styles.container,
                { opacity: enterAnim, transform: [{ translateX }] },
            ]}
        >
            <SelectionActionBar
                selectedCount={selectedIds.length}
                totalCount={localTracks.length}
                onClear={() => setSelectedIds([])}
                onToggleSelectAll={() =>
                    setSelectedIds(
                        selectedIds.length >= localTracks.length
                            ? []
                            : localTracks.map((track) => track.id)
                    )
                }
                onAddToQueue={() => {
                    addToQueue(selectedTracks);
                    setSelectedIds([]);
                    Alert.alert(
                        t('songs.queueUpdatedTitle'),
                        t('songs.queueUpdatedBody', { count: selectedTracks.length })
                    );
                }}
                onAddToPlaylist={() => setPlaylistModalOpen(true)}
                onShare={handleShareSelected}
                onDelete={handleDeleteSelected}
            />

            {selectedIds.length === 0 && (
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
                            {localTracks.length}{' '}
                            {localTracks.length === 1
                                ? t('common.songSingular')
                                : t('common.songPlural')}
                        </Text>
                    </View>
                    {localTracks.length > 0 && (
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
                data={localTracks}
                keyExtractor={(item) => item.id}
                extraData={{ selectedIds, currentTrackId: currentTrack?.id ?? null, isPlaying }}
                initialNumToRender={15}
                maxToRenderPerBatch={10}
                windowSize={5}
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
                renderItem={({ item }) => {
                    const isCurrent = currentTrack?.id === item.id;
                    return (
                        <SongCard
                            track={item}
                            selected={selectedIds.includes(item.id)}
                            isCurrentTrack={isCurrent}
                            isPlaying={isCurrent && isPlaying}
                            onPress={(selected) => {
                                if (selectedIds.length > 0) {
                                    toggleSelect(selected.id);
                                } else {
                                    playTrack(selected, localTracks);
                                    onOpenPlayer?.();
                                }
                            }}
                            onLongPress={(selected) => toggleSelect(selected.id)}
                            onArtworkPress={(selected) => toggleSelect(selected.id)}
                        />
                    );
                }}
                ListEmptyComponent={
                    <Text style={[styles.emptyText, { color: mutedColor }]}>
                        {t('group.empty')}
                    </Text>
                }
            />

            <AddToPlaylistModal
                visible={playlistModalOpen}
                trackIds={selectedIds}
                onClose={() => setPlaylistModalOpen(false)}
                onAdded={() => setSelectedIds([])}
            />
        </Animated.View>
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
