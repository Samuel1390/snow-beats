import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { SortOption } from '../../types/music';
import { AnimatedBottomSheet } from './AnimatedBottomSheet';
import { useI18n } from '../../i18n/LanguageContext';
import { TranslationKey } from '../../i18n/types';

const SORT_OPTIONS: { key: SortOption; labelKey: TranslationKey }[] = [
    { key: 'date_desc', labelKey: 'sort.date_desc' },
    { key: 'most_played', labelKey: 'sort.most_played' },
    { key: 'title_asc', labelKey: 'sort.title_asc' },
    { key: 'title_desc', labelKey: 'sort.title_desc' },
    { key: 'artist_asc', labelKey: 'sort.artist_asc' },
    { key: 'artist_desc', labelKey: 'sort.artist_desc' },
    { key: 'duration_asc', labelKey: 'sort.duration_asc' },
    { key: 'duration_desc', labelKey: 'sort.duration_desc' },
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
}) => {
    const { t } = useI18n();
    return (
        <AnimatedBottomSheet visible={visible} onClose={onClose}>
            <Text style={styles.title}>{t('sort.title')}</Text>
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
                        {t(opt.labelKey)}
                    </Text>
                    {currentSort === opt.key && <Check size={18} color="#38BDF8" />}
                </TouchableOpacity>
            ))}
        </AnimatedBottomSheet>
    );
};

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