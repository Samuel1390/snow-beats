import React, { useEffect, useState } from 'react';
import {
    View, Text, TouchableOpacity, FlatList, TextInput, Modal, StyleSheet, Alert,
} from 'react-native';
import { Plus, Heart, Clock, Flame, FileText, ListMusic, ArrowLeft, Trash2 } from 'lucide-react-native';
import {
    createPlaylist, deletePlaylist, getAutoPlaylistTracks, getPlaylists, getPlaylistTracks,
    Playlist, removeTrackFromPlaylist,
} from '../../storage/database/db';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';
import { usePlayer } from '../../audio-engine/PlayerContext';
import { SongCard } from '../components/SongCard';

export const PlaylistsTab: React.FC = () => {
    const { fgColor, mutedColor } = useTheme();
    const { playTrack } = usePlayer();
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [modalOpen, setModalOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [opened, setOpened] = useState<{ id: string | null; title: string; tracks: Track[] } | null>(null);

    const load = async () => setPlaylists(await getPlaylists());
    useEffect(() => { load(); }, []);

    const handleCreate = async () => {
        if (!newName.trim()) return;
        await createPlaylist(newName);
        setNewName('');
        setModalOpen(false);
        load();
    };

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
                                Alert.alert('Eliminar playlist', `¿Eliminar "${opened.title}"?`, [
                                    { text: 'Cancelar', style: 'cancel' },
                                    {
                                        text: 'Eliminar',
                                        style: 'destructive',
                                        onPress: async () => {
                                            await deletePlaylist(opened.id!);
                                            setOpened(null);
                                            load();
                                        },
                                    },
                                ])
                            }
                        >
                            <Trash2 size={20} color="#F87171" />
                        </TouchableOpacity>
                    )}
                </View>

                <FlatList
                    data={opened.tracks}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <SongCard
                            track={item}
                            onPress={(t) => playTrack(t, opened.tracks)}
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
                    )}
                    ListEmptyComponent={
                        <Text style={{ color: mutedColor, textAlign: 'center', marginTop: 32 }}>
                            Esta playlist aún no tiene canciones.
                        </Text>
                    }
                />
            </View>
        );
    }

    const autoLists = [
        { key: 'favorites' as const, label: 'Canciones favoritas', icon: Heart },
        { key: 'recent' as const, label: 'Recientemente reproducidas', icon: Clock },
        { key: 'most_played' as const, label: 'Más reproducido', icon: Flame },
        { key: 'with_lyrics' as const, label: 'Con letras', icon: FileText },
    ];

    return (
        <View style={styles.container}>
            <TouchableOpacity style={styles.newBtn} onPress={() => setModalOpen(true)}>
                <Plus size={20} color="#000000" />
                <Text style={styles.newBtnText}>Nueva playlist</Text>
            </TouchableOpacity>

            <Text style={[styles.sectionTitle, { color: mutedColor }]}>Listas automáticas</Text>
            {autoLists.map(({ key, label, icon: Icon }) => (
                <TouchableOpacity
                    key={key}
                    style={styles.row}
                    onPress={async () => setOpened({ id: null, title: label, tracks: await getAutoPlaylistTracks(key) })}
                >
                    <Icon size={20} color={fgColor} />
                    <Text style={[styles.rowText, { color: fgColor }]}>{label}</Text>
                </TouchableOpacity>
            ))}

            <Text style={[styles.sectionTitle, { color: mutedColor, marginTop: 18 }]}>
                Tus playlists ({playlists.length})
            </Text>
            <FlatList
                data={playlists}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={styles.row}
                        onPress={async () =>
                            setOpened({ id: item.id, title: item.name, tracks: await getPlaylistTracks(item.id) })
                        }
                    >
                        <ListMusic size={20} color={fgColor} />
                        <View style={{ marginLeft: 12 }}>
                            <Text style={[styles.rowText, { color: fgColor, marginLeft: 0 }]}>{item.name}</Text>
                            <Text style={{ color: mutedColor, fontSize: 12 }}>{item.trackCount} canciones</Text>
                        </View>
                    </TouchableOpacity>
                )}
            />

            <Modal visible={modalOpen} transparent animationType="fade">
                <View style={styles.modalBackdrop}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>Nueva playlist</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Nombre de la playlist"
                            placeholderTextColor="#9CA3AF"
                            value={newName}
                            onChangeText={setNewName}
                            autoFocus
                        />
                        <View style={styles.modalActions}>
                            <TouchableOpacity onPress={() => setModalOpen(false)}>
                                <Text style={{ color: '#9CA3AF', padding: 10 }}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handleCreate}>
                                <Text style={{ color: '#FFFFFF', fontWeight: '700', padding: 10 }}>Crear</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, padding: 16 },
    newBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#FFFFFF', paddingVertical: 12, borderRadius: 10, marginBottom: 18,
    },
    newBtnText: { color: '#000000', fontWeight: '700', marginLeft: 8 },
    sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    rowText: { fontSize: 15, fontWeight: '500', marginLeft: 12 },
    detailHeader: {
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: 'rgba(156,163,175,0.2)',
    },
    detailTitle: { flex: 1, fontSize: 17, fontWeight: '700', marginLeft: 8 },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
    modalCard: { backgroundColor: '#111827', borderRadius: 12, padding: 20 },
    modalTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 12 },
    input: { borderWidth: 1, borderColor: '#374151', borderRadius: 8, color: '#FFFFFF', padding: 10, marginBottom: 14 },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end' },
});