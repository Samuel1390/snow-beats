import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useColorScheme,
    useWindowDimensions,
    View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
    Check,
    ClipboardPaste,
    Copy,
    ExternalLink,
    FileText,
    FileUp,
    ImagePlus,
    Link2,
    Music,
    Pencil,
    RotateCcw,
    Search,
    Sparkles,
    X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    copyImageToClipboard,
    persistCoverImage,
    pickLyricsFile,
    readClipboardImage,
} from '../../../modules/snow-metadata';
import {
    buildLetrasComUrl,
    ParsedLyrics,
    parseLyricsText,
    setCachedTrackLyrics,
} from '../../audio-engine/lyricsParser';
import { saveEditedTrackData } from '../../storage/database/db';
import { resolveIsDarkMode, useTheme } from '../../theme/ThemeContext';
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
    backHandlerRef?: React.MutableRefObject<(() => boolean) | null>;
    onClose: () => void;
    onSaved: (result: EditedTrackResult) => void;
}

interface NeutralPalette {
    rootBg: string;
    cardBg: string;
    inputBg: string;
    border: string;
    strongBorder: string;
    divider: string;
    text: string;
    muted: string;
    primaryBg: string;
    primaryText: string;
    secondaryBg: string;
    secondaryText: string;
    pillBg: string;
    pillText: string;
}

function getNeutralPalette(isDark: boolean): NeutralPalette {
    if (isDark) {
        return {
            rootBg: '#000000',
            cardBg: '#121212',
            inputBg: '#1C1C1C',
            border: '#2B2B2B',
            strongBorder: '#3F3F46',
            divider: '#262626',
            text: '#FFFFFF',
            muted: '#A1A1AA',
            primaryBg: '#FFFFFF',
            primaryText: '#000000',
            secondaryBg: '#1C1C1C',
            secondaryText: '#FFFFFF',
            pillBg: '#262626',
            pillText: '#E4E4E7',
        };
    }
    return {
        rootBg: '#FFFFFF',
        cardBg: '#F4F4F5',
        inputBg: '#FFFFFF',
        border: '#D4D4D8',
        strongBorder: '#A1A1AA',
        divider: '#E4E4E7',
        text: '#000000',
        muted: '#52525B',
        primaryBg: '#000000',
        primaryText: '#FFFFFF',
        secondaryBg: '#FFFFFF',
        secondaryText: '#000000',
        pillBg: '#E4E4E7',
        pillText: '#18181B',
    };
}

