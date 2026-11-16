import React, { useEffect, useState } from 'react';
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
    searchTracks,
} from '../../storage/database/db';
import { SongCard } from './SongCard';

interface SearchModalProps {
    visible: boolean;
    onClose: () => void;
    onSelectTrack: (track: Track) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
    visible,
    onClose,
    onSelectTrack,
}) => {
    const [query, setQuery] = useState('');
    const [history, setHistory] = useState<string[]>([]);
    const [results, setResults] = useState<Track[]>([]);

    useEffect(() => {
        if (visible) {
            getSearchHistory().then(setHistory);
        }
    }, [visible]);

    useEffect(() => {
        if (!query.trim()) {
            setResults([]);
            return;
        }
        const timer = setTimeout(() => {
            searchTracks(query).then(setResults);
        }, 150);
        return () => clearTimeout(timer);
    }, [query]);

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
                        onChangeText={setQuery}
                        onSubmitEditing={handleSubmit}
                        autoFocus
                    />
                    {query.length > 0 && (
                        <TouchableOpacity onPress={() => setQuery('')} style={styles.iconBtn}>
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
                                    onPress={() => setQuery(item)}
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
                        renderItem={({ item }) => (
                            <SongCard
                                track={item}
                                highlightQuery={query}
                                onPress={async (t) => {
                                    await addSearchHistory(query);
                                    onSelectTrack(t);
                                    onClose();
                                }}
                            />
                        )}
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