import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Platform,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    ArrowLeft,
    ChevronDown,
    Image as ImageIcon,
    Music,
    Palette,
    Pencil,
    Share2,
    Sparkles,
    Trash2,
    Type,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ParsedLyrics } from '../../audio-engine/lyricsParser';
import { getAdaptiveCardInk, getDynamicPlayerPalette } from '../../theme/colorContrast';
import { Track } from '../../types/music';
import { renderShareCard, RenderShareCardOptions } from '../../../modules/snow-metadata';

const LOGO_ASSET = require('../../../assets/images/logo.png');
const MAX_SELECTED_LINES = 6;

type ShareStep = 'select_lyrics' | 'preview' | 'customize';
type CardMode = 'song' | 'lyrics';
type FontVariant = 'classic' | 'wide' | 'narrow' | 'italic';
type AlignVariant = 'left' | 'center' | 'right';
type CustomizerTab = 'color' | 'image' | 'text';

interface ColorPreset {
    id: string;
    top: string;
    bottom: string;
    swatch: string;
}

interface ShareCardModalProps {
    visible: boolean;
    track: Track;
    lyrics: ParsedLyrics | null;
    initialMode?: CardMode;
    initialStep?: ShareStep;
    initialLineIndex?: number;
    onClose: () => void;
}

