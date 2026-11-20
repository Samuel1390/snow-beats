import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    FlatList,
    TextInput,
    StyleSheet,
    Alert,
} from 'react-native';
import { Plus, X } from 'lucide-react-native';
import {
    addTracksToPlaylist,
    createPlaylist,
    getPlaylists,
    Playlist,
} from '../../storage/database/db';
import { AnimatedBottomSheet } from './AnimatedBottomSheet';
import { CollageArtwork } from './CollageArtWork';

interface AddToPlaylistModalProps {
    visible: boolean;
    trackIds: string[];
    onClose: () => void;
    onAdded?: (playlistName: string, addedCount: number) => void;
}

export const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({
    visible,
    trackIds,
    onClose,
    onAdded,
}) => {
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (visible) {
            setCreating(false);
            setNewName('');
            getPlaylists()
                .then(setPlaylists)
                .catch(() => { });
        }
    }, [visible]);

    // Agrega las pistas seleccionadas a una playlist existente
    const handleSelectPlaylist = async (playlist: Playlist) => {
        if (saving || trackIds.length === 0) return;
        setSaving(true);
        try {
            const added = await addTracksToPlaylist(playlist.id, trackIds);
            onAdded?.(playlist.name, added);
            onClose();
            if (added === 0) {
                Alert.alert('Playlist', `Las canciones ya estaban en "${playlist.name}".`);
            }
        } finally {
            setSaving(false);
        }
    };

    // Crea una playlist nueva e inserta inmediatamente las pistas seleccionadas
    const handleCreateAndAdd = async () => {
        const clean = newName.trim();
        if (!clean || saving || trackIds.length === 0) return;
        setSaving(true);
        try {
            const created = await createPlaylist(clean);
            const added = await addTracksToPlaylist(created.id, trackIds);
            onAdded?.(created.name, added);
            setNewName('');
            setCreating(false);
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <AnimatedBottomSheet visible={visible} onClose={onClose} avoidKeyboard sheetStyle={styles.sheet}>
            <View style={styles.header}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.title}>Agregar a playlist</Text>
                    <Text style={styles.subtitle}>
                        {trackIds.length}{' '}
                        {trackIds.length === 1 ? 'canción seleccionada' : 'canciones seleccionadas'}
                    </Text>
                </View>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                    <X size={20} color="#9CA3AF" />
                </TouchableOpacity>
            </View>

            {/* Formulario rápido para crear una nueva playlist sobre el teclado */}
            {creating ? (
                <View style={styles.createBox}>
                    <TextInput
                        style={styles.input}
                        placeholder="Nombre de la nueva playlist"
                        placeholderTextColor="#9CA3AF"
                        value={newName}
                        onChangeText={setNewName}
                        autoFocus
                        onSubmitEditing={handleCreateAndAdd}
                    />
                    <View style={styles.createActions}>
                        <TouchableOpacity onPress={() => setCreating(false)} style={styles.cancelBtn}>
                            <Text style={styles.cancelText}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={handleCreateAndAdd}
                            style={styles.confirmBtn}
                            disabled={saving || !newName.trim()}
                        >
                            <Text style={styles.confirmText}>Crear y agregar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            ) : (
                <TouchableOpacity style={styles.newRow} onPress={() => setCreating(true)}>
                    <View style={styles.newIconBox}>
                        <Plus size={18} color="#000000" />
                    </View>
                    <Text style={styles.newText}>Nueva playlist</Text>
                </TouchableOpacity>
            )}

            <FlatList
                data={playlists}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                style={styles.list}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={styles.playlistRow}
                        onPress={() => handleSelectPlaylist(item)}
                        disabled={saving}
                    >
                        <CollageArtwork
                            artworks={item.recentArtworks}
                            totalTracks={item.trackCount}
                            size={40}
                        />
                        <View style={styles.playlistInfo}>
                            <Text style={styles.playlistName} numberOfLines={1}>
                                {item.name}
                            </Text>
                            <Text style={styles.playlistCount}>
                                {item.trackCount} {item.trackCount === 1 ? 'canción' : 'canciones'}
                            </Text>
                        </View>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={
                    <Text style={styles.emptyText}>
                        Aún no tienes playlists manuales. Crea una arriba.
                    </Text>
                }
            />
        </AnimatedBottomSheet>
    );
};

const styles = StyleSheet.create({
    sheet: {
        maxHeight: '76%',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
    },
    title: {
        color: '#FFFFFF',
        fontSize: 17,
        fontWeight: '700',
    },
    subtitle: {
        color: '#9CA3AF',
        fontSize: 12,
        marginTop: 2,
    },
    closeBtn: {
        padding: 6,
    },
    newRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#1F2937',
        marginBottom: 6,
    },
    newIconBox: {
        width: 40,
        height: 40,
        borderRadius: 8,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    newText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '600',
    },
    createBox: {
        backgroundColor: '#1F2937',
        borderRadius: 10,
        padding: 12,
        marginBottom: 10,
    },
    input: {
        backgroundColor: '#111827',
        borderWidth: 1,
        borderColor: '#374151',
        borderRadius: 8,
        color: '#FFFFFF',
        paddingHorizontal: 10,
        paddingVertical: 9,
        fontSize: 14,
    },
    createActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 10,
        gap: 8,
    },
    cancelBtn: {
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    cancelText: {
        color: '#9CA3AF',
        fontSize: 13,
    },
    confirmBtn: {
        backgroundColor: '#38BDF8',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
    },
    confirmText: {
        color: '#000000',
        fontWeight: '700',
        fontSize: 13,
    },
    list: {
        maxHeight: 280,
    },
    playlistRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
    },
    playlistInfo: {
        marginLeft: 12,
        flex: 1,
    },
    playlistName: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '500',
    },
    playlistCount: {
        color: '#9CA3AF',
        fontSize: 12,
        marginTop: 2,
    },
    emptyText: {
        color: '#6B7280',
        textAlign: 'center',
        paddingVertical: 20,
        fontSize: 13,
    },
});
