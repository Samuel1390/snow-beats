import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    FlatList,
    TextInput,
    Modal,
    StyleSheet,
    Alert,
} from 'react-native';
import { Plus, Heart, Clock, Flame, FileText, ListMusic } from 'lucide-react-native';
import {
    createPlaylist,
    getAutoPlaylistTracks,
    getPlaylists,
    Playlist,
} from '../../storage/database/db';
import { useTheme } from '../../theme/ThemeContext';

export const PlaylistsTab: React.FC = () => {
    const { fgColor, mutedColor } = useTheme();
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [modalOpen, setModalOpen] = useState(false);
    const [newName, setNewName] = useState('');

    const load = async () => setPlaylists(await getPlaylists());

    useEffect(() => {
        load();
    }, []);

    const handleCreate = async () => {
        if (!newName.trim()) return;
        await createPlaylist(newName);
        setNewName('');
        setModalOpen(false);
        load();
    };

    const openAutoPlaylist = async (
        type: 'favorites' | 'recent' | 'most_played' | 'with_lyrics',
        title: string
    ) => {
        const items = await getAutoPlaylistTracks(type);
        Alert.alert(title, `${items.length} canciones en esta lista.`);
    };

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
                    onPress={() => openAutoPlaylist(key, label)}
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
                    <View style={styles.row}>
                        <ListMusic size={20} color={fgColor} />
                        <View style={{ marginLeft: 12 }}>
                            <Text style={[styles.rowText, { color: fgColor, marginLeft: 0 }]}>{item.name}</Text>
                            <Text style={{ color: mutedColor, fontSize: 12 }}>{item.trackCount} canciones</Text>
                        </View>
                    </View>
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
    rowText: { fontSize: 15, fontWeight: '500', marginLeft: 12 },
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center',
        padding: 24,
    },
    modalCard: { backgroundColor: '#111827', borderRadius: 12, padding: 20 },
    modalTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 12 },
    input: {
        borderWidth: 1,
        borderColor: '#374151',
        borderRadius: 8,
        color: '#FFFFFF',
        padding: 10,
        marginBottom: 14,
    },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end' },
});