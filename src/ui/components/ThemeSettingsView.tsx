import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useColorScheme,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import Slider from '@react-native-community/slider';
import {
    ArrowLeft,
    Check,
    Contrast,
    ImagePlus,
    Moon,
    Pencil,
    Sun,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    GRADIENT_PRESETS,
    resolveIsDarkMode,
    SOLID_PALETTES,
    useTheme,
} from '../../theme/ThemeContext';
import { getRelativeLuminance } from '../../theme/colorContrast';
import { THEME_IMAGE_PRESETS } from '../../theme/themeAssets';
import { CustomImageBackground, ThemeConfig } from '../../types/theme';
import { ThemePreviewMockup } from './ThemePreviewMockup';
import { ColorPickerModal } from './ColorPickerModal';

interface ThemeSettingsViewProps {
    onBack: () => void;
}

export const ThemeSettingsView: React.FC<ThemeSettingsViewProps> = React.memo(({ onBack }) => {
    const { theme, updateTheme } = useTheme();
    const systemScheme = useColorScheme();
    const insets = useSafeAreaInsets();
    const isDarkMode = resolveIsDarkMode(theme.mode, systemScheme);

    const [pickerMode, setPickerMode] = useState<'solid' | 'gradient' | null>(null);
    // Estado temporal para previsualizar y ajustar brillo/blur de una imagen ANTES de aplicarla
    const [pendingImage, setPendingImage] = useState<CustomImageBackground | null>(null);
    // Bloqueo anti-spam + loader fallback mientras cambia la imagen de fondo
    const [loadingImageKey, setLoadingImageKey] = useState<string | null>(null);
    const loaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearImageLoader = useCallback(() => {
        if (loaderTimerRef.current) {
            clearTimeout(loaderTimerRef.current);
            loaderTimerRef.current = null;
        }
        setLoadingImageKey(null);
    }, []);

    useEffect(() => {
        return () => {
            if (loaderTimerRef.current) {
                clearTimeout(loaderTimerRef.current);
            }
        };
    }, []);

    // Precarga en caché las imágenes predeterminadas del modo activo para acelerar el cambio
    useEffect(() => {
        THEME_IMAGE_PRESETS.forEach((preset) => {
            const src = isDarkMode ? preset.dark : preset.light;
            try {
                const resolved = Image.resolveAssetSource(src);
                if (resolved?.uri && /^https?:\/\//i.test(resolved.uri)) {
                    Image.prefetch(resolved.uri).catch(() => { });
                }
            } catch { }
        });
    }, [isDarkMode]);

    // Aplica una imagen mostrando loader encima de la tarjeta elegida y bloqueando spam de toques
    const handleSelectImageTheme = useCallback(
        (key: string, patch: Partial<ThemeConfig>) => {
            if (loadingImageKey !== null) return;
            setLoadingImageKey(key);
            if (loaderTimerRef.current) clearTimeout(loaderTimerRef.current);
            // Respaldo máximo para liberar el loader si la imagen ya estaba en caché instantánea
            loaderTimerRef.current = setTimeout(() => {
                loaderTimerRef.current = null;
                setLoadingImageKey(null);
            }, 420);

            requestAnimationFrame(() => {
                updateTheme(patch);
            });
        },
        [loadingImageKey, updateTheme]
    );

    const customSolids = theme.customSolidColors ?? [];
    const customGradients = theme.customGradients ?? [];
    const customImages = useMemo(() => {
        const list = (theme.customImages ?? []).filter((img) => Boolean(img.uri));
        if (
            theme.customImage?.uri &&
            !list.some((img) => img.uri === theme.customImage?.uri)
        ) {
            list.unshift(theme.customImage);
        }
        return list;
    }, [theme.customImages, theme.customImage]);

    // Abre galería y muestra el editor con vista previa de la UI antes de aplicar
    const handlePickNewImage = useCallback(async () => {
        try {
            const res = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 0.9,
            });
            if (!res.canceled && res.assets?.[0]?.uri) {
                setPendingImage({
                    uri: res.assets[0].uri,
                    blur: 0,
                    brightness: 100,
                });
            }
        } catch {
            Alert.alert('Imagen', 'No se pudo abrir la galería de imágenes.');
        }
    }, []);

    // Guarda la imagen ajustada al pulsar el Check superior derecho
    const handleAcceptImage = useCallback(() => {
        if (!pendingImage) return;
        if (pendingImage.presetId) {
            updateTheme({
                backgroundType: 'image',
                customImage: pendingImage,
            });
        } else if (pendingImage.uri) {
            const filtered = (theme.customImages ?? []).filter((img) => img.uri !== pendingImage.uri);
            const nextSaved = [pendingImage, ...filtered].slice(0, 8);
            updateTheme({
                backgroundType: 'image',
                customImage: pendingImage,
                customImages: nextSaved,
                foregroundColor: '#FFFFFF',
            });
        }
        setPendingImage(null);
    }, [pendingImage, theme.customImages, updateTheme]);

    const handleConfirmCustomSolid = useCallback(
        (hex: string) => {
            const normalized = hex.toUpperCase();
            const nextSaved = [
                normalized,
                ...customSolids.filter((c) => c.toUpperCase() !== normalized),
            ].slice(0, 8);
            updateTheme({
                backgroundType: 'solid',
                solidColor: normalized,
                customSolidColors: nextSaved,
            });
            setPickerMode(null);
        },
        [customSolids, updateTheme]
    );

    const handleConfirmCustomGradient = useCallback(
        (pair: [string, string]) => {
            const norm: [string, string] = [pair[0].toUpperCase(), pair[1].toUpperCase()];
            const nextSaved = [
                norm,
                ...customGradients.filter(
                    (g) => g[0].toUpperCase() !== norm[0] || g[1].toUpperCase() !== norm[1]
                ),
            ].slice(0, 8);
            updateTheme({
                backgroundType: 'gradient',
                gradientColors: norm,
                customGradients: nextSaved,
            });
            setPickerMode(null);
        },
        [customGradients, updateTheme]
    );

    // Al cambiar entre Oscuro / Claro / Sistema, conserva imagen predeterminada cambiando a su variante dark/light
    const handleModeChange = useCallback(
        (nextMode: ThemeConfig['mode']) => {
            if (theme.backgroundType === 'image' && theme.customImage?.presetId) {
                updateTheme({ mode: nextMode });
                return;
            }
            const nextDark = resolveIsDarkMode(nextMode, systemScheme);
            updateTheme({
                mode: nextMode,
                backgroundType: 'solid',
                solidColor: nextDark ? '#0A0A0A' : '#FFFFFF',
            });
        },
        [theme.backgroundType, theme.customImage?.presetId, systemScheme, updateTheme]
    );

    const pendingPreviewTheme: ThemeConfig | null = pendingImage
        ? {
              ...theme,
              backgroundType: 'image',
              customImage: pendingImage,
          }
        : null;

    return (
        <View style={styles.root}>
            {/* Cabecera */}
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack} style={styles.iconBtn}>
                    <ArrowLeft size={22} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Tema</Text>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Carrusel de vista previa en vivo (estilo Lark Player) */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.previewCarousel}
                >
                    <ThemePreviewMockup
                        previewTheme={theme}
                        variant="songs"
                        width={210}
                        height={310}
                        onImageLoaded={clearImageLoader}
                    />
                    <ThemePreviewMockup
                        previewTheme={theme}
                        variant="player"
                        width={210}
                        height={310}
                    />
                </ScrollView>

                {/* Selector segmentado Oscuro / Claro / Sistema */}
                <View style={styles.modeSegmented}>
                    {(
                        [
                            { key: 'dark', label: 'Oscuro', Icon: Moon },
                            { key: 'light', label: 'Claro', Icon: Sun },
                            { key: 'system', label: 'Sistema', Icon: Contrast },
                        ] as const
                    ).map(({ key, label, Icon }) => {
                        const active = theme.mode === key;
                        return (
                            <TouchableOpacity
                                key={key}
                                style={[styles.modeSegmentBtn, active && styles.modeSegmentBtnActive]}
                                onPress={() => handleModeChange(key)}
                            >
                                <Icon size={15} color={active ? '#FFFFFF' : '#A1A1AA'} />
                                <Text
                                    style={[
                                        styles.modeSegmentText,
                                        active && styles.modeSegmentTextActive,
                                    ]}
                                >
                                    {label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                {/* 1. COLOR SÓLIDO: Personalizados a la izquierda | barra vertical 50% | Predeterminados */}
                <View style={styles.sectionBlock}>
                    <Text style={styles.sectionLabel}>Color sólido</Text>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.swatchRow}
                    >
                        <TouchableOpacity
                            style={styles.customTriggerCircle}
                            activeOpacity={0.8}
                            onPress={() => setPickerMode('solid')}
                        >
                            <Pencil size={18} color="#FFFFFF" />
                        </TouchableOpacity>

                        {customSolids.map((hex) => {
                            const isSelected =
                                theme.backgroundType === 'solid' &&
                                theme.solidColor.toUpperCase() === hex.toUpperCase();
                            const checkInk = getRelativeLuminance(hex) > 0.45 ? '#111114' : '#FFFFFF';
                            return (
                                <TouchableOpacity
                                    key={`custom-solid-${hex}`}
                                    style={[
                                        styles.swatchCircle,
                                        { backgroundColor: hex },
                                        isSelected && styles.swatchSelected,
                                    ]}
                                    onPress={() =>
                                        updateTheme({ backgroundType: 'solid', solidColor: hex })
                                    }
                                >
                                    {isSelected && <Check size={18} color={checkInk} />}
                                </TouchableOpacity>
                            );
                        })}

                        {/* Barra separadora vertical con opacidad a la mitad */}
                        <View style={styles.verticalDivider} />

                        {SOLID_PALETTES.map((p) => {
                            const color = isDarkMode ? p.darkBg : p.lightBg;
                            const isSelected =
                                theme.backgroundType === 'solid' &&
                                theme.solidColor.toUpperCase() === color.toUpperCase();
                            const checkInk = getRelativeLuminance(color) > 0.45 ? '#111114' : '#FFFFFF';
                            return (
                                <TouchableOpacity
                                    key={p.name}
                                    style={[
                                        styles.swatchCircle,
                                        { backgroundColor: color },
                                        isSelected && styles.swatchSelected,
                                    ]}
                                    onPress={() =>
                                        updateTheme({ backgroundType: 'solid', solidColor: color })
                                    }
                                >
                                    {isSelected && <Check size={18} color={checkInk} />}
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>

                {/* 2. GRADIENTES: Personalizados a la izquierda | barra vertical 50% | Círculos sin texto */}
                <View style={styles.sectionBlock}>
                    <Text style={styles.sectionLabel}>Gradientes</Text>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.swatchRow}
                    >
                        <TouchableOpacity
                            style={styles.customTriggerCircle}
                            activeOpacity={0.8}
                            onPress={() => setPickerMode('gradient')}
                        >
                            <Pencil size={18} color="#FFFFFF" />
                        </TouchableOpacity>

                        {customGradients.map((pair, idx) => {
                            const isSelected =
                                theme.backgroundType === 'gradient' &&
                                theme.gradientColors[0].toUpperCase() === pair[0].toUpperCase() &&
                                theme.gradientColors[1].toUpperCase() === pair[1].toUpperCase();
                            return (
                                <TouchableOpacity
                                    key={`custom-grad-${idx}-${pair[0]}-${pair[1]}`}
                                    style={[
                                        styles.gradientCircleWrap,
                                        isSelected && styles.swatchSelected,
                                    ]}
                                    onPress={() =>
                                        updateTheme({
                                            backgroundType: 'gradient',
                                            gradientColors: pair,
                                        })
                                    }
                                >
                                    <LinearGradient colors={pair} style={styles.gradientCircleFill}>
                                        {isSelected && <Check size={18} color="#FFFFFF" />}
                                    </LinearGradient>
                                </TouchableOpacity>
                            );
                        })}

                        {/* Barra separadora vertical con opacidad a la mitad */}
                        <View style={styles.verticalDivider} />

                        {GRADIENT_PRESETS.map((g) => {
                            const isSelected =
                                theme.backgroundType === 'gradient' &&
                                theme.gradientColors[0].toUpperCase() === g.colors[0].toUpperCase() &&
                                theme.gradientColors[1].toUpperCase() === g.colors[1].toUpperCase();
                            return (
                                <TouchableOpacity
                                    key={g.name}
                                    style={[
                                        styles.gradientCircleWrap,
                                        isSelected && styles.swatchSelected,
                                    ]}
                                    onPress={() =>
                                        updateTheme({
                                            backgroundType: 'gradient',
                                            gradientColors: g.colors,
                                        })
                                    }
                                >
                                    <LinearGradient colors={g.colors} style={styles.gradientCircleFill}>
                                        {isSelected && <Check size={18} color="#FFFFFF" />}
                                    </LinearGradient>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>

                {/* 3. IMAGEN PERSONALIZADA: Personalizadas a la izquierda | barra vertical 50% | Predeterminadas dark/light */}
                <View style={styles.sectionBlock}>
                    <Text style={styles.sectionLabel}>Imagen personalizada</Text>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.imageStripRow}
                    >
                        <TouchableOpacity
                            style={styles.addImageRect}
                            activeOpacity={0.8}
                            onPress={handlePickNewImage}
                        >
                            <ImagePlus size={24} color="#FFFFFF" />
                            <Text style={styles.addImageText}>Agregar</Text>
                        </TouchableOpacity>

                        {customImages.map((img) => {
                            const itemKey = `custom:${img.uri}`;
                            const isSelected =
                                theme.backgroundType === 'image' &&
                                Boolean(img.uri) &&
                                theme.customImage?.uri === img.uri;
                            const isLoadingThis = loadingImageKey === itemKey;
                            return (
                                <View key={img.uri} style={styles.savedImgWrap}>
                                    <TouchableOpacity
                                        activeOpacity={0.85}
                                        disabled={loadingImageKey !== null}
                                        style={[
                                            styles.savedImageRect,
                                            isSelected && styles.savedImageRectSelected,
                                        ]}
                                        onPress={() => {
                                            if (isSelected) return;
                                            handleSelectImageTheme(itemKey, {
                                                backgroundType: 'image',
                                                customImage: img,
                                                foregroundColor: '#FFFFFF',
                                            });
                                        }}
                                    >
                                        <Image
                                            source={{ uri: img.uri }}
                                            blurRadius={img.blur}
                                            fadeDuration={0}
                                            style={styles.savedImageFill}
                                            resizeMode="cover"
                                        />
                                        <View
                                            style={[
                                                StyleSheet.absoluteFill,
                                                {
                                                    backgroundColor: `rgba(0,0,0,${Math.max(
                                                        0,
                                                        Math.min(1, 1 - img.brightness / 100)
                                                    )})`,
                                                },
                                            ]}
                                        />
                                        {isLoadingThis && (
                                            <View style={styles.imgLoaderOverlay}>
                                                <ActivityIndicator size="small" color="#FFFFFF" />
                                            </View>
                                        )}
                                        {isSelected && !isLoadingThis && (
                                            <View style={styles.imgCheckBadge}>
                                                <Check size={14} color="#FFFFFF" />
                                            </View>
                                        )}
                                        <TouchableOpacity
                                            style={styles.imgEditBadge}
                                            disabled={loadingImageKey !== null}
                                            onPress={() => setPendingImage(img)}
                                        >
                                            <Pencil size={12} color="#FFFFFF" />
                                        </TouchableOpacity>
                                    </TouchableOpacity>
                                </View>
                            );
                        })}

                        {/* Barra separadora vertical con opacidad a la mitad */}
                        <View style={[styles.verticalDivider, { height: 76 }]} />

                        {/* 6 imágenes predeterminadas adaptadas automáticamente a modo oscuro / claro */}
                        {THEME_IMAGE_PRESETS.map((preset) => {
                            const itemKey = `preset:${preset.id}`;
                            const isSelected =
                                theme.backgroundType === 'image' &&
                                theme.customImage?.presetId === preset.id;
                            const isLoadingThis = loadingImageKey === itemKey;
                            const source = isDarkMode ? preset.dark : preset.light;
                            return (
                                <View key={preset.id} style={styles.savedImgWrap}>
                                    <TouchableOpacity
                                        activeOpacity={0.85}
                                        disabled={loadingImageKey !== null}
                                        style={[
                                            styles.savedImageRect,
                                            isSelected && styles.savedImageRectSelected,
                                        ]}
                                        onPress={() => {
                                            if (isSelected) return;
                                            handleSelectImageTheme(itemKey, {
                                                backgroundType: 'image',
                                                customImage: {
                                                    presetId: preset.id,
                                                    blur: 0,
                                                    brightness: 100,
                                                },
                                            });
                                        }}
                                    >
                                        <Image
                                            source={source}
                                            fadeDuration={0}
                                            style={styles.savedImageFill}
                                            resizeMode="cover"
                                        />
                                        {isLoadingThis && (
                                            <View style={styles.imgLoaderOverlay}>
                                                <ActivityIndicator size="small" color="#FFFFFF" />
                                            </View>
                                        )}
                                        {isSelected && !isLoadingThis && (
                                            <View style={styles.imgCheckBadge}>
                                                <Check size={14} color="#FFFFFF" />
                                            </View>
                                        )}
                                        {/* Permite ajustar brillo y blur incluso sobre un fondo predeterminado */}
                                        <TouchableOpacity
                                            style={styles.imgEditBadge}
                                            disabled={loadingImageKey !== null}
                                            onPress={() =>
                                                setPendingImage({
                                                    presetId: preset.id,
                                                    blur:
                                                        isSelected && theme.customImage
                                                            ? theme.customImage.blur
                                                            : 0,
                                                    brightness:
                                                        isSelected && theme.customImage
                                                            ? theme.customImage.brightness
                                                            : 100,
                                                })
                                            }
                                        >
                                            <Pencil size={12} color="#FFFFFF" />
                                        </TouchableOpacity>
                                    </TouchableOpacity>
                                </View>
                            );
                        })}
                    </ScrollView>
                </View>
            </ScrollView>

            {/* Selector visual de color sólido o gradiente de 2 colores */}
            <ColorPickerModal
                visible={pickerMode !== null}
                mode={pickerMode ?? 'solid'}
                initialColor={theme.solidColor}
                initialGradient={theme.gradientColors}
                onCancel={() => setPickerMode(null)}
                onConfirmSolid={handleConfirmCustomSolid}
                onConfirmGradient={handleConfirmCustomGradient}
            />

            {/* Modal previo a aplicar imagen: Vista previa UI + Brillo + Blur + Check */}
            <Modal
                visible={pendingImage !== null}
                animationType="slide"
                statusBarTranslucent
                onRequestClose={() => setPendingImage(null)}
            >
                {pendingImage && pendingPreviewTheme ? (
                    <View
                        style={[
                            styles.imageEditorScreen,
                            {
                                paddingTop: Math.max(insets.top, 26) + 6,
                                paddingBottom: Math.max(insets.bottom, 16) + 12,
                            },
                        ]}
                    >
                        <View style={styles.header}>
                            <TouchableOpacity
                                style={styles.iconBtn}
                                onPress={() => setPendingImage(null)}
                            >
                                <ArrowLeft size={22} color="#FFFFFF" />
                            </TouchableOpacity>
                            <Text style={styles.headerTitle}>Ajustar fondo</Text>
                            <TouchableOpacity
                                style={styles.acceptCheckBtn}
                                onPress={handleAcceptImage}
                            >
                                <Check size={22} color="#FFFFFF" />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.editorPreviewArea}>
                            <ThemePreviewMockup
                                previewTheme={pendingPreviewTheme}
                                variant="songs"
                                width={240}
                                height={365}
                            />
                        </View>

                        <View style={styles.editorControlsCard}>
                            <View style={styles.sliderRowHeader}>
                                <Text style={styles.sliderLabel}>Brillo</Text>
                                <Text style={styles.sliderValue}>
                                    {Math.round(pendingImage.brightness)}%
                                </Text>
                            </View>
                            <Slider
                                minimumValue={10}
                                maximumValue={100}
                                step={1}
                                value={pendingImage.brightness}
                                onValueChange={(v) =>
                                    setPendingImage((prev) =>
                                        prev ? { ...prev, brightness: Math.round(v) } : prev
                                    )
                                }
                                minimumTrackTintColor="#2563EB"
                                maximumTrackTintColor="#3F3F46"
                                thumbTintColor="#FFFFFF"
                            />

                            <View style={[styles.sliderRowHeader, { marginTop: 12 }]}>
                                <Text style={styles.sliderLabel}>Desenfoque (Blur)</Text>
                                <Text style={styles.sliderValue}>
                                    {Math.round(pendingImage.blur)}
                                </Text>
                            </View>
                            <Slider
                                minimumValue={0}
                                maximumValue={25}
                                step={1}
                                value={pendingImage.blur}
                                onValueChange={(v) =>
                                    setPendingImage((prev) =>
                                        prev ? { ...prev, blur: Math.round(v) } : prev
                                    )
                                }
                                minimumTrackTintColor="#2563EB"
                                maximumTrackTintColor="#3F3F46"
                                thumbTintColor="#FFFFFF"
                            />
                        </View>
                    </View>
                ) : null}
            </Modal>
        </View>
    );
});

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#0C0E14',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    iconBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
        marginLeft: 6,
    },
    acceptCheckBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#2563EB',
        justifyContent: 'center',
        alignItems: 'center',
    },
    scrollContent: {
        paddingBottom: 38,
    },
    previewCarousel: {
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 12,
        gap: 14,
    },
    modeSegmented: {
        flexDirection: 'row',
        marginHorizontal: 18,
        marginTop: 4,
        marginBottom: 18,
        backgroundColor: '#171C28',
        borderRadius: 999,
        padding: 4,
    },
    modeSegmentBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        borderRadius: 999,
    },
    modeSegmentBtnActive: {
        backgroundColor: '#2563EB',
    },
    modeSegmentText: {
        color: '#A1A1AA',
        fontSize: 13,
        fontWeight: '700',
    },
    modeSegmentTextActive: {
        color: '#FFFFFF',
    },
    sectionBlock: {
        marginBottom: 20,
    },
    sectionLabel: {
        color: '#E4E4E7',
        fontSize: 14,
        fontWeight: '700',
        paddingHorizontal: 18,
        marginBottom: 10,
    },
    swatchRow: {
        paddingHorizontal: 18,
        alignItems: 'center',
        gap: 12,
    },
    customTriggerCircle: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: '#1E2433',
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.22)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    swatchCircle: {
        width: 46,
        height: 46,
        borderRadius: 23,
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    gradientCircleWrap: {
        width: 46,
        height: 46,
        borderRadius: 23,
        overflow: 'hidden',
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    gradientCircleFill: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    swatchSelected: {
        borderColor: '#FFFFFF',
        borderWidth: 3,
    },
    // Barra vertical separadora a la mitad de opacidad
    verticalDivider: {
        width: 1.5,
        height: 30,
        backgroundColor: 'rgba(255, 255, 255, 0.5)',
        borderRadius: 1,
        marginHorizontal: 2,
    },
    imageStripRow: {
        paddingHorizontal: 18,
        alignItems: 'center',
        gap: 12,
    },
    addImageRect: {
        width: 82,
        height: 122,
        borderRadius: 16,
        backgroundColor: '#1E2433',
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.22)',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
    },
    addImageText: {
        color: '#E4E4E7',
        fontSize: 12,
        fontWeight: '700',
    },
    savedImgWrap: {
        position: 'relative',
    },
    savedImageRect: {
        width: 82,
        height: 122,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.18)',
        position: 'relative',
    },
    savedImageFill: {
        width: '100%',
        height: '100%',
    },
    savedImageRectSelected: {
        borderColor: '#FFFFFF',
        borderWidth: 3,
    },
    imgCheckBadge: {
        position: 'absolute',
        top: 6,
        left: 6,
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#2563EB',
        justifyContent: 'center',
        alignItems: 'center',
    },
    imgLoaderOverlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    imgEditBadge: {
        position: 'absolute',
        bottom: 6,
        right: 6,
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(0,0,0,0.65)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    imageEditorScreen: {
        flex: 1,
        backgroundColor: '#0C0E14',
    },
    editorPreviewArea: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 14,
    },
    editorControlsCard: {
        marginHorizontal: 18,
        backgroundColor: '#161A25',
        borderRadius: 18,
        padding: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    sliderRowHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 2,
    },
    sliderLabel: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '700',
    },
    sliderValue: {
        color: '#93C5FD',
        fontSize: 13,
        fontWeight: '700',
    },
});
