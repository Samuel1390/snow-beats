import React from 'react';
import { Image, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowUpDown, Play, Search, Settings, Shuffle, SkipForward } from 'lucide-react-native';
import { ThemeConfig } from '../../types/theme';
import {
    resolveIsDarkMode,
    resolveIsLightText,
    resolveThemeImageSource,
} from '../../theme/ThemeContext';
import { getThemePresetById, PREVIEW_TRACKS } from '../../theme/themeAssets';
import { useI18n } from '../../i18n/LanguageContext';

const LOGO_ASSET = require('../../../assets/images/logo.png');

interface ThemePreviewMockupProps {
    previewTheme: ThemeConfig;
    variant: 'songs' | 'player';
    width?: number;
    height?: number;
    onImageLoaded?: () => void;
}

// Vista previa en vivo de la UI de Snow Beats usando carátulas reales y tema aplicado
export const ThemePreviewMockup: React.FC<ThemePreviewMockupProps> = React.memo(
    ({ previewTheme, variant, width = 220, height = 340, onImageLoaded }) => {
        const systemScheme = useColorScheme();
        const { t } = useI18n();
        const isLightText = resolveIsLightText(previewTheme, systemScheme);
        const fg = isLightText ? '#FFFFFF' : '#111827';
        const muted = isLightText ? 'rgba(255,255,255,0.7)' : 'rgba(17,24,39,0.68)';
        const chipBg = isLightText ? 'rgba(0,0,0,0.34)' : 'rgba(255,255,255,0.58)';
        const borderCol = isLightText ? 'rgba(255,255,255,0.18)' : 'rgba(17,24,39,0.16)';

        const renderBackdrop = (children: React.ReactNode) => {
            if (previewTheme.backgroundType === 'image' && previewTheme.customImage) {
                const source = resolveThemeImageSource(previewTheme, systemScheme);
                if (source) {
                    const darkMode = resolveIsDarkMode(previewTheme.mode, systemScheme);
                    const preset = previewTheme.customImage.presetId
                        ? getThemePresetById(previewTheme.customImage.presetId)
                        : null;
                    const brightness = previewTheme.customImage.brightness ?? 100;
                    const blur = previewTheme.customImage.blur ?? 0;
                    const darkOverlay = Math.max(0, Math.min(1, 1 - brightness / 100));
                    const isBrightLightPreset = Boolean(preset?.lightVariantIsBright && !darkMode);
                    const scrim =
                        isBrightLightPreset && brightness >= 75
                            ? 'rgba(255,255,255,0.20)'
                            : `rgba(0,0,0,${Math.max(0.20, darkOverlay)})`;
                    return (
                        <View style={[styles.fill, { backgroundColor: darkMode ? '#0A0A0A' : '#181C24' }]}>
                            <Image
                                source={source}
                                blurRadius={blur > 0 ? blur : 0}
                                fadeDuration={0}
                                onLoadEnd={onImageLoaded}
                                style={styles.bgImage}
                                resizeMode="cover"
                            />
                            <View
                                pointerEvents="none"
                                style={[StyleSheet.absoluteFill, { backgroundColor: scrim }]}
                            />
                            {children}
                        </View>
                    );
                }
            }
            if (previewTheme.backgroundType === 'gradient') {
                return (
                    <LinearGradient colors={previewTheme.gradientColors} style={styles.fill}>
                        {children}
                    </LinearGradient>
                );
            }
            return (
                <View style={[styles.fill, { backgroundColor: previewTheme.solidColor }]}>
                    {children}
                </View>
            );
        };

        const featuredTrack = PREVIEW_TRACKS[0];

        return (
            <View style={[styles.phoneFrame, { width, height, borderColor: borderCol }]}>
                {renderBackdrop(
                    variant === 'songs' ? (
                        <View style={styles.inner}>
                            {/* Header mini */}
                            <View style={styles.miniHeader}>
                                <View style={styles.miniBrand}>
                                    <Image source={LOGO_ASSET} style={styles.miniLogo} />
                                    <Text style={[styles.miniBrandText, { color: fg }]}>Snow Beats</Text>
                                </View>
                                <View style={styles.miniIcons}>
                                    <Search size={11} color={fg} />
                                    <ArrowUpDown size={11} color={fg} />
                                    <Settings size={11} color={fg} />
                                </View>
                            </View>

                            {/* Pestañas mini */}
                            <View style={[styles.miniTabs, { borderBottomColor: borderCol }]}>
                                <View style={[styles.miniTabActive, { borderBottomColor: fg }]}>
                                    <Text style={[styles.miniTabText, { color: fg, fontWeight: '700' }]}>
                                        {t('tabs.songs')}
                                    </Text>
                                </View>
                                <Text style={[styles.miniTabText, { color: muted }]}>{t('tabs.playlists')}</Text>
                                <Text style={[styles.miniTabText, { color: muted }]}>{t('tabs.artists')}</Text>
                            </View>

                            {/* Lista de canciones reales proporcionadas */}
                            <View style={styles.songList}>
                                {PREVIEW_TRACKS.map((s) => (
                                    <View key={s.id} style={styles.songRow}>
                                        <Image source={s.cover} style={styles.songArt} resizeMode="cover" />
                                        <View style={{ flex: 1, marginLeft: 8 }}>
                                            <Text style={[styles.songTitle, { color: fg }]} numberOfLines={1}>
                                                {s.title}
                                            </Text>
                                            <Text style={[styles.songArtist, { color: muted }]} numberOfLines={1}>
                                                {s.artist}
                                            </Text>
                                        </View>
                                    </View>
                                ))}
                            </View>

                            {/* MiniPlayer inferior */}
                            <View style={[styles.miniPlayer, { backgroundColor: chipBg }]}>
                                <Image
                                    source={featuredTrack.cover}
                                    style={styles.miniPlayerArt}
                                    resizeMode="cover"
                                />
                                <View style={{ flex: 1, marginLeft: 7 }}>
                                    <Text style={[styles.songTitle, { color: fg }]} numberOfLines={1}>
                                        {featuredTrack.title}
                                    </Text>
                                    <Text style={[styles.songArtist, { color: muted }]} numberOfLines={1}>
                                        {featuredTrack.artist}
                                    </Text>
                                </View>
                                <Play size={11} color={fg} />
                                <SkipForward size={11} color={fg} style={{ marginLeft: 6 }} />
                            </View>
                        </View>
                    ) : (
                        <View style={[styles.inner, { justifyContent: 'space-between' }]}>
                            <View style={styles.detailHero}>
                                <Image
                                    source={PREVIEW_TRACKS[2].cover}
                                    style={styles.detailCover}
                                    resizeMode="cover"
                                />
                                <Text style={[styles.detailTitle, { color: fg }]}>{t('theme.preview.favorites')}</Text>
                                <Text style={[styles.songArtist, { color: muted }]}>{t('theme.preview.fiveSongs')}</Text>
                                <View style={styles.detailActions}>
                                    <View style={[styles.detailPill, { backgroundColor: chipBg }]}>
                                        <Play size={10} color={fg} />
                                        <Text style={[styles.detailPillText, { color: fg }]}>{t('theme.preview.play')}</Text>
                                    </View>
                                    <View style={[styles.detailPill, { backgroundColor: chipBg }]}>
                                        <Shuffle size={10} color={fg} />
                                        <Text style={[styles.detailPillText, { color: fg }]}>{t('theme.preview.shuffle')}</Text>
                                    </View>
                                </View>
                            </View>

                            <View style={styles.songList}>
                                {PREVIEW_TRACKS.slice(0, 3).map((s) => (
                                    <View key={s.id} style={styles.songRow}>
                                        <Image source={s.cover} style={styles.songArt} resizeMode="cover" />
                                        <View style={{ flex: 1, marginLeft: 8 }}>
                                            <Text style={[styles.songTitle, { color: fg }]} numberOfLines={1}>
                                                {s.title}
                                            </Text>
                                            <Text style={[styles.songArtist, { color: muted }]} numberOfLines={1}>
                                                {s.artist}
                                            </Text>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        </View>
                    )
                )}
            </View>
        );
    }
);

const styles = StyleSheet.create({
    phoneFrame: {
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1.5,
    },
    fill: {
        flex: 1,
    },
    bgImage: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
    },
    inner: {
        flex: 1,
        padding: 12,
    },
    miniHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    miniBrand: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    miniLogo: {
        width: 16,
        height: 16,
        borderRadius: 4,
    },
    miniBrandText: {
        fontSize: 11,
        fontWeight: '800',
    },
    miniIcons: {
        flexDirection: 'row',
        gap: 7,
    },
    miniTabs: {
        flexDirection: 'row',
        gap: 12,
        paddingBottom: 5,
        borderBottomWidth: 1,
        marginBottom: 10,
    },
    miniTabActive: {
        borderBottomWidth: 2,
        paddingBottom: 3,
    },
    miniTabText: {
        fontSize: 9.5,
    },
    songList: {
        flex: 1,
        gap: 9,
    },
    songRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    songArt: {
        width: 26,
        height: 26,
        borderRadius: 5,
    },
    songTitle: {
        fontSize: 10,
        fontWeight: '700',
    },
    songArtist: {
        fontSize: 8.5,
        marginTop: 1,
    },
    miniPlayer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 7,
        borderRadius: 10,
        marginTop: 6,
    },
    miniPlayerArt: {
        width: 22,
        height: 22,
        borderRadius: 4,
    },
    detailHero: {
        alignItems: 'center',
        paddingTop: 6,
        marginBottom: 10,
    },
    detailCover: {
        width: 82,
        height: 82,
        borderRadius: 14,
        marginBottom: 8,
    },
    detailTitle: {
        fontSize: 12,
        fontWeight: '800',
    },
    detailActions: {
        flexDirection: 'row',
        gap: 6,
        marginTop: 8,
    },
    detailPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 999,
    },
    detailPillText: {
        fontSize: 9,
        fontWeight: '700',
    },
});