// Carta editable espejo de la SongCard en tema neutro (overlay sin Modal nativo anidado)
const EditTrackContent: React.FC<Omit<EditTrackModalProps, 'visible'>> = React.memo(
    ({ track, initialLyrics, backHandlerRef, onClose, onSaved }) => {
        const insets = useSafeAreaInsets();
        const { width: screenWidth } = useWindowDimensions();
        const { theme } = useTheme();
        const systemScheme = useColorScheme();
        const isDark = resolveIsDarkMode(theme.mode, systemScheme);
        const ui = useMemo(() => getNeutralPalette(isDark), [isDark]);

        const [title, setTitle] = useState(track.title);
        const [artist, setArtist] = useState(track.artist);
        const [coverUri, setCoverUri] = useState<string | null>(track.artworkUri);
        const [coverChanged, setCoverChanged] = useState(false);
        const [coverNotice, setCoverNotice] = useState<string | null>(null);
        const [manualUrlOpen, setManualUrlOpen] = useState(false);
        const [manualImageUrl, setManualImageUrl] = useState('');
        const [dominantColor, setDominantColor] = useState<string | null>(
            track.dominantColor ?? null
        );
        const [lyricsText, setLyricsText] = useState(initialLyrics?.rawText ?? '');
        const [lyricsModalOpen, setLyricsModalOpen] = useState(false);
        const [saving, setSaving] = useState(false);
        const [importingFile, setImportingFile] = useState(false);
        const [pastingImage, setPastingImage] = useState(false);

        // Solo reinicia los campos si la canción activa cambia de ID mientras el editor está montado
        const lastTrackIdRef = useRef(track.id);
        useEffect(() => {
            if (lastTrackIdRef.current !== track.id) {
                lastTrackIdRef.current = track.id;
                setTitle(track.title);
                setArtist(track.artist);
                setCoverUri(track.artworkUri);
                setCoverChanged(false);
                setCoverNotice(null);
                setManualUrlOpen(false);
                setManualImageUrl('');
                setDominantColor(track.dominantColor ?? null);
                setLyricsText(initialLyrics?.rawText ?? '');
                setLyricsModalOpen(false);
            }
        }, [
            track.id,
            track.title,
            track.artist,
            track.artworkUri,
            track.dominantColor,
            initialLyrics?.rawText,
        ]);

        // Permite que el botón físico Atrás cierre primero el sub-editor de letras antes que esta carta
        useEffect(() => {
            if (!backHandlerRef) return;
            backHandlerRef.current = () => {
                if (lyricsModalOpen) {
                    setLyricsModalOpen(false);
                    return true;
                }
                return false;
            };
            return () => {
                backHandlerRef.current = null;
            };
        }, [backHandlerRef, lyricsModalOpen]);

        const parsedDraftLyrics = useMemo(() => parseLyricsText(lyricsText), [lyricsText]);
        const hasDraftLyrics = parsedDraftLyrics.lines.length > 0;
        const letrasInfo = useMemo(() => buildLetrasComUrl(artist, title), [artist, title]);

        const coverSide = Math.min(screenWidth - 76, 256);

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
                setCoverNotice('Carátula recortada desde galería (1:1).');
            } catch {
                Alert.alert('Error', 'No se pudo abrir la galería de imágenes.');
            }
        }, []);

        // Pega una imagen o enlace de imagen copiado en el portapapeles
        const handlePasteCover = useCallback(async () => {
            setPastingImage(true);
            try {
                if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
                    const text = (await navigator.clipboard.readText()).trim();
                    if (
                        text.startsWith('http://') ||
                        text.startsWith('https://') ||
                        text.startsWith('data:image/')
                    ) {
                        setCoverUri(text);
                        setCoverChanged(true);
                        setCoverNotice('Imagen pegada desde el portapapeles.');
                        return;
                    }
                    Alert.alert(
                        'Portapapeles sin imagen',
                        'Copia una URL de imagen válida o pégala manualmente en el campo de enlace.'
                    );
                    return;
                }

                const res = await readClipboardImage();
                if (!res.ok || !res.uri) {
                    Alert.alert(
                        'No se encontró imagen',
                        res.errorMessage ||
                            'Copia una imagen o un enlace de imagen válido antes de pulsar Pegar.'
                    );
                    return;
                }
                setCoverUri(res.uri);
                setCoverChanged(true);
                setCoverNotice(
                    res.source === 'clipboard_image'
                        ? 'Imagen pegada desde el portapapeles (se ajustará a 1:1 al guardar).'
                        : 'Enlace de imagen pegado (se descargará y ajustará a 1:1 al guardar).'
                );
            } catch {
                Alert.alert('Error', 'No se pudo leer la imagen del portapapeles.');
            } finally {
                setPastingImage(false);
            }
        }, []);

        // Copia la carátula actual al portapapeles para poder pegarla en otra canción
        const handleCopyCover = useCallback(async () => {
            if (!coverUri) {
                Alert.alert('Sin carátula', 'Esta canción no tiene carátula para copiar.');
                return;
            }
            try {
                if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
                    await navigator.clipboard.writeText(coverUri);
                    setCoverNotice('Enlace de carátula copiado al portapapeles.');
                    return;
                }
                const copied = await copyImageToClipboard(coverUri);
                if (copied) {
                    setCoverNotice('Carátula copiada al portapapeles.');
                } else {
                    Alert.alert('Error', 'No se pudo copiar la carátula al portapapeles.');
                }
            } catch {
                Alert.alert('Error', 'No se pudo copiar la carátula.');
            }
        }, [coverUri]);

        // Aplica una URL o ruta pegada manualmente en el campo de texto
        const handleApplyManualImageUrl = useCallback(() => {
            const clean = manualImageUrl.trim();
            if (
                !clean.startsWith('http://') &&
                !clean.startsWith('https://') &&
                !clean.startsWith('data:image/') &&
                !clean.startsWith('file://') &&
                !clean.startsWith('content://')
            ) {
                Alert.alert(
                    'Enlace no válido',
                    'Ingresa o pega una URL válida (https://..., data:image/..., file://...).'
                );
                return;
            }
            setCoverUri(clean);
            setCoverChanged(true);
            setManualUrlOpen(false);
            setCoverNotice('Imagen manual cargada (se recortará a 1:1 al guardar).');
        }, [manualImageUrl]);

        const handleResetCover = useCallback(() => {
            setCoverUri(track.artworkUri);
            setCoverChanged(false);
            setCoverNotice(null);
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
                    } else if (
                        coverUri.startsWith('http://') ||
                        coverUri.startsWith('https://') ||
                        coverUri.startsWith('data:image/')
                    ) {
                        Alert.alert(
                            'Imagen no válida',
                            'No se pudo descargar o decodificar la imagen pegada. Verifica el enlace o elige otra imagen.'
                        );
                        setSaving(false);
                        return;
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
            <View style={[styles.overlayRoot, { backgroundColor: ui.rootBg }]}>
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
                        {/* Barra superior neutra monocromática */}
                        <View style={styles.topBar}>
                            <TouchableOpacity
                                style={[
                                    styles.headerIconBtn,
                                    { backgroundColor: ui.cardBg, borderColor: ui.border },
                                ]}
                                onPress={onClose}
                            >
                                <X size={21} color={ui.text} />
                            </TouchableOpacity>
                            <Text style={[styles.headerTitle, { color: ui.text }]}>
                                Editar datos
                            </Text>
                            <TouchableOpacity
                                style={[
                                    styles.saveChip,
                                    { backgroundColor: ui.primaryBg },
                                    saving && { opacity: 0.65 },
                                ]}
                                disabled={saving}
                                activeOpacity={0.85}
                                onPress={handleSaveAll}
                            >
                                {saving ? (
                                    <ActivityIndicator size="small" color={ui.primaryText} />
                                ) : (
                                    <>
                                        <Check size={16} color={ui.primaryText} />
                                        <Text style={[styles.saveChipText, { color: ui.primaryText }]}>
                                            Guardar
                                        </Text>
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
                            {/* Carta de Carátula 1:1 con Galería, Copiar, Pegar imagen y URL manual */}
                            <View
                                style={[
                                    styles.sectionCard,
                                    { backgroundColor: ui.cardBg, borderColor: ui.border },
                                ]}
                            >
                                <View style={styles.coverBlock}>
                                    <TouchableOpacity
                                        style={[
                                            styles.coverFrame,
                                            {
                                                width: coverSide,
                                                height: coverSide,
                                                backgroundColor: ui.inputBg,
                                                borderColor: ui.strongBorder,
                                            },
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
                                            <View
                                                style={[
                                                    styles.coverPlaceholder,
                                                    { backgroundColor: ui.inputBg },
                                                ]}
                                            >
                                                <Music size={68} color={ui.muted} />
                                            </View>
                                        )}
                                        <View
                                            style={[
                                                styles.coverEditPill,
                                                { backgroundColor: ui.primaryBg },
                                            ]}
                                        >
                                            <ImagePlus size={15} color={ui.primaryText} />
                                            <Text
                                                style={[
                                                    styles.coverEditText,
                                                    { color: ui.primaryText },
                                                ]}
                                            >
                                                Galería (recorte 1:1)
                                            </Text>
                                        </View>
                                    </TouchableOpacity>

                                    {/* Controles manuales para copiar y pegar imagen */}
                                    <View style={styles.coverActionsRow}>
                                        <TouchableOpacity
                                            style={[
                                                styles.coverToolBtn,
                                                {
                                                    backgroundColor: ui.secondaryBg,
                                                    borderColor: ui.border,
                                                },
                                            ]}
                                            activeOpacity={0.82}
                                            disabled={pastingImage}
                                            onPress={handlePasteCover}
                                        >
                                            {pastingImage ? (
                                                <ActivityIndicator size="small" color={ui.text} />
                                            ) : (
                                                <ClipboardPaste size={14} color={ui.secondaryText} />
                                            )}
                                            <Text
                                                style={[
                                                    styles.coverToolBtnText,
                                                    { color: ui.secondaryText },
                                                ]}
                                            >
                                                Pegar imagen
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={[
                                                styles.coverToolBtn,
                                                {
                                                    backgroundColor: ui.secondaryBg,
                                                    borderColor: ui.border,
                                                },
                                                !coverUri && { opacity: 0.45 },
                                            ]}
                                            activeOpacity={0.82}
                                            disabled={!coverUri}
                                            onPress={handleCopyCover}
                                        >
                                            <Copy size={14} color={ui.secondaryText} />
                                            <Text
                                                style={[
                                                    styles.coverToolBtnText,
                                                    { color: ui.secondaryText },
                                                ]}
                                            >
                                                Copiar
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={[
                                                styles.coverToolBtn,
                                                {
                                                    backgroundColor: manualUrlOpen
                                                        ? ui.primaryBg
                                                        : ui.secondaryBg,
                                                    borderColor: manualUrlOpen
                                                        ? ui.primaryBg
                                                        : ui.border,
                                                },
                                            ]}
                                            activeOpacity={0.82}
                                            onPress={() => setManualUrlOpen((prev) => !prev)}
                                        >
                                            <Link2
                                                size={14}
                                                color={
                                                    manualUrlOpen
                                                        ? ui.primaryText
                                                        : ui.secondaryText
                                                }
                                            />
                                            <Text
                                                style={[
                                                    styles.coverToolBtnText,
                                                    {
                                                        color: manualUrlOpen
                                                            ? ui.primaryText
                                                            : ui.secondaryText,
                                                    },
                                                ]}
                                            >
                                                Pegar URL
                                            </Text>
                                        </TouchableOpacity>
                                    </View>

                                    {/* Campo manual para pegar enlace de imagen */}
                                    {manualUrlOpen && (
                                        <View style={styles.manualUrlRow}>
                                            <TextInput
                                                style={[
                                                    styles.manualUrlInput,
                                                    {
                                                        backgroundColor: ui.inputBg,
                                                        borderColor: ui.border,
                                                        color: ui.text,
                                                    },
                                                ]}
                                                value={manualImageUrl}
                                                onChangeText={setManualImageUrl}
                                                placeholder="https://... o data:image/..."
                                                placeholderTextColor={ui.muted}
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                                returnKeyType="done"
                                                onSubmitEditing={handleApplyManualImageUrl}
                                            />
                                            <TouchableOpacity
                                                style={[
                                                    styles.applyUrlBtn,
                                                    { backgroundColor: ui.primaryBg },
                                                ]}
                                                activeOpacity={0.85}
                                                onPress={handleApplyManualImageUrl}
                                            >
                                                <Text
                                                    style={[
                                                        styles.applyUrlText,
                                                        { color: ui.primaryText },
                                                    ]}
                                                >
                                                    Aplicar
                                                </Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}

                                    {coverNotice && (
                                        <Text style={[styles.coverNoticeText, { color: ui.muted }]}>
                                            {coverNotice}
                                        </Text>
                                    )}

                                    {coverChanged && (
                                        <TouchableOpacity
                                            style={[
                                                styles.resetCoverBtn,
                                                { backgroundColor: ui.pillBg, borderColor: ui.border },
                                            ]}
                                            onPress={handleResetCover}
                                        >
                                            <RotateCcw size={13} color={ui.pillText} />
                                            <Text
                                                style={[styles.resetCoverText, { color: ui.pillText }]}
                                            >
                                                Restaurar carátula original
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>

                            {/* Campos editables de Título y Artista */}
                            <View
                                style={[
                                    styles.metaCard,
                                    { backgroundColor: ui.cardBg, borderColor: ui.border },
                                ]}
                            >
                                <View style={styles.fieldGroup}>
                                    <View style={styles.fieldLabelRow}>
                                        <Pencil size={13} color={ui.muted} />
                                        <Text style={[styles.fieldLabel, { color: ui.muted }]}>
                                            Título
                                        </Text>
                                    </View>
                                    <TextInput
                                        style={[styles.titleInput, { color: ui.text }]}
                                        value={title}
                                        onChangeText={setTitle}
                                        placeholder="Título de la canción"
                                        placeholderTextColor={ui.muted}
                                        returnKeyType="next"
                                    />
                                </View>

                                <View style={[styles.divider, { backgroundColor: ui.divider }]} />

                                <View style={styles.fieldGroup}>
                                    <View style={styles.fieldLabelRow}>
                                        <Pencil size={13} color={ui.muted} />
                                        <Text style={[styles.fieldLabel, { color: ui.muted }]}>
                                            Artista
                                        </Text>
                                    </View>
                                    <TextInput
                                        style={[styles.artistInput, { color: ui.text }]}
                                        value={artist}
                                        onChangeText={setArtist}
                                        placeholder="Nombre del artista"
                                        placeholderTextColor={ui.muted}
                                        returnKeyType="done"
                                    />
                                </View>
                            </View>

                            {/* Tarjeta editable de Letras (https://www.letras.com/{artista}/{titulo}/ + Buscar + LRCLIB + Importar + Editor) */}
                            <View
                                style={[
                                    styles.lyricsCard,
                                    { backgroundColor: ui.cardBg, borderColor: ui.border },
                                ]}
                            >
                                <View style={styles.lyricsTopRow}>
                                    <View style={styles.lyricsTitleWrap}>
                                        <FileText size={18} color={ui.text} />
                                        <View style={styles.flexOne}>
                                            <Text style={[styles.lyricsHeading, { color: ui.text }]}>
                                                Letras
                                            </Text>
                                            <Text
                                                style={[styles.lyricsStatus, { color: ui.muted }]}
                                                numberOfLines={1}
                                            >
                                                {hasDraftLyrics
                                                    ? parsedDraftLyrics.isSynced
                                                        ? `Sincronizada (.lrc) · ${parsedDraftLyrics.lines.length} líneas`
                                                        : `Manual sin resaltado · ${parsedDraftLyrics.lines.length} líneas`
                                                    : 'Sin letras asociadas'}
                                            </Text>
                                        </View>
                                    </View>

                                    <TouchableOpacity
                                        style={[
                                            styles.editLyricsChip,
                                            { backgroundColor: ui.primaryBg },
                                        ]}
                                        activeOpacity={0.85}
                                        onPress={() => setLyricsModalOpen(true)}
                                    >
                                        <Sparkles size={14} color={ui.primaryText} />
                                        <Text
                                            style={[
                                                styles.editLyricsChipText,
                                                { color: ui.primaryText },
                                            ]}
                                        >
                                            {hasDraftLyrics ? 'Editar' : 'Agregar'}
                                        </Text>
                                    </TouchableOpacity>
                                </View>

                                {/* Enlace directo https://www.letras.com/{artista}/{titulo}/ + botón Buscar */}
                                <View style={styles.letrasRow}>
                                    <View
                                        style={[
                                            styles.letrasUrlBox,
                                            { backgroundColor: ui.inputBg, borderColor: ui.border },
                                        ]}
                                    >
                                        <Text
                                            style={[styles.letrasUrlText, { color: ui.text }]}
                                            numberOfLines={1}
                                        >
                                            {letrasInfo.displayUrl}
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        style={[
                                            styles.letrasSearchBtn,
                                            { backgroundColor: ui.primaryBg },
                                        ]}
                                        activeOpacity={0.85}
                                        onPress={handleOpenLetrasBrowser}
                                    >
                                        <Search size={14} color={ui.primaryText} />
                                        <Text
                                            style={[
                                                styles.letrasSearchText,
                                                { color: ui.primaryText },
                                            ]}
                                        >
                                            Buscar
                                        </Text>
                                        <ExternalLink size={12} color={ui.primaryText} />
                                    </TouchableOpacity>
                                </View>

                                {/* Accesos rápidos */}
                                <View style={styles.quickLyricsRow}>
                                    <TouchableOpacity
                                        style={[
                                            styles.quickBtn,
                                            {
                                                backgroundColor: ui.secondaryBg,
                                                borderColor: ui.border,
                                            },
                                        ]}
                                        activeOpacity={0.8}
                                        disabled={importingFile}
                                        onPress={handleQuickImportFile}
                                    >
                                        {importingFile ? (
                                            <ActivityIndicator size="small" color={ui.text} />
                                        ) : (
                                            <FileUp size={15} color={ui.secondaryText} />
                                        )}
                                        <Text
                                            style={[
                                                styles.quickBtnText,
                                                { color: ui.secondaryText },
                                            ]}
                                        >
                                            Importar .lrc / .txt
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[
                                            styles.quickBtn,
                                            {
                                                backgroundColor: ui.secondaryBg,
                                                borderColor: ui.border,
                                            },
                                        ]}
                                        activeOpacity={0.8}
                                        onPress={() => setLyricsModalOpen(true)}
                                    >
                                        <Pencil size={14} color={ui.secondaryText} />
                                        <Text
                                            style={[
                                                styles.quickBtnText,
                                                { color: ui.secondaryText },
                                            ]}
                                        >
                                            LRCLIB / Pegar texto
                                        </Text>
                                    </TouchableOpacity>
                                </View>

                                {hasDraftLyrics && (
                                    <Text
                                        style={[
                                            styles.lyricsSnippet,
                                            {
                                                backgroundColor: ui.inputBg,
                                                borderColor: ui.border,
                                                color: ui.muted,
                                            },
                                        ]}
                                        numberOfLines={3}
                                    >
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

                {/* Sub-overlay de edición completa de letras en modo borrador (sin Modal anidado) */}
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
            </View>
        );
    }
);

export const EditTrackModal: React.FC<EditTrackModalProps> = React.memo(({ visible, ...rest }) => {
    // Desmonta completamente al cerrarse para garantizar un estado limpio al volver a abrir
    if (!visible) return null;
    return <EditTrackContent {...rest} />;
});

const styles = StyleSheet.create({
    overlayRoot: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 45,
        elevation: 24,
    },
    flexOne: {
        flex: 1,
    },
    innerContainer: {
        flex: 1,
        paddingHorizontal: 18,
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
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '800',
    },
    saveChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 999,
    },
    saveChipText: {
        fontSize: 13.5,
        fontWeight: '800',
    },
    scrollContent: {
        paddingBottom: 28,
        gap: 14,
    },
    sectionCard: {
        borderRadius: 18,
        borderWidth: 1,
        padding: 14,
    },
    coverBlock: {
        alignItems: 'center',
        gap: 11,
    },
    coverFrame: {
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
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
        paddingVertical: 9,
        paddingHorizontal: 12,
        borderRadius: 999,
    },
    coverEditText: {
        fontSize: 12.5,
        fontWeight: '800',
    },
    coverActionsRow: {
        width: '100%',
        flexDirection: 'row',
        gap: 8,
    },
    coverToolBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        borderWidth: 1,
        borderRadius: 10,
        paddingVertical: 9,
        paddingHorizontal: 6,
    },
    coverToolBtnText: {
        fontSize: 12,
        fontWeight: '700',
    },
    manualUrlRow: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    manualUrlInput: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 11,
        paddingVertical: 9,
        fontSize: 12.5,
    },
    applyUrlBtn: {
        paddingHorizontal: 13,
        paddingVertical: 10,
        borderRadius: 10,
    },
    applyUrlText: {
        fontSize: 12.5,
        fontWeight: '800',
    },
    coverNoticeText: {
        fontSize: 12,
        textAlign: 'center',
    },
    resetCoverBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
    },
    resetCoverText: {
        fontSize: 12,
        fontWeight: '600',
    },
    metaCard: {
        borderRadius: 18,
        borderWidth: 1,
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
        fontSize: 11.5,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    titleInput: {
        fontSize: 18.5,
        fontWeight: '800',
        paddingVertical: 4,
    },
    artistInput: {
        fontSize: 15.5,
        fontWeight: '600',
        paddingVertical: 4,
    },
    divider: {
        height: 1,
    },
    lyricsCard: {
        borderRadius: 18,
        borderWidth: 1,
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
        fontSize: 15,
        fontWeight: '800',
    },
    lyricsStatus: {
        fontSize: 12,
        marginTop: 1,
    },
    editLyricsChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
    },
    editLyricsChipText: {
        fontSize: 12,
        fontWeight: '800',
    },
    letrasRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    letrasUrlBox: {
        flex: 1,
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 9,
    },
    letrasUrlText: {
        fontSize: 12,
        fontWeight: '600',
    },
    letrasSearchBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 10,
    },
    letrasSearchText: {
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
        borderWidth: 1,
        paddingVertical: 9,
        paddingHorizontal: 8,
        borderRadius: 10,
    },
    quickBtnText: {
        fontSize: 12,
        fontWeight: '700',
    },
    lyricsSnippet: {
        fontSize: 12.5,
        lineHeight: 18,
        borderRadius: 10,
        borderWidth: 1,
        padding: 10,
    },
});
