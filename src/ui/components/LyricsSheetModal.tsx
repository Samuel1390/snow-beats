import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Modal,
    PanResponder,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { ChevronDown, Pause, Pencil, Play, Share2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer, usePlayerProgress } from '../../audio-engine/PlayerContext';
import { findActiveLyricIndex, LyricLine, ParsedLyrics } from '../../audio-engine/lyricsParser';
import { getLyricsSurfacePalette } from '../../theme/colorContrast';
import { Track } from '../../types/music';

interface LyricsSheetModalProps {
    visible: boolean;
    track: Track;
    lyrics: ParsedLyrics;
    onClose: () => void;
    onOpenShareLyrics: (initialLineIndex?: number) => void;
    onOpenEditLyrics?: () => void;
}

function formatTime(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

// Barra de progreso aislada para que el progreso cada 400ms no re-renderice el modal entero
const LyricsMiniSeekBar: React.FC<{ onSeek: (sec: number) => void }> = React.memo(({ onSeek }) => {
    const { position, duration } = usePlayerProgress();
    return (
        <View style={styles.seekWrap}>
            <Slider
                minimumValue={0}
                maximumValue={Math.max(duration, 1)}
                value={Math.min(position, Math.max(duration, 1))}
                onSlidingComplete={onSeek}
                minimumTrackTintColor="#FFFFFF"
                maximumTrackTintColor="rgba(255,255,255,0.28)"
                thumbTintColor="#FFFFFF"
            />
            <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatTime(position)}</Text>
                <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>
        </View>
    );
});