export const ShareCardModal: React.FC<ShareCardModalProps> = React.memo(
    ({
        visible,
        track,
        lyrics,
        initialMode = 'song',
        initialStep = 'preview',
        initialLineIndex = 0,
        onClose,
    }) => {
        const insets = useSafeAreaInsets();
        const hasLyrics = Boolean(lyrics && lyrics.lines.length > 0);

        const dynamicPalette = useMemo(
            () => getDynamicPlayerPalette(track.dominantColor),
            [track.dominantColor]
        );

        // Paletas curadas con contraste WCAG automático (incluye tonos dinámicos de la carátula + neutro + claro)
        const colorPresets = useMemo<ColorPreset[]>(
            () => [
                {
                    id: 'dominant_grad',
                    top: dynamicPalette.background,
                    bottom: dynamicPalette.backgroundBottom,
                    swatch: dynamicPalette.background,
                },
                {
                    id: 'dominant_solid',
                    top: dynamicPalette.background,
                    bottom: dynamicPalette.background,
                    swatch: dynamicPalette.backgroundBottom,
                },
                {
                    id: 'obsidian',
                    top: '#1C1C22',
                    bottom: '#0B0B0F',
                    swatch: '#141418',
                },
                {
                    id: 'ocean',
                    top: '#123652',
                    bottom: '#091A2A',
                    swatch: '#16466B',
                },
                {
                    id: 'crimson',
                    top: '#4F1422',
                    bottom: '#1E080E',
                    swatch: '#61192A',
                },
                {
                    id: 'cream',
                    top: '#F3EFE6',
                    bottom: '#E2DACB',
                    swatch: '#EFE9DD',
                },
            ],
            [dynamicPalette]
        );

        const [step, setStep] = useState<ShareStep>(initialStep);
        const [cardMode, setCardMode] = useState<CardMode>(hasLyrics ? initialMode : 'song');
        const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
        const [presetIndex, setPresetIndex] = useState(0);
        const [bgImageUri, setBgImageUri] = useState<string | null>(null);
        const [fontStyle, setFontStyle] = useState<FontVariant>('classic');
        const [textAlign, setTextAlign] = useState<AlignVariant>('left');
        const [uppercase, setUppercase] = useState(false);
        const [customizerTab, setCustomizerTab] = useState<CustomizerTab>('color');
        const [exporting, setExporting] = useState(false);

        // Inicializa selección por defecto (hasta 4 líneas a partir de la línea actual) al abrir
        useEffect(() => {
            if (!visible) return;
            const nextMode: CardMode = hasLyrics ? initialMode : 'song';
            setCardMode(nextMode);
            setStep(hasLyrics && initialStep === 'select_lyrics' ? 'select_lyrics' : 'preview');
            setPresetIndex(0);
            setBgImageUri(null);
            setFontStyle('classic');
            setTextAlign('left');
            setUppercase(false);
            setCustomizerTab('color');

            if (lyrics && lyrics.lines.length > 0) {
                const start = Math.max(0, Math.min(initialLineIndex, lyrics.lines.length - 1));
                const end = Math.min(lyrics.lines.length, start + 4);
                const defaults: number[] = [];
                for (let i = start; i < end; i++) defaults.push(i);
                setSelectedIndices(defaults);
            } else {
                setSelectedIndices([]);
            }
        }, [visible, hasLyrics, initialMode, initialStep, initialLineIndex, lyrics]);

        const currentPreset = colorPresets[presetIndex] ?? colorPresets[0];

        // Cuando hay foto de fondo, siempre usamos texto blanco sobre scrim oscuro doble
        const cardInk = useMemo(() => {
            if (bgImageUri) {
                return {
                    primaryText: '#FFFFFF',
                    secondaryText: 'rgba(255, 255, 255, 0.84)',
                    isDarkSurface: true,
                };
            }
            return getAdaptiveCardInk(currentPreset.top);
        }, [bgImageUri, currentPreset.top]);

        const selectedLines = useMemo(() => {
            if (!lyrics) return [];
            return [...selectedIndices]
                .sort((a, b) => a - b)
                .map((idx) => lyrics.lines[idx]?.text)
                .filter((t): t is string => Boolean(t));
        }, [lyrics, selectedIndices]);

        // Alterna una línea respetando límite de 6 líneas seleccionadas
        const toggleLineSelection = useCallback((idx: number) => {
            setSelectedIndices((prev) => {
                if (prev.includes(idx)) {
                    if (prev.length <= 1) return prev; // Siempre mantiene al menos 1 línea
                    return prev.filter((i) => i !== idx);
                }
                if (prev.length >= MAX_SELECTED_LINES) {
                    return [...prev.slice(1), idx].sort((a, b) => a - b);
                }
                return [...prev, idx].sort((a, b) => a - b);
            });
        }, []);

        const handlePickBgImage = useCallback(async () => {
            try {
                const res = await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ['images'],
                    allowsEditing: true,
                    quality: 0.85,
                });
                if (!res.canceled && res.assets?.[0]?.uri) {
                    setBgImageUri(res.assets[0].uri);
                }
            } catch {
                Alert.alert('Imagen', 'No se pudo abrir la galería de imágenes.');
            }
        }, []);

        const cycleAlign = useCallback(() => {
            setTextAlign((prev) => (prev === 'left' ? 'center' : prev === 'center' ? 'right' : 'left'));
        }, []);

        // Renderiza PNG de alta resolución en Kotlin y abre la hoja nativa de compartir de Android
        const handleShareCardImage = useCallback(async () => {
            if (exporting) return;
            setExporting(true);
            try {
                const resolvedLogo = Image.resolveAssetSource(LOGO_ASSET)?.uri ?? null;
                const options: RenderShareCardOptions = {
                    mode: cardMode,
                    title: track.title,
                    artist: track.artist,
                    artworkUri: track.artworkUri,
                    logoUri: resolvedLogo,
                    bgImageUri,
                    bgColor: currentPreset.top,
                    bgColorBottom: currentPreset.bottom,
                    textColor: cardInk.primaryText,
                    mutedColor: cardInk.isDarkSurface ? '#D4D4D8' : '#3F3F46',
                    fontStyle,
                    textAlign,
                    uppercase,
                    lines: selectedLines,
                };

                if (Platform.OS !== 'web') {
                    const pngUri = await renderShareCard(options);
                    if (pngUri && (await Sharing.isAvailableAsync())) {
                        await Sharing.shareAsync(pngUri, {
                            mimeType: 'image/png',
                            dialogTitle: `Compartir ${track.title}`,
                        });
                        return;
                    }
                }

                // Fallback limpio si el módulo nativo aún no ha sido recompilado o en web
                const body =
                    cardMode === 'lyrics' && selectedLines.length > 0
                        ? `"${selectedLines.join('\n')}"\n\n— ${track.title} · ${track.artist} (Snow Beats)`
                        : `${track.title} — ${track.artist} · Escuchando en Snow Beats`;
                await Share.share({ message: body });
            } catch {
                Alert.alert('Compartir', 'No se pudo generar la tarjeta para compartir.');
            } finally {
                setExporting(false);
            }
        }, [
            exporting,
            cardMode,
            track,
            bgImageUri,
            currentPreset,
            cardInk,
            fontStyle,
            textAlign,
            uppercase,
            selectedLines,
        ]);

        const handleShareText = useCallback(async () => {
            const body =
                cardMode === 'lyrics' && selectedLines.length > 0
                    ? `"${selectedLines.join('\n')}"\n\n— ${track.title} · ${track.artist} (Snow Beats)`
                    : `${track.title} — ${track.artist} · Snow Beats`;
            try {
                await Share.share({ message: body });
            } catch { }
        }, [cardMode, selectedLines, track]);

        const lyricTypographyStyle = useMemo(() => {
            switch (fontStyle) {
                case 'wide':
                    return { letterSpacing: 1.2, fontWeight: '700' as const, fontStyle: 'normal' as const };
                case 'narrow':
                    return { letterSpacing: -0.6, fontWeight: '700' as const, fontStyle: 'normal' as const };
                case 'italic':
                    return {
                        letterSpacing: 0.1,
                        fontWeight: '700' as const,
                        fontStyle: 'italic' as const,
                    };
                case 'classic':
                default:
                    return { letterSpacing: 0, fontWeight: '800' as const, fontStyle: 'normal' as const };
            }
        }, [fontStyle]);

        if (!visible) return null;

        const minSel = selectedIndices.length > 0 ? Math.min(...selectedIndices) : -1;
        const maxSel = selectedIndices.length > 0 ? Math.max(...selectedIndices) : -1;

        // Tarjeta visual reutilizada en Preview y Personalizador
        const renderLiveCard = () => (
            <View style={styles.cardShadowWrap}>
                <View style={[styles.cardFrame, cardMode === 'song' && styles.songCardFrame]}>
                    {bgImageUri ? (
                        <>
                            <Image source={{ uri: bgImageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                            {/* Scrim protector doble para contraste garantizado sobre cualquier foto */}
                            <LinearGradient
                                colors={['rgba(0,0,0,0.42)', 'rgba(0,0,0,0.56)', 'rgba(0,0,0,0.74)']}
                                style={StyleSheet.absoluteFill}
                            />
                        </>
                    ) : (
                        <LinearGradient
                            colors={[currentPreset.top, currentPreset.bottom]}
                            style={StyleSheet.absoluteFill}
                        />
                    )}

                    {cardMode === 'song' ? (
                        <View style={styles.songCardInner}>
                            <View style={styles.songCardArtBox}>
                                {track.artworkUri ? (
                                    <Image source={{ uri: track.artworkUri }} style={styles.fillImg} />
                                ) : (
                                    <Music size={64} color="#71717A" />
                                )}
                            </View>
                            <Text style={[styles.songCardTitle, { color: cardInk.primaryText }]} numberOfLines={2}>
                                {track.title}
                            </Text>
                            <Text style={[styles.songCardArtist, { color: cardInk.secondaryText }]} numberOfLines={1}>
                                {track.artist}
                            </Text>
                            <View style={styles.brandFooter}>
                                <Image source={LOGO_ASSET} style={styles.brandLogo} />
                                <Text style={[styles.brandName, { color: cardInk.primaryText }]}>Snow Beats</Text>
                            </View>
                        </View>
                    ) : (
                        <View style={styles.lyricsCardInner}>
                            <View style={styles.lyricsCardHeader}>
                                <View style={styles.miniArtBox}>
                                    {track.artworkUri ? (
                                        <Image source={{ uri: track.artworkUri }} style={styles.fillImg} />
                                    ) : (
                                        <Music size={20} color="#71717A" />
                                    )}
                                </View>
                                <View style={{ flex: 1, marginLeft: 10 }}>
                                    <Text
                                        style={[styles.miniTitle, { color: cardInk.primaryText }]}
                                        numberOfLines={1}
                                    >
                                        {track.title}
                                    </Text>
                                    <Text
                                        style={[styles.miniArtist, { color: cardInk.secondaryText }]}
                                        numberOfLines={1}
                                    >
                                        Canción · {track.artist}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.lyricsCardBody}>
                                {selectedLines.map((line, i) => (
                                    <Text
                                        key={`${i}-${line}`}
                                        style={[
                                            styles.cardLyricLine,
                                            lyricTypographyStyle,
                                            {
                                                color: cardInk.primaryText,
                                                textAlign,
                                            },
                                            bgImageUri ? styles.textShadowOverPhoto : null,
                                        ]}
                                    >
                                        {uppercase ? line.toUpperCase() : line}
                                    </Text>
                                ))}
                            </View>

                            <View style={styles.brandFooter}>
                                <Image source={LOGO_ASSET} style={styles.brandLogo} />
                                <Text style={[styles.brandName, { color: cardInk.primaryText }]}>Snow Beats</Text>
                            </View>
                        </View>
                    )}
                </View>
            </View>
        );

        const AlignIcon =
            textAlign === 'center' ? AlignCenter : textAlign === 'right' ? AlignRight : AlignLeft;

        return (
            <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
                <View
                    style={[
                        styles.screen,
                        {
                            paddingTop: Math.max(insets.top, 26) + 6,
                            paddingBottom: Math.max(insets.bottom, 16) + 10,
                        },
                    ]}
                >
                    {/* PASO 1: Seleccionar líneas de la letra (estilo Spotify) */}
                    {step === 'select_lyrics' && lyrics ? (
                        <>
                            <View style={styles.topHeader}>
                                <TouchableOpacity style={styles.topIconBtn} onPress={onClose}>
                                    <ChevronDown size={26} color="#FFFFFF" />
                                </TouchableOpacity>
                                <View style={styles.topCenter}>
                                    <Text style={styles.topTitle}>Elegir letras</Text>
                                    <Text style={styles.topSub}>
                                        {selectedIndices.length}{' '}
                                        {selectedIndices.length === 1 ? 'línea seleccionada' : 'líneas seleccionadas'}{' '}
                                        (máx. {MAX_SELECTED_LINES})
                                    </Text>
                                </View>
                                <View style={styles.topIconBtn} />
                            </View>

                            <ScrollView
                                style={{ flex: 1 }}
                                contentContainerStyle={styles.selectListContent}
                                showsVerticalScrollIndicator={false}
                            >
                                {lyrics.lines.map((line, idx) => {
                                    const isSelected = selectedIndices.includes(idx);
                                    const isAdjacent =
                                        !isSelected &&
                                        minSel >= 0 &&
                                        (idx === minSel - 1 || idx === maxSel + 1);
                                    return (
                                        <TouchableOpacity
                                            key={line.id}
                                            activeOpacity={0.8}
                                            onPress={() => toggleLineSelection(idx)}
                                            style={[
                                                styles.selectLineRow,
                                                isSelected && styles.selectLineRowActive,
                                                isAdjacent && styles.selectLineRowAdjacent,
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.selectLineText,
                                                    isSelected && styles.selectLineTextActive,
                                                ]}
                                            >
                                                {line.text}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>

                            <View style={styles.continueWrap}>
                                <TouchableOpacity
                                    style={styles.whitePillBtn}
                                    activeOpacity={0.85}
                                    onPress={() => {
                                        setCardMode('lyrics');
                                        setStep('preview');
                                    }}
                                >
                                    <Text style={styles.whitePillBtnText}>Continuar</Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : null}

                    {/* PASO 2: Vista previa de Tarjeta (Canción o Letra) + Compartir */}
                    {step === 'preview' ? (
                        <>
                            <View style={styles.topHeader}>
                                <TouchableOpacity style={styles.topIconBtn} onPress={onClose}>
                                    <ChevronDown size={26} color="#FFFFFF" />
                                </TouchableOpacity>
                                <View style={styles.topCenter}>
                                    <Text style={styles.topTitle}>Compartir tarjeta</Text>
                                </View>
                                <View style={styles.topIconBtn} />
                            </View>

                            <ScrollView
                                style={{ flex: 1 }}
                                contentContainerStyle={styles.previewContent}
                                showsVerticalScrollIndicator={false}
                            >
                                {renderLiveCard()}

                                {/* Selector Canción / Letra */}
                                {hasLyrics && (
                                    <View style={styles.modeSwitch}>
                                        <TouchableOpacity
                                            style={[
                                                styles.modeSwitchBtn,
                                                cardMode === 'song' && styles.modeSwitchBtnActive,
                                            ]}
                                            onPress={() => setCardMode('song')}
                                        >
                                            <Text
                                                style={[
                                                    styles.modeSwitchText,
                                                    cardMode === 'song' && styles.modeSwitchTextActive,
                                                ]}
                                            >
                                                Canción
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[
                                                styles.modeSwitchBtn,
                                                cardMode === 'lyrics' && styles.modeSwitchBtnActive,
                                            ]}
                                            onPress={() => setCardMode('lyrics')}
                                        >
                                            <Text
                                                style={[
                                                    styles.modeSwitchText,
                                                    cardMode === 'lyrics' && styles.modeSwitchTextActive,
                                                ]}
                                            >
                                                Letra
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                )}

                                {/* Selector rápido de colores + botón Personalizar */}
                                <View style={styles.quickPaletteRow}>
                                    {colorPresets.slice(0, 4).map((preset, idx) => {
                                        const active = !bgImageUri && presetIndex === idx;
                                        return (
                                            <TouchableOpacity
                                                key={preset.id}
                                                onPress={() => {
                                                    setBgImageUri(null);
                                                    setPresetIndex(idx);
                                                }}
                                                style={[
                                                    styles.swatchCircle,
                                                    { backgroundColor: preset.swatch },
                                                    active && styles.swatchCircleActive,
                                                ]}
                                            />
                                        );
                                    })}
                                    <TouchableOpacity
                                        style={styles.customizeIconBtn}
                                        onPress={() => setStep('customize')}
                                    >
                                        <Sparkles size={18} color="#FFFFFF" />
                                    </TouchableOpacity>
                                </View>

                                {/* Botón Editar letra si estamos en modo Letra */}
                                {hasLyrics && cardMode === 'lyrics' && (
                                    <TouchableOpacity
                                        style={styles.editLyricsBtn}
                                        onPress={() => setStep('select_lyrics')}
                                    >
                                        <Pencil size={15} color="#FFFFFF" />
                                        <Text style={styles.editLyricsText}>Editar letra</Text>
                                    </TouchableOpacity>
                                )}
                            </ScrollView>

                            {/* Acciones de compartir */}
                            <View style={styles.shareActionsBar}>
                                <TouchableOpacity
                                    style={styles.primaryShareBtn}
                                    activeOpacity={0.85}
                                    disabled={exporting}
                                    onPress={handleShareCardImage}
                                >
                                    {exporting ? (
                                        <ActivityIndicator size="small" color="#000000" />
                                    ) : (
                                        <>
                                            <Share2 size={18} color="#000000" />
                                            <Text style={styles.primaryShareText}>Compartir imagen</Text>
                                        </>
                                    )}
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.secondaryShareBtn}
                                    activeOpacity={0.8}
                                    onPress={handleShareText}
                                >
                                    <Text style={styles.secondaryShareText}>Solo texto</Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : null}

                    {/* PASO 3: Personalizador avanzado (Color, Imagen, Texto) */}
                    {step === 'customize' ? (
                        <>
                            <View style={styles.topHeader}>
                                <TouchableOpacity
                                    style={styles.topIconBtn}
                                    onPress={() => setStep('preview')}
                                >
                                    <ArrowLeft size={24} color="#FFFFFF" />
                                </TouchableOpacity>
                                <View style={styles.topCenter}>
                                    <Text style={styles.topTitle}>Personalizar tarjeta</Text>
                                </View>
                                <View style={styles.topIconBtn} />
                            </View>

                            <ScrollView
                                style={{ flex: 1 }}
                                contentContainerStyle={styles.previewContent}
                                showsVerticalScrollIndicator={false}
                            >
                                {renderLiveCard()}
                            </ScrollView>

                            {/* Panel inferior de herramientas */}
                            <View style={styles.customizerPanel}>
                                {/* Controles de la pestaña activa */}
                                {customizerTab === 'color' && (
                                    <ScrollView
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        contentContainerStyle={styles.colorRow}
                                    >
                                        {colorPresets.map((preset, idx) => {
                                            const active = !bgImageUri && presetIndex === idx;
                                            return (
                                                <TouchableOpacity
                                                    key={preset.id}
                                                    onPress={() => {
                                                        setBgImageUri(null);
                                                        setPresetIndex(idx);
                                                    }}
                                                    style={[
                                                        styles.swatchCircleLarge,
                                                        { backgroundColor: preset.swatch },
                                                        active && styles.swatchCircleActive,
                                                    ]}
                                                />
                                            );
                                        })}
                                    </ScrollView>
                                )}

                                {customizerTab === 'image' && (
                                    <View style={styles.imageToolsRow}>
                                        <TouchableOpacity
                                            style={styles.toolActionPill}
                                            onPress={handlePickBgImage}
                                        >
                                            <ImageIcon size={17} color="#FFFFFF" />
                                            <Text style={styles.toolActionText}>Elegir de galería</Text>
                                        </TouchableOpacity>
                                        {bgImageUri && (
                                            <TouchableOpacity
                                                style={[styles.toolActionPill, { backgroundColor: '#3F1D24' }]}
                                                onPress={() => setBgImageUri(null)}
                                            >
                                                <Trash2 size={16} color="#F87171" />
                                                <Text style={[styles.toolActionText, { color: '#F87171' }]}>
                                                    Quitar foto
                                                </Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                )}

                                {customizerTab === 'text' && (
                                    <View style={styles.textToolsBox}>
                                        <View style={styles.fontChipsRow}>
                                            {(
                                                [
                                                    { key: 'classic', label: 'Clásico' },
                                                    { key: 'wide', label: 'Ancho' },
                                                    { key: 'narrow', label: 'Estrecho' },
                                                    { key: 'italic', label: 'Inclinado' },
                                                ] as const
                                            ).map((f) => {
                                                const active = fontStyle === f.key;
                                                return (
                                                    <TouchableOpacity
                                                        key={f.key}
                                                        onPress={() => setFontStyle(f.key)}
                                                        style={[
                                                            styles.fontChip,
                                                            active && styles.fontChipActive,
                                                        ]}
                                                    >
                                                        <Text
                                                            style={[
                                                                styles.fontChipText,
                                                                active && styles.fontChipTextActive,
                                                            ]}
                                                        >
                                                            {f.label}
                                                        </Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>
                                        <View style={styles.alignCaseRow}>
                                            <TouchableOpacity style={styles.miniToolBtn} onPress={cycleAlign}>
                                                <AlignIcon size={19} color="#FFFFFF" />
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[
                                                    styles.miniToolBtn,
                                                    uppercase && styles.miniToolBtnActive,
                                                ]}
                                                onPress={() => setUppercase((u) => !u)}
                                            >
                                                <Text
                                                    style={[
                                                        styles.caseLabel,
                                                        uppercase && { color: '#000000' },
                                                    ]}
                                                >
                                                    {uppercase ? 'A' : 'a'}
                                                </Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                )}

                                {/* Pestañas del personalizador */}
                                <View style={styles.customizerTabsRow}>
                                    <TouchableOpacity
                                        style={[
                                            styles.customizerTabBtn,
                                            customizerTab === 'color' && styles.customizerTabBtnActive,
                                        ]}
                                        onPress={() => setCustomizerTab('color')}
                                    >
                                        <Palette size={20} color="#FFFFFF" />
                                        <Text style={styles.customizerTabLabel}>Color</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[
                                            styles.customizerTabBtn,
                                            customizerTab === 'image' && styles.customizerTabBtnActive,
                                        ]}
                                        onPress={() => setCustomizerTab('image')}
                                    >
                                        <ImageIcon size={20} color="#FFFFFF" />
                                        <Text style={styles.customizerTabLabel}>Imágenes</Text>
                                    </TouchableOpacity>
                                    {cardMode === 'lyrics' && (
                                        <TouchableOpacity
                                            style={[
                                                styles.customizerTabBtn,
                                                customizerTab === 'text' && styles.customizerTabBtnActive,
                                            ]}
                                            onPress={() => setCustomizerTab('text')}
                                        >
                                            <Type size={20} color="#FFFFFF" />
                                            <Text style={styles.customizerTabLabel}>Texto</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>

                                <TouchableOpacity
                                    style={[styles.whitePillBtn, { alignSelf: 'center', marginTop: 12 }]}
                                    onPress={() => setStep('preview')}
                                >
                                    <Text style={styles.whitePillBtnText}>Listo</Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    ) : null}
                </View>
            </Modal>
        );
    }
);

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: '#121215',
    },
    topHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingBottom: 10,
    },
    topIconBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    topCenter: {
        flex: 1,
        alignItems: 'center',
    },
    topTitle: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
    topSub: {
        color: 'rgba(255,255,255,0.68)',
        fontSize: 12,
        marginTop: 2,
    },
    selectListContent: {
        paddingHorizontal: 18,
        paddingTop: 10,
        paddingBottom: 96,
        gap: 8,
    },
    selectLineRow: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 14,
        backgroundColor: 'transparent',
    },
    selectLineRowActive: {
        backgroundColor: '#FFFFFF',
    },
    selectLineRowAdjacent: {
        backgroundColor: 'rgba(255,255,255,0.14)',
    },
    selectLineText: {
        color: 'rgba(255,255,255,0.88)',
        fontSize: 19,
        fontWeight: '700',
        lineHeight: 26,
    },
    selectLineTextActive: {
        color: '#111114',
    },
    continueWrap: {
        alignItems: 'center',
        paddingTop: 10,
        paddingBottom: 4,
    },
    whitePillBtn: {
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 32,
        paddingVertical: 12,
        borderRadius: 999,
    },
    whitePillBtnText: {
        color: '#111114',
        fontSize: 15,
        fontWeight: '800',
    },
    previewContent: {
        paddingHorizontal: 22,
        paddingTop: 8,
        paddingBottom: 20,
        alignItems: 'center',
    },
    cardShadowWrap: {
        width: '100%',
        maxWidth: 340,
        alignItems: 'center',
    },
    cardFrame: {
        width: '100%',
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    songCardFrame: {
        maxWidth: 290,
    },
    songCardInner: {
        padding: 20,
    },
    songCardArtBox: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: 14,
        backgroundColor: '#27272A',
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    fillImg: {
        width: '100%',
        height: '100%',
    },
    songCardTitle: {
        fontSize: 19,
        fontWeight: '800',
    },
    songCardArtist: {
        fontSize: 14,
        marginTop: 4,
    },
    lyricsCardInner: {
        padding: 22,
        minHeight: 310,
        justifyContent: 'space-between',
    },
    lyricsCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 18,
    },
    miniArtBox: {
        width: 40,
        height: 40,
        borderRadius: 8,
        backgroundColor: '#27272A',
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
    },
    miniTitle: {
        fontSize: 14,
        fontWeight: '700',
    },
    miniArtist: {
        fontSize: 12,
        marginTop: 2,
    },
    lyricsCardBody: {
        marginVertical: 8,
        gap: 6,
    },
    cardLyricLine: {
        fontSize: 20,
        lineHeight: 27,
    },
    textShadowOverPhoto: {
        textShadowColor: 'rgba(0,0,0,0.65)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 5,
    },
    brandFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 20,
        gap: 8,
    },
    brandLogo: {
        width: 22,
        height: 22,
        borderRadius: 5,
    },
    brandName: {
        fontSize: 13.5,
        fontWeight: '800',
    },
    modeSwitch: {
        flexDirection: 'row',
        backgroundColor: '#27272A',
        borderRadius: 999,
        padding: 4,
        marginTop: 18,
        width: 240,
    },
    modeSwitchBtn: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 999,
        alignItems: 'center',
    },
    modeSwitchBtnActive: {
        backgroundColor: '#FFFFFF',
    },
    modeSwitchText: {
        color: '#D4D4D8',
        fontSize: 14,
        fontWeight: '700',
    },
    modeSwitchTextActive: {
        color: '#111114',
    },
    quickPaletteRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginTop: 16,
    },
    swatchCircle: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.22)',
    },
    swatchCircleLarge: {
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.22)',
    },
    swatchCircleActive: {
        borderColor: '#FFFFFF',
        borderWidth: 3,
    },
    customizeIconBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#27272A',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.22)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    editLyricsBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#27272A',
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 999,
        marginTop: 14,
    },
    editLyricsText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '700',
    },
    shareActionsBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 20,
        paddingTop: 10,
    },
    primaryShareBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#FFFFFF',
        paddingVertical: 14,
        borderRadius: 999,
    },
    primaryShareText: {
        color: '#000000',
        fontSize: 15,
        fontWeight: '800',
    },
    secondaryShareBtn: {
        backgroundColor: '#27272A',
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderRadius: 999,
    },
    secondaryShareText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '700',
    },
    customizerPanel: {
        backgroundColor: '#1B1B20',
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 12,
    },
    colorRow: {
        gap: 14,
        paddingVertical: 6,
        paddingHorizontal: 4,
    },
    imageToolsRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 6,
    },
    toolActionPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#27272A',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 12,
    },
    toolActionText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
    textToolsBox: {
        gap: 10,
    },
    fontChipsRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    fontChip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: '#27272A',
    },
    fontChipActive: {
        backgroundColor: '#FFFFFF',
    },
    fontChipText: {
        color: '#E4E4E7',
        fontSize: 13,
        fontWeight: '700',
    },
    fontChipTextActive: {
        color: '#111114',
    },
    alignCaseRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 12,
    },
    miniToolBtn: {
        width: 44,
        height: 38,
        borderRadius: 10,
        backgroundColor: '#27272A',
        justifyContent: 'center',
        alignItems: 'center',
    },
    miniToolBtnActive: {
        backgroundColor: '#FFFFFF',
    },
    caseLabel: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '800',
    },
    customizerTabsRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 12,
        marginTop: 14,
    },
    customizerTabBtn: {
        width: 78,
        paddingVertical: 10,
        borderRadius: 14,
        backgroundColor: '#27272A',
        alignItems: 'center',
        gap: 4,
    },
    customizerTabBtnActive: {
        backgroundColor: '#3F3F46',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.35)',
    },
    customizerTabLabel: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '600',
    },
});
