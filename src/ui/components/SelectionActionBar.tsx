import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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

// Barra contextual con slide-in al activar selección y slide-out al cerrar
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
    const visible = selectedCount > 0;
    const [mounted, setMounted] = useState(visible);
    const lastCountRef = useRef(selectedCount);
    const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

    if (selectedCount > 0) {
        lastCountRef.current = selectedCount;
    }

    useEffect(() => {
        if (visible) {
            setMounted(true);
            Animated.spring(anim, {
                toValue: 1,
                damping: 22,
                stiffness: 240,
                mass: 0.85,
                useNativeDriver: false,
            }).start();
        } else if (mounted) {
            Animated.timing(anim, {
                toValue: 0,
                duration: 180,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: false,
            }).start(({ finished }) => {
                if (finished) setMounted(false);
            });
        }
    }, [visible, mounted, anim]);

    if (!mounted) return null;

    const displayCount = visible ? selectedCount : lastCountRef.current;
    const allSelected = totalCount > 0 && displayCount >= totalCount;

    const maxHeight = anim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 128],
    });
    const translateY = anim.interpolate({
        inputRange: [0, 1],
        outputRange: [-28, 0],
    });

    return (
        <Animated.View
            style={[
                styles.clipWrapper,
                {
                    maxHeight,
                    opacity: anim,
                },
            ]}
        >
            <Animated.View style={[styles.wrapper, { transform: [{ translateY }] }]}>
                <View style={styles.topRow}>
                    <View style={styles.leftRow}>
                        <TouchableOpacity onPress={onClear} style={styles.iconBtn}>
                            <X size={20} color="#FFFFFF" />
                        </TouchableOpacity>
                        <Text style={styles.countText}>
                            {displayCount} {displayCount === 1 ? 'seleccionada' : 'seleccionadas'}
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
            </Animated.View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    clipWrapper: {
        overflow: 'hidden',
    },
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