// Lista de líneas sincronizada de forma aislada con auto-scroll suave
const SyncedLyricsList: React.FC<{
    lyrics: ParsedLyrics;
    palette: ReturnType<typeof getLyricsSurfacePalette>;
    onSeek: (sec: number) => void;
    onActiveIndexChange: (idx: number) => void;
}> = React.memo(({ lyrics, palette, onSeek, onActiveIndexChange }) => {
    const { position } = usePlayerProgress();
    const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
    const lineYRef = useRef<Record<number, number>>({});
    const userScrollingUntilRef = useRef<number>(0);
    const viewportHeightRef = useRef<number>(420);

    const activeIndex = useMemo(() => {
        if (!lyrics.isSynced) return -1;
        return findActiveLyricIndex(lyrics.lines, position);
    }, [lyrics, position]);

    useEffect(() => {
        onActiveIndexChange(activeIndex);
    }, [activeIndex, onActiveIndexChange]);

    // Auto-scroll suave manteniendo la línea actual en el tercio superior (respetando scroll manual)
    useEffect(() => {
        if (!lyrics.isSynced || activeIndex < 0) return;
        if (Date.now() < userScrollingUntilRef.current) return;
        const targetY = lineYRef.current[activeIndex];
        if (typeof targetY === 'number') {
            const offset = Math.max(0, targetY - viewportHeightRef.current * 0.3);
            scrollRef.current?.scrollTo({ y: offset, animated: true });
        }
    }, [activeIndex, lyrics.isSynced]);

    const handleManualTouch = useCallback(() => {
        userScrollingUntilRef.current = Date.now() + 3500;
    }, []);

    return (
        <ScrollView
            ref={scrollRef}
            style={styles.lyricsScroll}
            contentContainerStyle={styles.lyricsContent}
            showsVerticalScrollIndicator={false}
            onScrollBeginDrag={handleManualTouch}
            onMomentumScrollBegin={handleManualTouch}
            onLayout={(e) => {
                viewportHeightRef.current = e.nativeEvent.layout.height;
            }}
        >
            {!lyrics.isSynced && (
                <Text style={styles.manualNotice}>
                    Sin marcas de tiempo · desplazamiento manual
                </Text>
            )}
            {lyrics.lines.map((line: LyricLine, idx: number) => {
                const isActive = lyrics.isSynced && idx === activeIndex;
                const isPast = lyrics.isSynced && activeIndex >= 0 && idx < activeIndex;
                const textColor = !lyrics.isSynced
                    ? 'rgba(255, 255, 255, 0.80)'
                    : isActive
                    ? palette.activeText
                    : isPast
                    ? palette.pastText
                    : palette.upcomingText;

                if (!lyrics.isSynced) {
                    return (
                        <View key={line.id} style={styles.lineTouchable}>
                            <Text style={[styles.lyricTextManual, { color: textColor }]}>
                                {line.text}
                            </Text>
                        </View>
                    );
                }

                return (
                    <TouchableOpacity
                        key={line.id}
                        activeOpacity={0.72}
                        onLayout={(e) => {
                            lineYRef.current[idx] = e.nativeEvent.layout.y;
                        }}
                        onPress={() => {
                            if (line.timeSec !== null) {
                                userScrollingUntilRef.current = 0;
                                onSeek(line.timeSec);
                            }
                        }}
                        style={styles.lineTouchable}
                    >
                        <Text
                            style={[
                                styles.lyricText,
                                { color: textColor },
                                isActive && styles.lyricTextActive,
                            ]}
                        >
                            {line.text}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </ScrollView>
    );
});

export const LyricsSheetModal: React.FC<LyricsSheetModalProps> = React.memo(
    ({ visible, track, lyrics, onClose, onOpenShareLyrics, onOpenEditLyrics }) => {
        const { isPlaying, togglePlayPause, seekTo } = usePlayer();
        const { height: screenHeight } = useWindowDimensions();
        const insets = useSafeAreaInsets();
        const [mounted, setMounted] = useState(visible);

        const slideAnim = useRef(new Animated.Value(0)).current;
        const dragY = useRef(new Animated.Value(0)).current;
        const isClosingRef = useRef(false);
        const prevVisibleRef = useRef(false);
        const activeIndexRef = useRef(0);

        const palette = useMemo(
            () => getLyricsSurfacePalette(track.dominantColor),
            [track.dominantColor]
        );

        const handleActiveIndexChange = useCallback((idx: number) => {
            if (idx >= 0) activeIndexRef.current = idx;
        }, []);

        useEffect(() => {
            const wasVisible = prevVisibleRef.current;
            prevVisibleRef.current = visible;
            let rafId: number | null = null;

            if (visible && !wasVisible) {
                isClosingRef.current = false;
                dragY.setValue(0);
                slideAnim.setValue(0);
                setMounted(true);
                rafId = requestAnimationFrame(() => {
                    Animated.timing(slideAnim, {
                        toValue: 1,
                        duration: 280,
                        easing: Easing.out(Easing.cubic),
                        useNativeDriver: true,
                    }).start();
                });
            } else if (!visible && wasVisible && !isClosingRef.current) {
                Animated.timing(slideAnim, {
                    toValue: 0,
                    duration: 220,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }).start(({ finished }) => {
                    if (finished) setMounted(false);
                });
            }

            return () => {
                if (rafId !== null) cancelAnimationFrame(rafId);
            };
        }, [visible, slideAnim, dragY]);

        const animateClose = useCallback(() => {
            if (isClosingRef.current) return;
            isClosingRef.current = true;
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 230,
                easing: Easing.in(Easing.cubic),
                useNativeDriver: true,
            }).start(() => {
                dragY.setValue(0);
                setMounted(false);
                isClosingRef.current = false;
                onClose();
            });
        }, [slideAnim, dragY, onClose]);

        // Permite cerrar deslizando hacia abajo desde la cabecera de la hoja de letras
        const headerPanResponder = useMemo(
            () =>
                PanResponder.create({
                    onMoveShouldSetPanResponder: (_, gs) =>
                        gs.dy > 8 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.2,
                    onPanResponderMove: (_, gs) => {
                        dragY.setValue(Math.max(0, gs.dy));
                    },
                    onPanResponderRelease: (_, gs) => {
                        if (gs.dy > 80 || gs.vy > 0.5) {
                            animateClose();
                        } else {
                            Animated.spring(dragY, {
                                toValue: 0,
                                damping: 22,
                                stiffness: 260,
                                useNativeDriver: true,
                            }).start();
                        }
                    },
                }),
            [dragY, animateClose]
        );

        if (!mounted) return null;

        const translateY = Animated.add(
            slideAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [screenHeight, 0],
            }),
            dragY
        );

        return (
            <Modal
                visible={mounted}
                transparent
                animationType="none"
                statusBarTranslucent
                onRequestClose={animateClose}
            >
                <Animated.View style={[styles.sheetRoot, { transform: [{ translateY }] }]}>
                    <LinearGradient
                        colors={[palette.topColor, palette.bottomColor]}
                        style={[
                            styles.gradientBg,
                            {
                                paddingTop: Math.max(insets.top, 28) + 6,
                                paddingBottom: Math.max(insets.bottom, 16) + 12,
                            },
                        ]}
                    >
                        {/* Cabecera arrastrable para cerrar */}
                        <View {...headerPanResponder.panHandlers} style={styles.header}>
                            <TouchableOpacity style={styles.headerIconBtn} onPress={animateClose}>
                                <ChevronDown size={28} color="#FFFFFF" />
                            </TouchableOpacity>
                            <View style={styles.headerCenter}>
                                <Text style={styles.headerTitle} numberOfLines={1}>
                                    {track.title}
                                </Text>
                                <Text style={styles.headerArtist} numberOfLines={1}>
                                    {track.artist}
                                </Text>
                            </View>
                            <View style={styles.headerRightGroup}>
                                {onOpenEditLyrics && (
                                    <TouchableOpacity
                                        style={styles.headerIconBtn}
                                        onPress={onOpenEditLyrics}
                                    >
                                        <Pencil size={19} color="#FFFFFF" />
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                    style={styles.headerIconBtn}
                                    onPress={() => onOpenShareLyrics(activeIndexRef.current)}
                                >
                                    <Share2 size={21} color="#FFFFFF" />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Listado de letras en tiempo real */}
                        <SyncedLyricsList
                            lyrics={lyrics}
                            palette={palette}
                            onSeek={seekTo}
                            onActiveIndexChange={handleActiveIndexChange}
                        />

                        {/* Controles inferiores y botón Compartir (estilo Spotify) */}
                        <View style={styles.bottomArea}>
                            <TouchableOpacity
                                style={[styles.sharePill, { backgroundColor: palette.accentPillBg }]}
                                activeOpacity={0.8}
                                onPress={() => onOpenShareLyrics(activeIndexRef.current)}
                            >
                                <Share2 size={16} color="#FFFFFF" />
                                <Text style={styles.sharePillText}>Compartir</Text>
                            </TouchableOpacity>

                            <LyricsMiniSeekBar onSeek={seekTo} />

                            <TouchableOpacity
                                style={styles.playBtn}
                                activeOpacity={0.85}
                                onPress={togglePlayPause}
                            >
                                {isPlaying ? (
                                    <Pause size={30} color="#000000" />
                                ) : (
                                    <Play size={30} color="#000000" />
                                )}
                            </TouchableOpacity>
                        </View>
                    </LinearGradient>
                </Animated.View>
            </Modal>
        );
    }
);

const styles = StyleSheet.create({
    sheetRoot: {
        flex: 1,
    },
    gradientBg: {
        flex: 1,
        paddingHorizontal: 22,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    headerIconBtn: {
        width: 38,
        height: 38,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerRightGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    headerCenter: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    headerTitle: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },
    headerArtist: {
        color: 'rgba(255, 255, 255, 0.72)',
        fontSize: 13,
        marginTop: 2,
    },
    lyricsScroll: {
        flex: 1,
    },
    lyricsContent: {
        paddingTop: 18,
        paddingBottom: 90,
    },
    manualNotice: {
        color: 'rgba(255, 255, 255, 0.56)',
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 10,
    },
    lineTouchable: {
        paddingVertical: 10,
    },
    lyricText: {
        fontSize: 22,
        fontWeight: '700',
        lineHeight: 31,
    },
    lyricTextManual: {
        fontSize: 20,
        fontWeight: '500',
        lineHeight: 30,
    },
    lyricTextActive: {
        fontSize: 25,
        fontWeight: '800',
        lineHeight: 34,
        textShadowColor: 'rgba(0, 0, 0, 0.35)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    bottomArea: {
        paddingTop: 10,
    },
    sharePill: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 9,
        borderRadius: 999,
        marginBottom: 8,
    },
    sharePillText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '700',
    },
    seekWrap: {
        marginBottom: 6,
    },
    timeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 4,
    },
    timeText: {
        color: 'rgba(255,255,255,0.72)',
        fontSize: 12,
    },
    playBtn: {
        alignSelf: 'center',
        width: 62,
        height: 62,
        borderRadius: 31,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 4,
    },
});
