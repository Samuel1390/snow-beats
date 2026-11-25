import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    FlatList,
    TextInput,
    StyleSheet,
    Alert,
    BackHandler,
    RefreshControl,
} from 'react-native';
import { Plus, Heart, Clock, Flame, FileText, ArrowLeft, Trash2, ChevronRight } from 'lucide-react-native';
import {
    createPlaylist,
    deletePlaylist,
    getAutoPlaylistTracks,
    getPlaylists,
    getPlaylistTracks,
    Playlist,
    removeTrackFromPlaylist,
} from '../../storage/database/db';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';
import { useI18n } from '../../i18n';
import { usePlayer } from '../../audio-engine/PlayerContext';
import { SongCard } from '../components/SongCard';
import { CollageArtwork } from '../components/CollageArtWork';
import { AnimatedBottomSheet } from '../components/AnimatedBottomSheet';

interface PlaylistsTabProps {
    onOpenPlayer?: () => void;
    refreshKey?: number;
    refreshing?: boolean;
    onRefresh?: () => Promise<void> | void;
}

export const PlaylistsTab: React.FC<PlaylistsTabProps> = React.memo(
    ({ onOpenPlayer, refreshKey = 0, refreshing = false, onRefresh }) => {
        const { fgColor, mutedColor } = useTheme();
        const { t } = useI18n();
        const { currentTrack, isPlaying, playTrack } = usePlayer();
        const [playlists, setPlaylists] = useState<Playlist[]>([]);
        const [modalOpen, setModalOpen] = useState(false);
        const [newName, setNewName] = useState('');
        const [opened, setOpened] = useState<{
            id: string | null;
            autoKey?: 'favorites' | 'recent' | 'most_played' | 'with_lyrics';
            title: string;
            tracks: Track[];
        } | null>(null);

    const load = useCallback(async () => {
        setPlaylists(await getPlaylists());
    }, []);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    // Maneja botón físico Atrás en Android al ver el detalle de una playlist
    useEffect(() => {
        if (!opened) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            setOpened(null);
            return true;
        });
        return () => sub.remove();
    }, [opened]);

    const handleCreate = async () => {
        if (!newName.trim()) return;
        await createPlaylist(newName);
        setNewName('');
        setModalOpen(false);
        load();
    };

    const handlePullRefresh = useCallback(async () => {
        if (onRefresh) {
            await onRefresh();
        }
        await load();
        if (opened) {
            if (opened.id) {
                const refreshed = await getPlaylistTracks(opened.id);
                setOpened((prev) => (prev ? { ...prev, tracks: refreshed } : null));
            } else if (opened.autoKey) {
                const refreshed = await getAutoPlaylistTracks(opened.autoKey);
                setOpened((prev) => (prev ? { ...prev, tracks: refreshed } : null));
            }
        }
    }, [onRefresh, load, opened]);

    // Vista interna de una playlist abierta
    if (opened) {
        return (
            <View style={{ flex: 1 }}>
                <View style={styles.detailHeader}>
                    <TouchableOpacity onPress={() => setOpened(null)} style={{ padding: 6 }}>
                        <ArrowLeft size={22} color={fgColor} />
                    </TouchableOpacity>
                    <Text style={[styles.detailTitle, { color: fgColor }]} numberOfLines={1}>
                        {opened.title} ({opened.tracks.length})
                    </Text>
                    {opened.id && (
                        <TouchableOpacity
                            onPress={() =>
                                Alert.alert(
                                    t('playlists.deleteTitle'),
                                    t('playlists.deleteConfirm', { name: opened.title }),
                                    [
                                        { text: t('common.cancel'), style: 'cancel' },
                                        {
                                            text: t('common.delete'),
                                            style: 'destructive',
                                            onPress: async () => {
                                                await deletePlaylist(opened.id!);
                                                setOpened(null);
                                                load();
                                            },
                                        },
                                    ]
                                )
                            }
                        >
                            <Trash2 size={20} color="#F87171" />
                        </TouchableOpacity>
                    )}
                </View>

                <FlatList
                    data={opened.tracks}
                    keyExtractor={(item) => item.id}
                    extraData={{ currentTrackId: currentTrack?.id ?? null, isPlaying }}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={handlePullRefresh}
                            colors={['#38BDF8', '#1E3A8A']}
                            tintColor="#38BDF8"
                            progressBackgroundColor="#111827"
                        />
                    }
                    renderItem={({ item }) => {
                        const isCurrent = currentTrack?.id === item.id;
                        return (
                            <SongCard
                                track={item}
                                isCurrentTrack={isCurrent}
                                isPlaying={isCurrent && isPlaying}
                                onPress={(track) => {
                                    playTrack(track, opened.tracks);
                                    onOpenPlayer?.();
                                }}
                                onLongPress={
                                    opened.id
                                        ? async () => {
                                            await removeTrackFromPlaylist(opened.id!, item.id);
                                            const refreshed = await getPlaylistTracks(opened.id!);
                                            setOpened({ ...opened, tracks: refreshed });
                                            load();
                                        }
                                        : undefined
                                }
                            />
                        );
                    }}
                    ListEmptyComponent={
                        <Text style={{ color: mutedColor, textAlign: 'center', marginTop: 32 }}>
                            {t('playlists.emptyPlaylist')}
                        </Text>
                    }
                />
            </View>
        );
    }

    const autoLists = [
        { key: 'favorites' as const, label: t('playlists.favorites'), icon: Heart },
        { key: 'recent' as const, label: t('playlists.recent'), icon: Clock },
        { key: 'most_played' as const, label: t('playlists.mostPlayed'), icon: Flame },
        { key: 'with_lyrics' as const, label: t('playlists.withLyrics'), icon: FileText },
    ];

    return (
        <View style={styles.container}>
            <FlatList
                data={playlists}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ flexGrow: 1 }}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handlePullRefresh}
                        colors={['#38BDF8', '#1E3A8A']}
                        tintColor="#38BDF8"
                        progressBackgroundColor="#111827"
                    />
                }
                ListHeaderComponent={
                    <View>
                        <TouchableOpacity style={styles.newBtn} onPress={() => setModalOpen(true)}>
                            <Plus size={20} color="#000000" />
                            <Text style={styles.newBtnText}>{t('playlists.newBtn')}</Text>
                        </TouchableOpacity>

                        <Text style={[styles.sectionTitle, { color: mutedColor }]}>
                            {t('playlists.autoSection')}
                        </Text>
                        {autoLists.map(({ key, label, icon: Icon }) => (
                            <TouchableOpacity
                                key={key}
                                style={styles.row}
                                onPress={async () =>
                                    setOpened({
                                        id: null,
                                        autoKey: key,
                                        title: label,
                                        tracks: await getAutoPlaylistTracks(key),
                                    })
                                }
                            >
                                <Icon size={20} color={fgColor} />
                                <Text style={[styles.rowText, { color: fgColor }]}>{label}</Text>
                            </TouchableOpacity>
                        ))}

                        <Text style={[styles.sectionTitle, { color: mutedColor, marginTop: 18 }]}>
                            {t('playlists.yourPlaylists', { count: playlists.length })}
                        </Text>
                    </View>
                }
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={styles.playlistRow}
                        activeOpacity={0.7}
                        onPress={async () =>
                            setOpened({
                                id: item.id,
                                title: item.name,
                                tracks: await getPlaylistTracks(item.id),
                            })
                        }
                    >
                        <CollageArtwork
                            artworks={item.recentArtworks}
                            totalTracks={item.trackCount}
                            size={50}
                        />
                        <View style={{ marginLeft: 12, flex: 1 }}>
                            <Text style={[styles.rowText, { color: fgColor, marginLeft: 0 }]} numberOfLines={1}>
                                {item.name}
                            </Text>
                            <Text style={{ color: mutedColor, fontSize: 12, marginTop: 2 }}>
                                {item.trackCount}{' '}
                                {item.trackCount === 1
                                    ? t('common.songSingular')
                                    : t('common.songPlural')}
                            </Text>
                        </View>
                        <ChevronRight size={18} color={mutedColor} />
                    </TouchableOpacity>
                )}
            />

            {/* Lámina animada que sube automáticamente junto con el teclado */}
            <AnimatedBottomSheet
                visible={modalOpen}
                onClose={() => setModalOpen(false)}
                avoidKeyboard
            >
                <Text style={styles.modalTitle}>{t('playlists.newBtn')}</Text>
                <TextInput
                    style={styles.input}
                    placeholder={t('playlists.namePlaceholder')}
                    placeholderTextColor="#9CA3AF"
                    value={newName}
                    onChangeText={setNewName}
                    onSubmitEditing={handleCreate}
                    returnKeyType="done"
                    autoFocus
                />
                <View style={styles.modalActions}>
                    <TouchableOpacity onPress={() => setModalOpen(false)}>
                        <Text style={{ color: '#9CA3AF', padding: 10 }}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.createConfirmBtn, !newName.trim() && { opacity: 0.5 }]}
                        disabled={!newName.trim()}
                        onPress={handleCreate}
                    >
                        <Text style={{ color: '#000000', fontWeight: '700' }}>
                            {t('common.create')}
                        </Text>
                    </TouchableOpacity>
                </View>
            </AnimatedBottomSheet>
        </View>
    );
});

const styles = StyleSheet.create({
    container: { flex: 1, padding: 16 },
    newBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFFFFF',
        paddingVertical: 12,
        borderRadius: 10,
        marginBottom: 18,
    },
    newBtnText: { color: '#000000', fontWeight: '700', marginLeft: 8 },
    sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    playlistRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
    rowText: { fontSize: 15, fontWeight: '500', marginLeft: 12 },
    detailHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(156,163,175,0.2)',
    },
    detailTitle: { flex: 1, fontSize: 17, fontWeight: '700', marginLeft: 8 },
    modalTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 12 },
    input: {
        borderWidth: 1,
        borderColor: '#374151',
        backgroundColor: '#1F2937',
        borderRadius: 8,
        color: '#FFFFFF',
        paddingHorizontal: 12,
        paddingVertical: 11,
        marginBottom: 14,
        fontSize: 15,
    },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10 },
    createConfirmBtn: {
        backgroundColor: '#38BDF8',
        paddingHorizontal: 18,
        paddingVertical: 9,
        borderRadius: 8,
    },
});