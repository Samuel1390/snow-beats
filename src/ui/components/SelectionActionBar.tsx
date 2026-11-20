import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CheckSquare, ListMusic, ListPlus, Share2, Trash2, X } from 'lucide-react-native';

interface SelectionActionBarProps {
    selectedCount: number;
    totalCount: number;
    onClear: () => void;
    onToggleSelectAll: () => void;
    onAddToQueue: () => void;
    onAddToPlaylist: () => void;
    onShare: () => void;
    onDelete: () => void;
}

// Barra contextual para acciones por lote sobre las canciones seleccionadas
export const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
    selectedCount,
    totalCount,
    onClear,
    onToggleSelectAll,
    onAddToQueue,
    onAddToPlaylist,
    onShare,
    onDelete,
}) => {
    if (selectedCount === 0) return null;

    const allSelected = totalCount > 0 && selectedCount >= totalCount;

    return (
        <View style={styles.wrapper}>
            <View style={styles.topRow}>
                <View style={styles.leftRow}>
                    <TouchableOpacity onPress={onClear} style={styles.iconBtn}>
                        <X size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                    <Text style={styles.countText}>
                        {selectedCount} {selectedCount === 1 ? 'seleccionada' : 'seleccionadas'}
                    </Text>
                </View>

                <TouchableOpacity onPress={onToggleSelectAll} style={styles.selectAllBtn}>
                    <CheckSquare size={16} color="#38BDF8" />
                    <Text style={styles.selectAllText}>
                        {allSelected ? 'Quitar todo' : 'Todas'}
                    </Text>
                </TouchableOpacity>
            </View>

            <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.actionBtn} onPress={onAddToQueue}>
                    <ListPlus size={19} color="#FFFFFF" />
                    <Text style={styles.actionLabel}>A la cola</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionBtn} onPress={onAddToPlaylist}>
                    <ListMusic size={19} color="#FFFFFF" />
                    <Text style={styles.actionLabel}>Playlist</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionBtn} onPress={onShare}>
                    <Share2 size={19} color="#FFFFFF" />
                    <Text style={styles.actionLabel}>Compartir</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionBtn} onPress={onDelete}>
                    <Trash2 size={19} color="#F87171" />
                    <Text style={[styles.actionLabel, { color: '#F87171' }]}>Eliminar</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        backgroundColor: '#111827',
        borderBottomWidth: 1,
        borderBottomColor: '#1F2937',
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 10,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    leftRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    iconBtn: {
        padding: 4,
        marginRight: 8,
    },
    countText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },
    selectAllBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
    },
    selectAllText: {
        color: '#38BDF8',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 6,
    },
    actionsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 6,
    },
    actionBtn: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: '#1F2937',
    },
    actionLabel: {
        color: '#E5E7EB',
        fontSize: 11,
        fontWeight: '600',
        marginTop: 4,
    },
});
