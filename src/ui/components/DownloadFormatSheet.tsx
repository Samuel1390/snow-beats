import React, { useEffect, useState } from 'react';
import {
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Check, Film, Music, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DownloadFormatOption, ExtractedMediaInfo } from '../../../modules/snow-metadata';

interface DownloadFormatSheetProps {
    visible: boolean;
    mediaInfo: ExtractedMediaInfo | null;
    onClose: () => void;
    onConfirm: (format: DownloadFormatOption) => void;
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return 'Tamaño variable';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${mb.toFixed(1).replace('.', ',')} MB`;
}

// Hoja inferior de selección de formato (Audio y Video ordenados de menor a mayor calidad)
export const DownloadFormatSheet: React.FC<DownloadFormatSheetProps> = React.memo(
    ({ visible, mediaInfo, onClose, onConfirm }) => {
        const insets = useSafeAreaInsets();
        const audioFormats = mediaInfo?.audioFormats ?? [];
        const videoFormats = mediaInfo?.videoFormats ?? [];
        const [selected, setSelected] = useState<DownloadFormatOption | null>(null);

        useEffect(() => {
            if (!visible || !mediaInfo) return;
            // Selecciona por defecto MP3 clásico (o el segundo audio) si existe, o el primer formato disponible
            const defaultAudio =
                audioFormats.find((f) => f.qualityRank >= 128) ?? audioFormats[0] ?? null;
            const defaultVideo = videoFormats[0] ?? null;
            setSelected(defaultAudio ?? defaultVideo);
        }, [visible, mediaInfo, audioFormats, videoFormats]);

        if (!mediaInfo) return null;

        const renderOptionRow = (fmt: DownloadFormatOption) => {
            const isSelected = selected?.id === fmt.id;
            const isAudio = fmt.mediaType === 'audio';
            return (
                <TouchableOpacity
                    key={fmt.id}
                    style={[styles.formatRow, isSelected && styles.formatRowActive]}
                    activeOpacity={0.75}
                    onPress={() => setSelected(fmt)}
                >
                    <View style={styles.formatLeft}>
                        {isAudio ? (
                            <Music size={19} color={isSelected ? '#FACC15' : '#A1A1AA'} />
                        ) : (
                            <Film size={19} color={isSelected ? '#FACC15' : '#A1A1AA'} />
                        )}
                        <View style={styles.formatMeta}>
                            <Text style={styles.formatLabel} numberOfLines={1}>
                                {fmt.label}
                            </Text>
                            <Text style={styles.formatExt}>{fmt.ext.toUpperCase()}</Text>
                        </View>
                    </View>

                    <View style={styles.formatRight}>
                        <Text style={styles.formatSize}>{formatBytes(fmt.filesize)}</Text>
                        <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                            {isSelected && <Check size={13} color="#111114" strokeWidth={3} />}
                        </View>
                    </View>
                </TouchableOpacity>
            );
        };

        return (
            <Modal
                visible={visible}
                transparent
                animationType="slide"
                statusBarTranslucent
                onRequestClose={onClose}
            >
                <View style={styles.overlay}>
                    <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
                    <View
                        style={[
                            styles.sheet,
                            { paddingBottom: Math.max(insets.bottom, 16) + 8 },
                        ]}
                    >
                        <View style={styles.handleBar} />

                        <View style={styles.topRow}>
                            <Text style={styles.sheetTitle}>Descargar archivo como</Text>
                            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                                <X size={20} color="#A1A1AA" />
                            </TouchableOpacity>
                        </View>

                        {/* Encabezado con miniatura, título y dominio */}
                        <View style={styles.mediaHeader}>
                            {mediaInfo.thumbnail ? (
                                <Image
                                    source={{ uri: mediaInfo.thumbnail }}
                                    style={styles.mediaThumb}
                                    resizeMode="cover"
                                />
                            ) : (
                                <View style={[styles.mediaThumb, styles.thumbFallback]}>
                                    <Music size={22} color="#71717A" />
                                </View>
                            )}
                            <View style={styles.mediaInfoCol}>
                                <Text style={styles.mediaTitle} numberOfLines={2}>
                                    {mediaInfo.title || 'Sin título'}
                                </Text>
                                <Text style={styles.mediaDomain} numberOfLines={1}>
                                    {mediaInfo.domain || mediaInfo.platform || 'Streaming'}
                                </Text>
                            </View>
                        </View>

                        <ScrollView
                            style={styles.listScroll}
                            contentContainerStyle={styles.listContent}
                            showsVerticalScrollIndicator={false}
                        >
                            {audioFormats.length > 0 && (
                                <View style={styles.sectionBlock}>
                                    <Text style={styles.sectionHeading}>Audio (menor a mayor calidad)</Text>
                                    {audioFormats.map(renderOptionRow)}
                                </View>
                            )}

                            {videoFormats.length > 0 && (
                                <View style={styles.sectionBlock}>
                                    <Text style={styles.sectionHeading}>Video (menor a mayor calidad)</Text>
                                    {videoFormats.map(renderOptionRow)}
                                </View>
                            )}
                        </ScrollView>

                        <TouchableOpacity
                            style={[styles.confirmBtn, !selected && styles.confirmBtnDisabled]}
                            disabled={!selected}
                            activeOpacity={0.85}
                            onPress={() => {
                                if (selected) onConfirm(selected);
                            }}
                        >
                            <Text style={styles.confirmBtnText}>Descargar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        );
    }
);

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.62)',
    },
    backdrop: {
        flex: 1,
    },
    sheet: {
        backgroundColor: '#161618',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 18,
        paddingTop: 10,
        maxHeight: '82%',
        borderTopWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    handleBar: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.22)',
        alignSelf: 'center',
        marginBottom: 12,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
    },
    sheetTitle: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '800',
    },
    closeBtn: {
        padding: 4,
    },
    mediaHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
        gap: 12,
    },
    mediaThumb: {
        width: 106,
        height: 62,
        borderRadius: 10,
        backgroundColor: '#27272A',
    },
    thumbFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    mediaInfoCol: {
        flex: 1,
        gap: 4,
    },
    mediaTitle: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '700',
        lineHeight: 19,
    },
    mediaDomain: {
        color: '#A1A1AA',
        fontSize: 12.5,
    },
    listScroll: {
        maxHeight: 360,
    },
    listContent: {
        paddingBottom: 12,
        gap: 14,
    },
    sectionBlock: {
        gap: 6,
    },
    sectionHeading: {
        color: '#9CA3AF',
        fontSize: 13,
        fontWeight: '700',
        marginBottom: 4,
    },
    formatRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 10,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.02)',
    },
    formatRowActive: {
        backgroundColor: 'rgba(250,204,21,0.09)',
    },
    formatLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
        marginRight: 8,
    },
    formatMeta: {
        flex: 1,
    },
    formatLabel: {
        color: '#FFFFFF',
        fontSize: 14.5,
        fontWeight: '600',
    },
    formatExt: {
        color: '#71717A',
        fontSize: 11,
        fontWeight: '700',
        marginTop: 1,
    },
    formatRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    formatSize: {
        color: '#A1A1AA',
        fontSize: 12.5,
        fontWeight: '600',
    },
    radioOuter: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1.5,
        borderColor: '#71717A',
        justifyContent: 'center',
        alignItems: 'center',
    },
    radioOuterSelected: {
        backgroundColor: '#FACC15',
        borderColor: '#FACC15',
    },
    confirmBtn: {
        marginTop: 12,
        backgroundColor: '#FACC15',
        paddingVertical: 15,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    confirmBtnDisabled: {
        opacity: 0.45,
    },
    confirmBtnText: {
        color: '#111114',
        fontSize: 16,
        fontWeight: '800',
    },
});
