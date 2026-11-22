import React, { useEffect, useMemo, useState } from 'react';
import {
    FlatList,
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Check, Download, Film, Music, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    DownloadFormatOption,
    ExtractedMediaInfo,
    PlaylistDownloadEntry,
} from '../../../modules/snow-metadata';

interface PlaylistDownloadModalProps {
    visible: boolean;
    mediaInfo: ExtractedMediaInfo | null;
    onClose: () => void;
    onConfirm: (entries: PlaylistDownloadEntry[], format: DownloadFormatOption) => void;
}

function formatDuration(sec: number): string {
    if (!sec || sec <= 0 || !Number.isFinite(sec)) return '--:--';
    const total = Math.floor(sec);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

// Pantalla de selección múltiple para descargar listas de reproducción completas o parciales
export const PlaylistDownloadModal: React.FC<PlaylistDownloadModalProps> = React.memo(
    ({ visible, mediaInfo, onClose, onConfirm }) => {
        const insets = useSafeAreaInsets();
        const entries = useMemo(() => mediaInfo?.entries ?? [], [mediaInfo?.entries]);
        const audioFormats = useMemo(() => mediaInfo?.audioFormats ?? [], [mediaInfo?.audioFormats]);
        const videoFormats = useMemo(() => mediaInfo?.videoFormats ?? [], [mediaInfo?.videoFormats]);

        const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
        const [formatTab, setFormatTab] = useState<'audio' | 'video'>('audio');
        const [selectedFormat, setSelectedFormat] = useState<DownloadFormatOption | null>(null);

        useEffect(() => {
            if (!visible || !mediaInfo) return;
            setSelectedIds(new Set(entries.map((e) => e.id)));
            setFormatTab('audio');
            setSelectedFormat(
                audioFormats.find((f) => f.qualityRank >= 128) ??
                    audioFormats[0] ??
                    videoFormats[0] ??
                    null
            );
        }, [visible, mediaInfo, entries, audioFormats, videoFormats]);

        const activeFormats = formatTab === 'audio' ? audioFormats : videoFormats;

        const handleSwitchFormatTab = (tab: 'audio' | 'video') => {
            setFormatTab(tab);
            const list = tab === 'audio' ? audioFormats : videoFormats;
            if (list.length > 0) setSelectedFormat(list[0]);
        };

        const allSelected = entries.length > 0 && selectedIds.size === entries.length;

        const toggleSelectAll = () => {
            if (allSelected) {
                setSelectedIds(new Set());
            } else {
                setSelectedIds(new Set(entries.map((e) => e.id)));
            }
        };

        const toggleItem = (id: string) => {
            setSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            });
        };

        const handleConfirm = () => {
            if (!selectedFormat || selectedIds.size === 0) return;
            const picked = entries.filter((e) => selectedIds.has(e.id));
            onConfirm(picked, selectedFormat);
        };

        return (
            <Modal
                visible={visible}
                animationType="slide"
                statusBarTranslucent
                onRequestClose={onClose}
            >
                <View
                    style={[
                        styles.container,
                        {
                            paddingTop: Math.max(insets.top, 26) + 6,
                            paddingBottom: Math.max(insets.bottom, 14) + 8,
                        },
                    ]}
                >
                    {/* Cabecera superior */}
                    <View style={styles.header}>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <X size={24} color="#FFFFFF" />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle} numberOfLines={1}>
                            Descarga de lista de reproducción
                        </Text>
                    </View>

                    {/* Fila Seleccionar todo */}
                    <TouchableOpacity
                        style={styles.selectAllRow}
                        activeOpacity={0.75}
                        onPress={toggleSelectAll}
                    >
                        <View style={[styles.checkCircle, allSelected && styles.checkCircleActive]}>
                            {allSelected && <Check size={14} color="#FFFFFF" strokeWidth={3} />}
                        </View>
                        <Text style={styles.selectAllText}>Seleccionar todo</Text>
                        <Text style={styles.selectCountBadge}>
                            {selectedIds.size}/{entries.length}
                        </Text>
                    </TouchableOpacity>

                    {/* Selector compacto de formato (Audio / Video de menor a mayor calidad) */}
                    <View style={styles.formatBar}>
                        <View style={styles.formatTypeToggle}>
                            <TouchableOpacity
                                style={[
                                    styles.typePill,
                                    formatTab === 'audio' && styles.typePillActive,
                                ]}
                                onPress={() => handleSwitchFormatTab('audio')}
                            >
                                <Music
                                    size={14}
                                    color={formatTab === 'audio' ? '#FFFFFF' : '#94A3B8'}
                                />
                                <Text
                                    style={[
                                        styles.typePillText,
                                        formatTab === 'audio' && styles.typePillTextActive,
                                    ]}
                                >
                                    Audio
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[
                                    styles.typePill,
                                    formatTab === 'video' && styles.typePillActive,
                                ]}
                                onPress={() => handleSwitchFormatTab('video')}
                            >
                                <Film
                                    size={14}
                                    color={formatTab === 'video' ? '#FFFFFF' : '#94A3B8'}
                                />
                                <Text
                                    style={[
                                        styles.typePillText,
                                        formatTab === 'video' && styles.typePillTextActive,
                                    ]}
                                >
                                    Video
                                </Text>
                            </TouchableOpacity>
                        </View>

                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.qualityChips}
                        >
                            {activeFormats.map((fmt) => {
                                const active = selectedFormat?.id === fmt.id;
                                return (
                                    <TouchableOpacity
                                        key={fmt.id}
                                        style={[
                                            styles.qualityChip,
                                            active && styles.qualityChipActive,
                                        ]}
                                        onPress={() => setSelectedFormat(fmt)}
                                    >
                                        <Text
                                            style={[
                                                styles.qualityChipText,
                                                active && styles.qualityChipTextActive,
                                            ]}
                                        >
                                            {fmt.label}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    </View>

                    {/* Lista numerada con miniaturas, duración y checkbox circular */}
                    <FlatList
                        data={entries}
                        keyExtractor={(item) => `${item.index}-${item.id}`}
                        contentContainerStyle={styles.listContent}
                        renderItem={({ item }) => {
                            const checked = selectedIds.has(item.id);
                            return (
                                <TouchableOpacity
                                    style={styles.entryRow}
                                    activeOpacity={0.78}
                                    onPress={() => toggleItem(item.id)}
                                >
                                    <View
                                        style={[
                                            styles.checkCircle,
                                            checked && styles.checkCircleActive,
                                        ]}
                                    >
                                        {checked && (
                                            <Check size={14} color="#FFFFFF" strokeWidth={3} />
                                        )}
                                    </View>

                                    <View style={styles.thumbWrap}>
                                        {item.thumbnail ? (
                                            <Image
                                                source={{ uri: item.thumbnail }}
                                                style={styles.thumbImg}
                                                resizeMode="cover"
                                            />
                                        ) : (
                                            <View style={[styles.thumbImg, styles.thumbFallback]}>
                                                <Music size={20} color="#71717A" />
                                            </View>
                                        )}
                                        <View style={styles.durationPill}>
                                            <Text style={styles.durationText}>
                                                {formatDuration(item.duration)}
                                            </Text>
                                        </View>
                                    </View>

                                    <View style={styles.entryTextCol}>
                                        <Text style={styles.entryIndex}>{item.index}.</Text>
                                        <Text style={styles.entryTitle} numberOfLines={2}>
                                            {item.title}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            );
                        }}
                    />

                    {/* Botón inferior grande Descargar (N) */}
                    <View style={styles.footerWrap}>
                        <TouchableOpacity
                            style={[
                                styles.downloadAllBtn,
                                (selectedIds.size === 0 || !selectedFormat) &&
                                    styles.downloadAllBtnDisabled,
                            ]}
                            disabled={selectedIds.size === 0 || !selectedFormat}
                            activeOpacity={0.85}
                            onPress={handleConfirm}
                        >
                            <Download size={19} color="#FFFFFF" />
                            <Text style={styles.downloadAllText}>
                                Descargar ({selectedIds.size})
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        );
    }
);

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0A1122',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingBottom: 12,
        gap: 10,
    },
    closeBtn: {
        width: 38,
        height: 38,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '800',
    },
    selectAllRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 18,
        paddingVertical: 10,
        gap: 14,
    },
    selectAllText: {
        flex: 1,
        color: '#E4E4E7',
        fontSize: 15,
        fontWeight: '600',
    },
    selectCountBadge: {
        color: '#A1A1AA',
        fontSize: 13,
        fontWeight: '700',
    },
    formatBar: {
        paddingHorizontal: 18,
        paddingBottom: 10,
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.07)',
    },
    formatTypeToggle: {
        flexDirection: 'row',
        gap: 8,
    },
    typePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: '#131E3A',
    },
    typePillActive: {
        backgroundColor: '#1E3A8A',
        borderWidth: 1,
        borderColor: '#2B52B8',
    },
    typePillText: {
        color: '#94A3B8',
        fontSize: 12.5,
        fontWeight: '700',
    },
    typePillTextActive: {
        color: '#FFFFFF',
    },
    qualityChips: {
        gap: 8,
    },
    qualityChip: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 10,
        backgroundColor: '#111B33',
        borderWidth: 1,
        borderColor: 'rgba(59,130,246,0.16)',
    },
    qualityChipActive: {
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(30,58,138,0.45)',
    },
    qualityChipText: {
        color: '#CBD5E1',
        fontSize: 12,
        fontWeight: '600',
    },
    qualityChipTextActive: {
        color: '#93C5FD',
        fontWeight: '800',
    },
    listContent: {
        paddingHorizontal: 18,
        paddingTop: 12,
        paddingBottom: 20,
        gap: 14,
    },
    entryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    checkCircle: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#64748B',
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkCircleActive: {
        backgroundColor: '#1E3A8A',
        borderColor: '#3B82F6',
    },
    thumbWrap: {
        width: 128,
        height: 74,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: '#27272A',
        position: 'relative',
    },
    thumbImg: {
        width: '100%',
        height: '100%',
    },
    thumbFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    durationPill: {
        position: 'absolute',
        right: 6,
        bottom: 6,
        backgroundColor: 'rgba(0,0,0,0.78)',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 5,
    },
    durationText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '700',
    },
    entryTextCol: {
        flex: 1,
        justifyContent: 'center',
    },
    entryIndex: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '800',
        marginBottom: 2,
    },
    entryTitle: {
        color: '#E4E4E7',
        fontSize: 13.5,
        lineHeight: 18,
    },
    footerWrap: {
        paddingHorizontal: 18,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.08)',
    },
    downloadAllBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#1E3A8A',
        borderWidth: 1,
        borderColor: '#2B52B8',
        paddingVertical: 15,
        borderRadius: 999,
    },
    downloadAllBtnDisabled: {
        opacity: 0.4,
    },
    downloadAllText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '800',
    },
});
