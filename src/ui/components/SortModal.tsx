import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { SortOption } from '../../types/music';

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
    { key: 'date_desc', label: 'Más reciente (por defecto)' },
    { key: 'most_played', label: 'Más reproducida' },
    { key: 'title_asc', label: 'Título (A-Z)' },
    { key: 'title_desc', label: 'Título (Z-A)' },
    { key: 'artist_asc', label: 'Artista (A-Z)' },
    { key: 'artist_desc', label: 'Artista (Z-A)' },
    { key: 'duration_asc', label: 'Menor duración' },
    { key: 'duration_desc', label: 'Mayor duración' },
];

interface SortModalProps {
    visible: boolean;
    currentSort: SortOption;
    onSelect: (sort: SortOption) => void;
    onClose: () => void;
}

export const SortModal: React.FC<SortModalProps> = ({
    visible,
    currentSort,
    onSelect,
    onClose,
}) => (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
            <View style={styles.sheet}>
                <Text style={styles.title}>Ordenar por</Text>
                {SORT_OPTIONS.map((opt) => (
                    <TouchableOpacity
                        key={opt.key}
                        style={styles.row}
                        onPress={() => {
                            onSelect(opt.key);
                            onClose();
                        }}
                    >
                        <Text style={styles.label}>{opt.label}</Text>
                        {currentSort === opt.key && <Check size={18} color="#FFFFFF" />}
                    </TouchableOpacity>
                ))}
            </View>
        </TouchableOpacity>
    </Modal>
);

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.65)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: '#111827',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        padding: 20,
    },
    title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 12 },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
    },
    label: { color: '#E5E7EB', fontSize: 15 },
});