import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { SortOption } from '../../types/music';
import { AnimatedBottomSheet } from './AnimatedBottomSheet';

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
    <AnimatedBottomSheet visible={visible} onClose={onClose}>
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
                <Text style={[styles.label, currentSort === opt.key && styles.labelActive]}>
                    {opt.label}
                </Text>
                {currentSort === opt.key && <Check size={18} color="#38BDF8" />}
            </TouchableOpacity>
        ))}
    </AnimatedBottomSheet>
);

const styles = StyleSheet.create({
    title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 10 },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
    },
    label: { color: '#E5E7EB', fontSize: 15 },
    labelActive: { color: '#38BDF8', fontWeight: '700' },
});