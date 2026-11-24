import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Modal,
    View,
    Text,
    TextInput,
    FlatList,
    TouchableOpacity,
    StyleSheet,
} from 'react-native';
import { ArrowLeft, Clock, X } from 'lucide-react-native';
import { Track } from '../../types/music';
import {
    addSearchHistory,
    getSearchHistory,
    getVisibleTracks,
    searchTracks,
} from '../../storage/database/db';
import { usePlayer } from '../../audio-engine/PlayerContext';
import { SongCard } from './SongCard';

interface SearchModalProps {
    visible: boolean;
    tracks?: Track[];
    onClose: () => void;
    onSelectTrack: (track: Track) => void;
}

// Filtro instantáneo en memoria (prioridad 1.º título, 2.º artista) para respuesta inmediata al teclear o borrar
function filterTracksInstant(list: Track[], rawQuery: string): Track[] {
    const clean = rawQuery.trim().toLowerCase();
    if (!clean) return [];
    const byTitle: Track[] = [];
    const byArtist: Track[] = [];
    for (const track of list) {
        if (track.title.toLowerCase().includes(clean)) {
            byTitle.push(track);
        } else if (track.artist.toLowerCase().includes(clean)) {
            byArtist.push(track);
        }
    }
    byTitle.sort((a, b) => a.title.localeCompare(b.title));
    byArtist.sort((a, b) => a.title.localeCompare(b.title));
    return [...byTitle, ...byArtist];
}

export const SearchModal: React.FC<SearchModalProps> = ({
    visible,
    tracks,
    onClose,
    onSelectTrack,
}) => {
    const { currentTrack, isPlaying } = usePlayer();
    const [query, setQuery] = useState('');
    const [history, setHistory] = useState<string[]>([]);
    const [results, setResults] = useState<Track[]>([]);
    const [cachedTracks, setCachedTracks] = useState<Track[]>(tracks ?? []);
    const requestIdRef = useRef(0);

    // Mantiene la caché sincronizada con la lista principal
    useEffect(() => {
        if (tracks) {
            setCachedTracks(tracks);
        }
    }, [tracks]);

    useEffect(() => {
        if (!visible) return;
        getSearchHistory().then(setHistory).catch(() => { });
        if (!tracks || tracks.length === 0) {
            getVisibleTracks('date_desc').then(setCachedTracks).catch(() => { });
        }
    }, [visible, tracks]);

    // Actualiza instantáneamente en memoria y reconcilia con SQLite (incluyendo letras) cancelando consultas viejas
    const runSearch = useCallback(
        (text: string) => {
            setQuery(text);
            const requestId = ++requestIdRef.current;

            if (!text.trim()) {
                setResults([]);
                return;
            }

            // 1. Respuesta inmediata en el mismo frame (0 ms de retraso)
            const instant = filterTracksInstant(cachedTracks, text);
            setResults(instant);

            // 2. Consulta fresca en SQLite (agrega coincidencias en letras sin pisar búsquedas más nuevas)
            searchTracks(text)
                .then((dbResults) => {
                    if (requestId === requestIdRef.current) {
                        setResults(dbResults);
                    }
                })
                .catch(() => { });
        },
        [cachedTracks]
    );

    const handleSubmit = async () => {
        if (!query.trim()) return;
        await addSearchHistory(query);
        setHistory(await getSearchHistory());
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <View style={styles.container}>
                <View style={styles.searchBar}>
                    <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
                        <ArrowLeft size={22} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TextInput
                        style={styles.input}
                        placeholder="Buscar título, artista o letra..."
                        placeholderTextColor="#9CA3AF"
                        value={query}
                        onChangeText={runSearch}
                        onSubmitEditing={handleSubmit}
                        returnKeyType="search"
                        autoCorrect={false}
                        autoFocus
                    />
                    {query.length > 0 && (
                        <TouchableOpacity onPress={() => runSearch('')} style={styles.iconBtn}>
                            <X size={20} color="#9CA3AF" />
                        </TouchableOpacity>
                    )}
                </View>

                {query.trim().length === 0 ? (
                    <View style={styles.historyBox}>
                        <Text style={styles.sectionTitle}>Búsquedas recientes (últimas 10)</Text>
                        {history.length === 0 ? (
                            <Text style={styles.emptyText}>Sin historial de búsqueda.</Text>
                        ) : (
                            history.map((item) => (
                                <TouchableOpacity
                                    key={item}
                                    style={styles.historyRow}
                                    onPress={() => runSearch(item)}
                                >
                                    <Clock size={16} color="#9CA3AF" />
                                    <Text style={styles.historyText}>{item}</Text>
                                </TouchableOpacity>
                            ))
                        )}
                    </View>
                ) : (
                    <FlatList
                        data={results}
                        keyExtractor={(item) => item.id}
                        extraData={{ currentTrackId: currentTrack?.id ?? null, isPlaying }}
                        keyboardShouldPersistTaps="handled"
                        renderItem={({ item }) => {
                            const isCurrent = currentTrack?.id === item.id;
                            return (
                                <SongCard
                                    track={item}
                                    highlightQuery={query}
                                    isCurrentTrack={isCurrent}
                                    isPlaying={isCurrent && isPlaying}
                                    onPress={async (t) => {
                                        await addSearchHistory(query);
                                        onSelectTrack(t);
                                        onClose();
                                    }}
                                />
                            );
                        }}
                        ListEmptyComponent={
                            <Text style={styles.emptyText}>No se encontraron coincidencias.</Text>
                        }
                    />
                )}
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0A0A0A', paddingTop: 42 },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#1F2937',
    },
    iconBtn: { padding: 8 },
    input: { flex: 1, color: '#FFFFFF', fontSize: 16, paddingHorizontal: 8 },
    historyBox: { padding: 16 },
    sectionTitle: { color: '#9CA3AF', fontSize: 13, fontWeight: '600', marginBottom: 12 },
    historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
    historyText: { color: '#FFFFFF', fontSize: 15, marginLeft: 10 },
    emptyText: { color: '#6B7280', textAlign: 'center', marginTop: 24 },
});