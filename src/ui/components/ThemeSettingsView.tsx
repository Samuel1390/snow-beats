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
import { useI18n } from '../../i18n/LanguageContext';

interface ThemeSettingsViewProps {
    onBack: () => void;
}

export const ThemeSettingsView: React.FC<ThemeSettingsViewProps> = React.memo(({ onBack }) => {
    const { theme, updateTheme } = useTheme();
    const { t } = useI18n();
    const systemScheme = useColorScheme();
    const insets = useSafeAreaInsets();
    const isDarkMode = resolveIsDarkMode(theme.mode, systemScheme);

    const [pickerMode, setPickerMode] = useState<'solid' | 'gradient' | null>(null);
    // Estado temporal para previsualizar y ajustar brillo/blur de una imagen ANTES de aplicarla
    const [pendingImage, setPendingImage] = useState<CustomImageBackground | null>(null);
    // Bloqueo anti-spam unificado + feedback visual al cambiar modo, color, gradiente o imagen
    const [applyingKey, setApplyingKey] = useState<string | null>(null);
    const [showApplyingBanner, setShowApplyingBanner] = useState(false);
    const applyingLockRef = useRef(false);
    const waitForImageRef = useRef(false);
    const applyStartMsRef = useRef(0);
    const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rafRef = useRef<number | null>(null);

    const clearAllApplyTimers = useCallback(() => {
        if (releaseTimerRef.current) {
            clearTimeout(releaseTimerRef.current);
            releaseTimerRef.current = null;
        }
        if (bannerTimerRef.current) {
            clearTimeout(bannerTimerRef.current);
            bannerTimerRef.current = null;
        }
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    }, []);

    const finishThemeApply = useCallback(() => {
        clearAllApplyTimers();
        applyingLockRef.current = false;
        waitForImageRef.current = false;
        setApplyingKey(null);
        setShowApplyingBanner(false);
    }, [clearAllApplyTimers]);

    const handlePreviewImageLoaded = useCallback(() => {
        if (!applyingLockRef.current || !waitForImageRef.current) return;
        const elapsed = Date.now() - applyStartMsRef.current;
        const remaining = Math.max(0, 140 - elapsed);
        if (releaseTimerRef.current) {
            clearTimeout(releaseTimerRef.current);
        }
        if (remaining === 0) {
            finishThemeApply();
        } else {
            releaseTimerRef.current = setTimeout(finishThemeApply, remaining);
        }
    }, [finishThemeApply]);

    useEffect(() => {
        return () => {
            clearAllApplyTimers();
        };
    }, [clearAllApplyTimers]);

    // Precarga en caché las variantes oscura y clara de los fondos predeterminados
    useEffect(() => {
        THEME_IMAGE_PRESETS.forEach((preset) => {
            [preset.dark, preset.light].forEach((src) => {
                try {
                    const resolved = Image.resolveAssetSource(src);
                    if (resolved?.uri && /^https?:\/\//i.test(resolved.uri)) {
                        Image.prefetch(resolved.uri).catch(() => { });
                    }
                } catch { }
            });
        });
    }, []);

    // Aplica cualquier cambio de tema con bloqueo anti-spam y feedback de carga fluido
    const applyThemeChange = useCallback(
        (key: string, patch: Partial<ThemeConfig>, waitForImage = false) => {
            if (applyingLockRef.current) return;
            clearAllApplyTimers();
            applyingLockRef.current = true;
            waitForImageRef.current = waitForImage;
            applyStartMsRef.current = Date.now();
            setApplyingKey(key);
            setShowApplyingBanner(false);

            // Muestra el indicador superior solo si la transición tarda más de 85ms (evita parpadeos)
            bannerTimerRef.current = setTimeout(() => {
                if (applyingLockRef.current) {
                    setShowApplyingBanner(true);
                }
            }, 85);

            // Fallback garantizado para liberar el bloqueo sin quedarse nunca colgado
            const maxLockMs = waitForImage ? 460 : 170;
            releaseTimerRef.current = setTimeout(finishThemeApply, maxLockMs);

            // Pinta primero el spinner en el elemento tocado y aplica el tema en el siguiente frame
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                updateTheme(patch);
            });
        },
        [clearAllApplyTimers, finishThemeApply, updateTheme]
    );

    const isApplying = applyingKey !== null;

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
            Alert.alert(t('theme.galleryErrorTitle'), t('theme.galleryErrorBody'));
        }
    }, [t]);

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

    // Al cambiar entre Oscuro / Claro / Sistema, conserva imágenes y gradientes con bloqueo anti-spam
    const handleModeChange = useCallback(
        (nextMode: ThemeConfig['mode']) => {
            if (theme.mode === nextMode || applyingLockRef.current) return;
            const modeKey = `mode:${nextMode}`;
            if (theme.backgroundType === 'image' && theme.customImage) {
                applyThemeChange(
                    modeKey,
                    {
                        mode: nextMode,
                        customImage: { ...theme.customImage },
                    },
                    true
                );
                return;
            }
            if (theme.backgroundType === 'gradient') {
                applyThemeChange(modeKey, { mode: nextMode }, false);
                return;
            }
            const nextDark = resolveIsDarkMode(nextMode, systemScheme);
            applyThemeChange(
                modeKey,
                {
                    mode: nextMode,
                    backgroundType: 'solid',
                    solidColor: nextDark ? '#0A0A0A' : '#FFFFFF',
                },
                false
            );
        },
        [theme.mode, theme.backgroundType, theme.customImage, systemScheme, applyThemeChange]
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
                <Text style={styles.headerTitle}>{t('theme.title')}</Text>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Carrusel de vista previa en vivo (estilo Lark Player) + pill sutil de carga */}
                <View style={styles.previewWrap}>
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
                            onImageLoaded={handlePreviewImageLoaded}
                        />
                        <ThemePreviewMockup
                            previewTheme={theme}
                            variant="player"
                            width={210}
                            height={310}
                        />
                    </ScrollView>

                    {showApplyingBanner && (
                        <View pointerEvents="none" style={styles.applyingBannerWrap}>
                            <View style={styles.applyingBannerPill}>
                                <ActivityIndicator size="small" color="#FFFFFF" />
                                <Text style={styles.applyingBannerText}>
                                    {t('theme.applying')}
                                </Text>
                            </View>
                        </View>
                    )}
                </View>

                {/* Selector segmentado Oscuro / Claro / Sistema */}
                <View style={styles.modeSegmented}>
                    {(
                        [
                            { key: 'dark', label: t('theme.mode.dark'), Icon: Moon },
                            { key: 'light', label: t('theme.mode.light'), Icon: Sun },
                            { key: 'system', label: t('theme.mode.system'), Icon: Contrast },
                        ] as const
                    ).map(({ key, label, Icon }) => {
                        const active = theme.mode === key;
                        const isLoadingMode = applyingKey === `mode:${key}`;
                        return (
                            <TouchableOpacity
                                key={key}
                                disabled={isApplying}
                                style={[
                                    styles.modeSegmentBtn,
                                    active && styles.modeSegmentBtnActive,
                                    isApplying && !isLoadingMode && styles.controlDimmed,
                                ]}
                                onPress={() => handleModeChange(key)}
                            >
                                {isLoadingMode ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <Icon size={15} color={active ? '#FFFFFF' : '#A1A1AA'} />
                                )}
                                <Text
                                    style={[
                                        styles.modeSegmentText,
                                        (active || isLoadingMode) && styles.modeSegmentTextActive,
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
                    <Text style={styles.sectionLabel}>{t('theme.solidColor')}</Text>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.swatchRow}
                    >
                        <TouchableOpacity
                            style={[styles.customTriggerCircle, isApplying && styles.controlDimmed]}
                            disabled={isApplying}
                            activeOpacity={0.8}
                            onPress={() => setPickerMode('solid')}
                        >
                            <Pencil size={18} color="#FFFFFF" />
                        </TouchableOpacity>

                        {customSolids.map((hex) => {
                            const itemKey = `solid:custom:${hex.toUpperCase()}`;
                            const isSelected =
                                theme.backgroundType === 'solid' &&
                                theme.solidColor.toUpperCase() === hex.toUpperCase();
                            const isLoadingThis = applyingKey === itemKey;
                            const checkInk = getRelativeLuminance(hex) > 0.45 ? '#111114' : '#FFFFFF';
                            return (
                                <TouchableOpacity
                                    key={`custom-solid-${hex}`}
                                    disabled={isApplying}
                                    style={[
                                        styles.swatchCircle,
                                        { backgroundColor: hex },
                                        isSelected && styles.swatchSelected,
                                        isApplying && !isLoadingThis && styles.controlDimmed,
                                    ]}
                                    onPress={() => {
                                        if (isSelected) return;
                                        applyThemeChange(
                                            itemKey,
                                            { backgroundType: 'solid', solidColor: hex },
                                            false
                                        );
                                    }}
                                >
                                    {isLoadingThis ? (
                                        <ActivityIndicator size="small" color={checkInk} />
                                    ) : isSelected ? (
                                        <Check size={18} color={checkInk} />
                                    ) : null}
                                </TouchableOpacity>
                            );
                        })}

                        {/* Barra separadora vertical con opacidad a la mitad */}
                        <View style={styles.verticalDivider} />

                        {SOLID_PALETTES.map((p) => {
                            const color = isDarkMode ? p.darkBg : p.lightBg;
                            const itemKey = `solid:preset:${p.name}:${color.toUpperCase()}`;
                            const isSelected =
                                theme.backgroundType === 'solid' &&
                                theme.solidColor.toUpperCase() === color.toUpperCase();
                            const isLoadingThis = applyingKey === itemKey;
                            const checkInk = getRelativeLuminance(color) > 0.45 ? '#111114' : '#FFFFFF';
                            return (
                                <TouchableOpacity
                                    key={p.name}
                                    disabled={isApplying}
                                    style={[
                                        styles.swatchCircle,
                                        { backgroundColor: color },
                                        isSelected && styles.swatchSelected,
                                        isApplying && !isLoadingThis && styles.controlDimmed,
                                    ]}
                                    onPress={() => {
                                        if (isSelected) return;
                                        applyThemeChange(
                                            itemKey,
                                            { backgroundType: 'solid', solidColor: color },
                                            false
                                        );
                                    }}
                                >
                                    {isLoadingThis ? (
                                        <ActivityIndicator size="small" color={checkInk} />
                                    ) : isSelected ? (
                                        <Check size={18} color={checkInk} />
                                    ) : null}
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>

                {/* 2. GRADIENTES: Personalizados a la izquierda | barra vertical 50% | Círculos sin texto */}
                <View style={styles.sectionBlock}>
                    <Text style={styles.sectionLabel}>{t('theme.gradients')}</Text>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.swatchRow}
                    >
                        <TouchableOpacity
                            style={[styles.customTriggerCircle, isApplying && styles.controlDimmed]}
                            disabled={isApplying}
                            activeOpacity={0.8}
                            onPress={() => setPickerMode('gradient')}
                        >
                            <Pencil size={18} color="#FFFFFF" />
                        </TouchableOpacity>

                        {customGradients.map((pair, idx) => {
                            const itemKey = `gradient:custom:${pair[0]}-${pair[1]}`;
                            const isSelected =
                                theme.backgroundType === 'gradient' &&
                                theme.gradientColors[0].toUpperCase() === pair[0].toUpperCase() &&
                                theme.gradientColors[1].toUpperCase() === pair[1].toUpperCase();
                            const isLoadingThis = applyingKey === itemKey;
                            return (
                                <TouchableOpacity
                                    key={`custom-grad-${idx}-${pair[0]}-${pair[1]}`}
                                    disabled={isApplying}
                                    style={[
                                        styles.gradientCircleWrap,
                                        isSelected && styles.swatchSelected,
                                        isApplying && !isLoadingThis && styles.controlDimmed,
                                    ]}
                                    onPress={() => {
                                        if (isSelected) return;
                                        applyThemeChange(
                                            itemKey,
                                            {
                                                backgroundType: 'gradient',
                                                gradientColors: pair,
                                            },
                                            false
                                        );
                                    }}
                                >
                                    <LinearGradient colors={pair} style={styles.gradientCircleFill}>
                                        {isLoadingThis ? (
                                            <ActivityIndicator size="small" color="#FFFFFF" />
                                        ) : isSelected ? (
                                            <Check size={18} color="#FFFFFF" />
                                        ) : null}
                                    </LinearGradient>
                                </TouchableOpacity>
                            );
                        })}

                        {/* Barra separadora vertical con opacidad a la mitad */}
                        <View style={styles.verticalDivider} />

                        {GRADIENT_PRESETS.map((g) => {
                            const itemKey = `gradient:preset:${g.name}`;
                            const isSelected =
                                theme.backgroundType === 'gradient' &&
                                theme.gradientColors[0].toUpperCase() === g.colors[0].toUpperCase() &&
                                theme.gradientColors[1].toUpperCase() === g.colors[1].toUpperCase();
                            const isLoadingThis = applyingKey === itemKey;
                            return (
                                <TouchableOpacity
                                    key={g.name}
                                    disabled={isApplying}
                                    style={[
                                        styles.gradientCircleWrap,
                                        isSelected && styles.swatchSelected,
                                        isApplying && !isLoadingThis && styles.controlDimmed,
                                    ]}
                                    onPress={() => {
                                        if (isSelected) return;
                                        applyThemeChange(
                                            itemKey,
                                            {
                                                backgroundType: 'gradient',
                                                gradientColors: g.colors,
                                            },
                                            false
                                        );
                                    }}
                                >
                                    <LinearGradient colors={g.colors} style={styles.gradientCircleFill}>
                                        {isLoadingThis ? (
                                            <ActivityIndicator size="small" color="#FFFFFF" />
                                        ) : isSelected ? (
                                            <Check size={18} color="#FFFFFF" />
                                        ) : null}
                                    </LinearGradient>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>

                {/* 3. IMAGEN PERSONALIZADA: Personalizadas a la izquierda | barra vertical 50% | Predeterminadas dark/light */}
                <View style={styles.sectionBlock}>
                    <Text style={styles.sectionLabel}>{t('theme.customImage')}</Text>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.imageStripRow}
                    >
                        <TouchableOpacity
                            style={[styles.addImageRect, isApplying && styles.controlDimmed]}
                            disabled={isApplying}
                            activeOpacity={0.8}
                            onPress={handlePickNewImage}
                        >
                            <ImagePlus size={24} color="#FFFFFF" />
                            <Text style={styles.addImageText}>{t('theme.addImage')}</Text>
                        </TouchableOpacity>

                        {customImages.map((img) => {
                            const itemKey = `custom:${img.uri}`;
                            const isSelected =
                                theme.backgroundType === 'image' &&
                                Boolean(img.uri) &&
                                theme.customImage?.uri === img.uri;
                            const isLoadingThis = applyingKey === itemKey;
                            return (
                                <View key={img.uri} style={styles.savedImgWrap}>
                                    <TouchableOpacity
                                        activeOpacity={0.85}
                                        disabled={isApplying}
                                        style={[
                                            styles.savedImageRect,
                                            isSelected && styles.savedImageRectSelected,
                                            isApplying && !isLoadingThis && styles.controlDimmed,
                                        ]}
                                        onPress={() => {
                                            if (isSelected) return;
                                            applyThemeChange(
                                                itemKey,
                                                {
                                                    backgroundType: 'image',
                                                    customImage: img,
                                                    foregroundColor: '#FFFFFF',
                                                },
                                                true
                                            );
                                        }}
                                    >
                                        <Image
                                            source={{ uri: img.uri }}
                                            blurRadius={img.blur > 0 ? img.blur : 0}
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
                                            disabled={isApplying}
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
                            const variantTag = isDarkMode ? 'dark' : 'light';
                            const itemKey = `preset:${preset.id}:${variantTag}`;
                            const isSelected =
                                theme.backgroundType === 'image' &&
                                theme.customImage?.presetId === preset.id;
                            const isLoadingThis = applyingKey === itemKey;
                            const source = isDarkMode ? preset.dark : preset.light;
                            return (
                                <View key={preset.id} style={styles.savedImgWrap}>
                                    <TouchableOpacity
                                        activeOpacity={0.85}
                                        disabled={isApplying}
                                        style={[
                                            styles.savedImageRect,
                                            isSelected && styles.savedImageRectSelected,
                                            isApplying && !isLoadingThis && styles.controlDimmed,
                                        ]}
                                        onPress={() => {
                                            if (isSelected) return;
                                            applyThemeChange(
                                                itemKey,
                                                {
                                                    backgroundType: 'image',
                                                    customImage: {
                                                        presetId: preset.id,
                                                        blur: 0,
                                                        brightness: 100,
                                                    },
                                                },
                                                true
                                            );
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
                                            disabled={isApplying}
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
                            <Text style={styles.headerTitle}>{t('theme.adjustBackground')}</Text>
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
                                <Text style={styles.sliderLabel}>{t('theme.brightness')}</Text>
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
                                <Text style={styles.sliderLabel}>{t('theme.blur')}</Text>
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
    previewWrap: {
        position: 'relative',
    },
    previewCarousel: {
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 12,
        gap: 14,
    },
    applyingBannerWrap: {
        position: 'absolute',
        top: 24,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 10,
    },
    applyingBannerPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'rgba(12, 14, 20, 0.86)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.18)',
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 999,
    },
    applyingBannerText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '700',
    },
    controlDimmed: {
        opacity: 0.62,
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
        backgroundColor: '#1B2030',
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
