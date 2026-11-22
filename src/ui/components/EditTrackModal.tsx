import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import {
    Check,
    ExternalLink,
    FileText,
    FileUp,
    ImagePlus,
    Music,
    Pencil,
    RotateCcw,
    Search,
    Sparkles,
    X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { persistCoverImage, pickLyricsFile } from '../../../modules/snow-metadata';
import {
    buildLetrasComUrl,
    ParsedLyrics,
    parseLyricsText,
    setCachedTrackLyrics,
} from '../../audio-engine/lyricsParser';
import { saveEditedTrackData } from '../../storage/database/db';
import { getDynamicPlayerPalette } from '../../theme/colorContrast';
import { Track } from '../../types/music';
import { LyricsEditorModal } from './LyricsEditorModal';

export interface EditedTrackResult {
    title: string;
    artist: string;
    artworkUri: string | null;
    dominantColor: string | null;
    hasLyrics: boolean;
    parsedLyrics: ParsedLyrics | null;
}

interface EditTrackModalProps {
    visible: boolean;
    track: Track;
    initialLyrics: ParsedLyrics | null;
    onClose: () => void;
    onSaved: (result: EditedTrackResult) => void;
}

// Carta editable espejo de la SongCard: permite editar carátula (recorte 1:1), título, artista y letras
export const EditTrackModal: React.FC<EditTrackModalProps> = React.memo(
    ({ visible, track, initialLyrics, onClose, onSaved }) => {
        const insets = useSafeAreaInsets();
        const { width: screenWidth } = useWindowDimensions();

        const [title, setTitle] = useState(track.title);
        const [artist, setArtist] = useState(track.artist);
        const [coverUri, setCoverUri] = useState<string | null>(track.artworkUri);
        const [coverChanged, setCoverChanged] = useState(false);
        const [dominantColor, setDominantColor] = useState<string | null>(
            track.dominantColor ?? null
        );
        const [lyricsText, setLyricsText] = useState(initialLyrics?.rawText ?? '');
        const [lyricsModalOpen, setLyricsModalOpen] = useState(false);
        const [saving, setSaving] = useState(false);
        const [importingFile, setImportingFile] = useState(false);

        useEffect(() => {
            if (!visible) return;
            setTitle(track.title);
            setArtist(track.artist);
            setCoverUri(track.artworkUri);
            setCoverChanged(false);
            setDominantColor(track.dominantColor ?? null);
            setLyricsText(initialLyrics?.rawText ?? '');
            setLyricsModalOpen(false);
        }, [visible, track.id, track.title, track.artist, track.artworkUri, track.dominantColor, initialLyrics?.rawText]);

        const palette = useMemo(
            () => getDynamicPlayerPalette(dominantColor),
            [dominantColor]
        );

        const parsedDraftLyrics = useMemo(() => parseLyricsText(lyricsText), [lyricsText]);
        const hasDraftLyrics = parsedDraftLyrics.lines.length > 0;
        const letrasInfo = useMemo(() => buildLetrasComUrl(artist, title), [artist, title]);

        const coverSide = Math.min(screenWidth - 72, 272);

        // Abre la galería del usuario con recorte cuadrado 1:1 para la carátula
        const handlePickCover = useCallback(async () => {
            try {
                if (Platform.OS !== 'web') {
                    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (!perm.granted) {
                        Alert.alert(
                            'Permiso requerido',
                            'Permite el acceso a tu galería para elegir y recortar la carátula 1:1.'
                        );
                        return;
                    }
                }
                const picked = await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ['images'],
                    allowsEditing: true,
                    aspect: [1, 1],
                    quality: 0.9,
                });
                if (picked.canceled || !picked.assets?.[0]?.uri) return;
                setCoverUri(picked.assets[0].uri);
                setCoverChanged(true);
            } catch {
                Alert.alert('Error', 'No se pudo abrir la galería de imágenes.');
            }
        }, []);

        const handleResetCover = useCallback(() => {
            setCoverUri(track.artworkUri);
            setCoverChanged(false);
            setDominantColor(track.dominantColor ?? null);
        }, [track.artworkUri, track.dominantColor]);

        const handleOpenLetrasBrowser = useCallback(async () => {
            try {
                await Linking.openURL(letrasInfo.url);
            } catch {
                Alert.alert('Error', `No se pudo abrir ${letrasInfo.displayUrl}.`);
            }
        }, [letrasInfo]);

        const handleQuickImportFile = useCallback(async () => {
            if (Platform.OS === 'web' && typeof document !== 'undefined') {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.lrc,.txt,text/plain';
                input.onchange = async () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    try {
                        const content = (await file.text()).replace(/^\uFEFF/, '').trim();
                        if (content) setLyricsText(content);
                    } catch { }
                };
                input.click();
                return;
            }
            setImportingFile(true);
            try {
                const res = await pickLyricsFile();
                if (res.cancelled) return;
                if (!res.ok || !res.content) {
                    Alert.alert(
                        'Importación fallida',
                        res.errorMessage || 'No se pudo leer el archivo seleccionado.'
                    );
                    return;
                }
                setLyricsText(res.content);
            } finally {
                setImportingFile(false);
            }
        }, []);

        const handleSaveAll = useCallback(async () => {
            const cleanTitle = title.trim() || track.title || 'Sin título';
            const cleanArtist = artist.trim() || 'Artista desconocido';
            const cleanLyrics = lyricsText.trim();

            setSaving(true);
            try {
                let finalArtworkUri = coverUri;
                let finalDominantColor = dominantColor;

                if (coverChanged && coverUri && Platform.OS !== 'web') {
                    const persisted = await persistCoverImage(coverUri, track.id);
                    if (persisted?.artworkUri) {
                        finalArtworkUri = persisted.artworkUri;
                        finalDominantColor = persisted.dominantColor ?? finalDominantColor;
                    }
                }

                await saveEditedTrackData(track.id, {
                    title: cleanTitle,
                    artist: cleanArtist,
                    artworkUri: finalArtworkUri,
                    dominantColor: finalDominantColor,
                    lyricsText: cleanLyrics,
                });

                const updatedLyrics = setCachedTrackLyrics(
                    track.id,
                    cleanLyrics.length > 0 ? cleanLyrics : null
                );

                onSaved({
                    title: cleanTitle,
                    artist: cleanArtist,
                    artworkUri: finalArtworkUri,
                    dominantColor: finalDominantColor,
                    hasLyrics: Boolean(updatedLyrics && updatedLyrics.lines.length > 0),
                    parsedLyrics: updatedLyrics,
                });
                onClose();
            } catch {
                Alert.alert('Error', 'No se pudieron guardar los cambios de la canción.');
            } finally {
                setSaving(false);
            }
        }, [
            title,
            artist,
            lyricsText,
            coverUri,
            coverChanged,
            dominantColor,
            track.id,
            track.title,
            onSaved,
            onClose,
        ]);

        return (
            <Modal
                visible={visible}
                animationType="slide"
                statusBarTranslucent
                onRequestClose={onClose}
            >
                <LinearGradient
                    colors={[palette.background, palette.backgroundBottom]}
                    style={styles.gradientRoot}
                >
                    <View style={styles.darkScrim} />
                    <KeyboardAvoidingView
                        style={styles.flexOne}
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    >
                        <View
                            style={[
                                styles.innerContainer,
                                {
                                    paddingTop: Math.max(insets.top, 26) + 6,
                                    paddingBottom: Math.max(insets.bottom, 14) + 10,
                                },
                            ]}
                        >
                            {/* Barra superior idéntica en estructura a la SongCard */}
                            <View style={styles.topBar}>
                                <TouchableOpacity style={styles.headerIconBtn} onPress={onClose}>
                                    <X size={22} color="#FFFFFF" />
                                </TouchableOpacity>
                                <Text style={styles.headerTitle}>Editar datos</Text>
                                <TouchableOpacity
                                    style={[styles.saveChip, saving && { opacity: 0.65 }]}
                                    disabled={saving}
                                    activeOpacity={0.85}
                                    onPress={handleSaveAll}
                                >
                                    {saving ? (
                                        <ActivityIndicator size="small" color="#FFFFFF" />
                                    ) : (
                                        <>
                                            <Check size={16} color="#FFFFFF" />
                                            <Text style={styles.saveChipText}>Guardar</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </View>

                            <ScrollView
                                style={styles.flexOne}
                                contentContainerStyle={styles.scrollContent}
                                keyboardShouldPersistTaps="handled"
                                showsVerticalScrollIndicator={false}
                            >
                                {/* Carátula 1:1 grande estilo SongCard con botón de galería + recorte */}
                                <View style={styles.coverBlock}>
                                    <TouchableOpacity
                                        style={[
                                            styles.coverFrame,
                                            { width: coverSide, height: coverSide },
                                        ]}
                                        activeOpacity={0.86}
                                        onPress={handlePickCover}
                                    >
                                        {coverUri ? (
                                            <Image
                                                source={{ uri: coverUri }}
                                                style={styles.coverImg}
                                                resizeMode="cover"
                                            />
                                        ) : (
                                            <View style={styles.coverPlaceholder}>
                                                <Music size={72} color="#64748B" />
                                            </View>
                                        )}
                                        <View style={styles.coverEditPill}>
                                            <ImagePlus size={15} color="#FFFFFF" />
                                            <Text style={styles.coverEditText}>
                                                Cambiar carátula (1:1)
                                            </Text>
                                        </View>
                                    </TouchableOpacity>

                                    {coverChanged && (
                                        <TouchableOpacity
                                            style={styles.resetCoverBtn}
                                            onPress={handleResetCover}
                                        >
                                            <RotateCcw size={13} color="#CBD5E1" />
                                            <Text style={styles.resetCoverText}>
                                                Restaurar carátula original
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                </View>

                                {/* Campos editables de Título y Artista justo debajo de la portada */}
                                <View style={styles.metaCard}>
                                    <View style={styles.fieldGroup}>
                                        <View style={styles.fieldLabelRow}>
                                            <Pencil size={13} color="#93C5FD" />
                                            <Text style={styles.fieldLabel}>Título</Text>
                                        </View>
                                        <TextInput
                                            style={styles.titleInput}
                                            value={title}
                                            onChangeText={setTitle}
                                            placeholder="Título de la canción"
                                            placeholderTextColor="rgba(255,255,255,0.42)"
                                            returnKeyType="next"
                                        />
                                    </View>

                                    <View style={styles.divider} />

                                    <View style={styles.fieldGroup}>
                                        <View style={styles.fieldLabelRow}>
                                            <Pencil size={13} color="#93C5FD" />
                                            <Text style={styles.fieldLabel}>Artista</Text>
                                        </View>
                                        <TextInput
                                            style={styles.artistInput}
                                            value={artist}
                                            onChangeText={setArtist}
                                            placeholder="Nombre del artista"
                                            placeholderTextColor="rgba(255,255,255,0.42)"
                                            returnKeyType="done"
                                        />
                                    </View>
                                </View>

                                {/* Tarjeta editable de Letras (letras.com + Buscar + LRCLIB + Importar + Editor) */}
                                <View style={styles.lyricsCard}>
                                    <View style={styles.lyricsTopRow}>
                                        <View style={styles.lyricsTitleWrap}>
                                            <FileText size={18} color="#60A5FA" />
                                            <View style={styles.flexOne}>
                                                <Text style={styles.lyricsHeading}>Letras</Text>
                                                <Text style={styles.lyricsStatus} numberOfLines={1}>
                                                    {hasDraftLyrics
                                                        ? parsedDraftLyrics.isSynced
                                                            ? `Sincronizada (.lrc) · ${parsedDraftLyrics.lines.length} líneas`
                                                            : `Letra cargada · ${parsedDraftLyrics.lines.length} líneas`
                                                        : 'Sin letras asociadas'}
                                                </Text>
                                            </View>
                                        </View>

                                        <TouchableOpacity
                                            style={styles.editLyricsChip}
                                            activeOpacity={0.85}
                                            onPress={() => setLyricsModalOpen(true)}
                                        >
                                            <Sparkles size={14} color="#FFFFFF" />
                                            <Text style={styles.editLyricsChipText}>
                                                {hasDraftLyrics ? 'Reemplazar / Editar' : 'Agregar'}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>

                                    {/* Link dinámico www.letras.com/{artista}/ + botón Buscar */}
                                    <View style={styles.letrasRow}>
                                        <View style={styles.letrasUrlBox}>
                                            <Text style={styles.letrasUrlText} numberOfLines={1}>
                                                {letrasInfo.displayUrl}
                                            </Text>
                                        </View>
                                        <TouchableOpacity
                                            style={styles.letrasSearchBtn}
                                            activeOpacity={0.85}
                                            onPress={handleOpenLetrasBrowser}
                                        >
                                            <Search size={14} color="#FFFFFF" />
                                            <Text style={styles.letrasSearchText}>Buscar</Text>
                                            <ExternalLink size={12} color="#BFDBFE" />
                                        </TouchableOpacity>
                                    </View>

                                    {/* Accesos rápidos para importar archivo o abrir editor completo */}
                                    <View style={styles.quickLyricsRow}>
                                        <TouchableOpacity
                                            style={styles.quickBtn}
                                            activeOpacity={0.8}
                                            disabled={importingFile}
                                            onPress={handleQuickImportFile}
                                        >
                                            {importingFile ? (
                                                <ActivityIndicator size="small" color="#93C5FD" />
                                            ) : (
                                                <FileUp size={15} color="#93C5FD" />
                                            )}
                                            <Text style={styles.quickBtnText}>
                                                Importar .lrc / .txt
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={styles.quickBtn}
                                            activeOpacity={0.8}
                                            onPress={() => setLyricsModalOpen(true)}
                                        >
                                            <Pencil size={14} color="#93C5FD" />
                                            <Text style={styles.quickBtnText}>
                                                LRCLIB / Pegar texto
                                            </Text>
                                        </TouchableOpacity>
                                    </View>

                                    {hasDraftLyrics && (
                                        <Text style={styles.lyricsSnippet} numberOfLines={3}>
                                            {parsedDraftLyrics.lines
                                                .slice(0, 3)
                                                .map((l) => l.text)
                                                .join('\n')}
                                        </Text>
                                    )}
                                </View>
                            </ScrollView>
                        </View>
                    </KeyboardAvoidingView>

                    {/* Submodal de edición completa de letras en modo borrador */}
                    <LyricsEditorModal
                        visible={lyricsModalOpen}
                        track={track}
                        initialLyricsText={lyricsText}
                        titleOverride={title}
                        artistOverride={artist}
                        saveDirectly={false}
                        onClose={() => setLyricsModalOpen(false)}
                        onSaved={(rawText) => setLyricsText(rawText ?? '')}
                    />
                </LinearGradient>
            </Modal>
        );
    }
);

const styles = StyleSheet.create({
    gradientRoot: {
        flex: 1,
    },
    darkScrim: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: 'rgba(6, 10, 20, 0.56)',
    },
    flexOne: {
        flex: 1,
    },
    innerContainer: {
        flex: 1,
        paddingHorizontal: 20,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
    },
    headerIconBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.34)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        color: '#FFFFFF',
        fontSize: 17,
        fontWeight: '800',
    },
    saveChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#1E3A8A',
        borderWidth: 1,
        borderColor: '#2B52B8',
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 999,
    },
    saveChipText: {
        color: '#FFFFFF',
        fontSize: 13.5,
        fontWeight: '800',
    },
    scrollContent: {
        paddingBottom: 28,
        gap: 16,
    },
    coverBlock: {
        alignItems: 'center',
        gap: 10,
    },
    coverFrame: {
        borderRadius: 18,
        overflow: 'hidden',
        backgroundColor: '#111827',
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.18)',
        position: 'relative',
    },
    coverImg: {
        width: '100%',
        height: '100%',
    },
    coverPlaceholder: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0F172A',
    },
    coverEditPill: {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        backgroundColor: 'rgba(15, 31, 75, 0.88)',
        borderWidth: 1,
        borderColor: 'rgba(96, 165, 250, 0.45)',
        paddingVertical: 9,
        paddingHorizontal: 12,
        borderRadius: 999,
    },
    coverEditText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '700',
    },
    resetCoverBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: 'rgba(0,0,0,0.34)',
    },
    resetCoverText: {
        color: '#CBD5E1',
        fontSize: 12,
        fontWeight: '600',
    },
    metaCard: {
        backgroundColor: 'rgba(10, 17, 34, 0.78)',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.14)',
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 8,
    },
    fieldGroup: {
        gap: 4,
    },
    fieldLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    fieldLabel: {
        color: '#93C5FD',
        fontSize: 11.5,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    titleInput: {
        color: '#FFFFFF',
        fontSize: 19,
        fontWeight: '800',
        paddingVertical: 4,
    },
    artistInput: {
        color: '#E2E8F0',
        fontSize: 15.5,
        fontWeight: '600',
        paddingVertical: 4,
    },
    divider: {
        height: 1,
        backgroundColor: 'rgba(255,255,255,0.1)',
    },
    lyricsCard: {
        backgroundColor: 'rgba(10, 17, 34, 0.82)',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(59,130,246,0.28)',
        padding: 14,
        gap: 12,
    },
    lyricsTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    lyricsTitleWrap: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    lyricsHeading: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '800',
    },
    lyricsStatus: {
        color: '#93C5FD',
        fontSize: 12,
        marginTop: 1,
    },
    editLyricsChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: '#1E3A8A',
        borderWidth: 1,
        borderColor: '#2B52B8',
        paddingHorizontal: 11,
        paddingVertical: 7,
        borderRadius: 999,
    },
    editLyricsChipText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '700',
    },
    letrasRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    letrasUrlBox: {
        flex: 1,
        backgroundColor: 'rgba(6, 11, 24, 0.85)',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.22)',
        paddingHorizontal: 10,
        paddingVertical: 9,
    },
    letrasUrlText: {
        color: '#93C5FD',
        fontSize: 12,
        fontWeight: '600',
    },
    letrasSearchBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: '#1E3A8A',
        borderWidth: 1,
        borderColor: '#2B52B8',
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 10,
    },
    letrasSearchText: {
        color: '#FFFFFF',
        fontSize: 12.5,
        fontWeight: '800',
    },
    quickLyricsRow: {
        flexDirection: 'row',
        gap: 8,
    },
    quickBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: 'rgba(30,58,138,0.28)',
        borderWidth: 1,
        borderColor: 'rgba(59,130,246,0.32)',
        paddingVertical: 9,
        paddingHorizontal: 8,
        borderRadius: 10,
    },
    quickBtnText: {
        color: '#E2E8F0',
        fontSize: 12,
        fontWeight: '700',
    },
    lyricsSnippet: {
        color: 'rgba(226,232,240,0.72)',
        fontSize: 12.5,
        lineHeight: 18,
        backgroundColor: 'rgba(6,11,24,0.55)',
        borderRadius: 10,
        padding: 10,
    },
});
