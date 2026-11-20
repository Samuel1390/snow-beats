import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Modal,
    View,
    Text,
    Image,
    TouchableOpacity,
    StyleSheet,
    Alert,
    Switch,
    Animated,
    Easing,
    PanResponder,
    useWindowDimensions,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import {
    ChevronDown,
    Heart,
    MoreVertical,
    SkipBack,
    SkipForward,
    Play,
    Pause,
    Sliders,
    FileText,
    Repeat,
    Repeat1,
    Shuffle,
    Music,
    Plus,
    Forward,
    Gauge,
    BellRing,
    AlarmClock,
    EyeOff,
    Trash2,
    Share2,
} from 'lucide-react-native';
import { usePlayer, usePlayerProgress } from '../../audio-engine/PlayerContext';
import { loadTrackLyrics, ParsedLyrics } from '../../audio-engine/lyricsParser';
import { getDynamicPlayerPalette } from '../../theme/colorContrast';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { AnimatedBottomSheet } from '../components/AnimatedBottomSheet';
import { LyricsTicker } from '../components/LyricsTicker';
import { LyricsSheetModal } from '../components/LyricsSheetModal';
import { ShareCardModal } from '../components/ShareCardModal';

function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Seekbar aislado: únicamente este subcomponente se actualiza cada 400ms durante la reproducción
const PlayerSeekBar: React.FC<{
    foreground: string;
    muted: string;
    onSeek: (sec: number) => void;
    onSlidingStart: () => void;
    onSlidingEnd: () => void;
}> = React.memo(({ foreground, muted, onSeek, onSlidingStart, onSlidingEnd }) => {
    const { position, duration } = usePlayerProgress();
    const [draggingPos, setDraggingPos] = useState<number | null>(null);

    return (
        <View style={styles.seekBox}>
            <Slider
                minimumValue={0}
                maximumValue={Math.max(1, duration)}
                value={draggingPos ?? position}
                onSlidingStart={onSlidingStart}
                onValueChange={(val) => setDraggingPos(val)}
                onSlidingComplete={(val) => {
                    onSeek(val);
                    setDraggingPos(null);
                    onSlidingEnd();
                }}
                minimumTrackTintColor={foreground}
                maximumTrackTintColor="rgba(255,255,255,0.25)"
                thumbTintColor={foreground}
            />
            <View style={styles.timeRow}>
                <Text style={[styles.timeText, { color: muted }]}>
                    {formatTime(draggingPos ?? position)}
                </Text>
                <Text style={[styles.timeText, { color: muted }]}>
                    {formatTime(duration)}
                </Text>
            </View>
        </View>
    );
});

interface FullPlayerModalProps {
    visible: boolean;
    onClose: () => void;
    onPlaylistUpdated?: () => void;
    onTrackMutated?: () => void;
}

export const FullPlayerModal: React.FC<FullPlayerModalProps> = React.memo(
    ({ visible, onClose, onPlaylistUpdated, onTrackMutated }) => {
        const {
            currentTrack,
            isPlaying,
            repeatMode,
            playbackRate,
            pitch,
            togglePlayPause,
            playNext,
            playPrevious,
            seekTo,
            cycleRepeatMode,
            setSpeed,
            setPitchValue,
            toggleFavorite,
            hideCurrentTrack,
            deleteCurrentTrack,
        } = usePlayer();

        const { width: screenWidth, height: screenHeight } = useWindowDimensions();
        const [mounted, setMounted] = useState(visible);
        const [menuOpen, setMenuOpen] = useState(false);
        const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
        const [speedOpen, setSpeedOpen] = useState(false);
        const [deleteOpen, setDeleteOpen] = useState(false);
        const [askDeleteAgain, setAskDeleteAgain] = useState(true);
        const [parsedLyrics, setParsedLyrics] = useState<ParsedLyrics | null>(null);
        const [lyricsSheetOpen, setLyricsSheetOpen] = useState(false);
        const [shareModalState, setShareModalState] = useState<{
            open: boolean;
            mode: 'song' | 'lyrics';
            step: 'select_lyrics' | 'preview';
            lineIndex: number;
        }>({ open: false, mode: 'song', step: 'preview', lineIndex: 0 });

        const openAnim = useRef(new Animated.Value(0)).current;
        const dragY = useRef(new Animated.Value(0)).current;
        const heartScale = useRef(new Animated.Value(1)).current;
        const playScale = useRef(new Animated.Value(1)).current;
        const isClosingRef = useRef(false);
        const isSlidingRef = useRef(false);
        const prevVisibleRef = useRef(false);

        // Carga perezosa de letras incrustadas/.lrc (con caché en RAM + SQLite) solo para la pista activa
        useEffect(() => {
            let cancelled = false;
            if (!visible || !currentTrack) {
                return;
            }
            setParsedLyrics(null);
            loadTrackLyrics(currentTrack)
                .then((res) => {
                    if (!cancelled) setParsedLyrics(res);
                })
                .catch(() => { });
            return () => {
                cancelled = true;
            };
        }, [visible, currentTrack?.id]);

        // Slide-in fluido de abajo hacia arriba (solo se dispara al transicionar visible false -> true)
        useEffect(() => {
            const wasVisible = prevVisibleRef.current;
            prevVisibleRef.current = visible;
            let rafId: number | null = null;

            if (visible && !wasVisible && currentTrack) {
                isClosingRef.current = false;
                dragY.setValue(0);
                openAnim.setValue(0);
                setMounted(true);
                rafId = requestAnimationFrame(() => {
                    Animated.timing(openAnim, {
                        toValue: 1,
                        duration: 280,
                        easing: Easing.out(Easing.cubic),
                        useNativeDriver: true,
                    }).start();
                });
            } else if (!visible && wasVisible && !isClosingRef.current) {
                Animated.timing(openAnim, {
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
        }, [visible, currentTrack, openAnim, dragY]);

        // Cierre inverso (slide-out de arriba hacia abajo devolviendo carátula, título y artista)
        const animateClose = useCallback(() => {
            if (isClosingRef.current) return;
            isClosingRef.current = true;
            Animated.parallel([
                Animated.timing(openAnim, {
                    toValue: 0,
                    duration: 230,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(dragY, {
                    toValue: 0,
                    duration: 230,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
            ]).start(() => {
                setMounted(false);
                isClosingRef.current = false;
                onClose();
            });
        }, [openAnim, dragY, onClose]);

        // Gesto de deslizar hacia abajo desde CUALQUIER parte de la pantalla (protegiendo el slider horizontal)
        const panResponder = useMemo(
            () =>
                PanResponder.create({
                    onMoveShouldSetPanResponderCapture: (_, gs) => {
                        if (isSlidingRef.current) return false;
                        return gs.dy > 8 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.15;
                    },
                    onPanResponderMove: (_, gs) => {
                        dragY.setValue(Math.max(0, gs.dy));
                    },
                    onPanResponderRelease: (_, gs) => {
                        if (gs.dy > 95 || gs.vy > 0.55) {
                            isClosingRef.current = true;
                            Animated.parallel([
                                Animated.timing(dragY, {
                                    toValue: screenHeight,
                                    duration: 210,
                                    easing: Easing.in(Easing.cubic),
                                    useNativeDriver: true,
                                }),
                                Animated.timing(openAnim, {
                                    toValue: 0,
                                    duration: 210,
                                    easing: Easing.in(Easing.cubic),
                                    useNativeDriver: true,
                                }),
                            ]).start(() => {
                                dragY.setValue(0);
                                setMounted(false);
                                isClosingRef.current = false;
                                onClose();
                            });
                        } else {
                            Animated.spring(dragY, {
                                toValue: 0,
                                damping: 22,
                                stiffness: 260,
                                useNativeDriver: true,
                            }).start();
                        }
                    },
                    onPanResponderTerminate: () => {
                        Animated.spring(dragY, {
                            toValue: 0,
                            damping: 22,
                            stiffness: 260,
                            useNativeDriver: true,
                        }).start();
                    },
                }),
            [dragY, openAnim, screenHeight, onClose]
        );

        const handleSlidingStart = useCallback(() => {
            isSlidingRef.current = true;
        }, []);

        const handleSlidingEnd = useCallback(() => {
            isSlidingRef.current = false;
        }, []);

        const palette = useMemo(
            () => getDynamicPlayerPalette(currentTrack?.dominantColor),
            [currentTrack?.dominantColor]
        );

        if (!currentTrack || !mounted) return null;

        const RepeatIcon =
            repeatMode === 'repeat_one' ? Repeat1 : repeatMode === 'shuffle' ? Shuffle : Repeat;

        // Progreso combinado: al deslizar hacia abajo se invierte la coreografía de carátula, título y artista
        const dragProgress = dragY.interpolate({
            inputRange: [0, Math.max(260, screenHeight * 0.5)],
            outputRange: [0, 1],
            extrapolate: 'clamp',
        });

        const sheetTranslateY = Animated.add(
            openAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [screenHeight, 0],
            }),
            dragY
        );

        const artScale = Animated.multiply(
            openAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.68, 1],
            }),
            dragProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0.76],
            })
        );

        const artTranslateY = Animated.add(
            openAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [76, 0],
            }),
            dragProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 56],
            })
        );

        const metaTranslateY = Animated.add(
            openAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [44, 0],
            }),
            dragProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 36],
            })
        );

        const metaTranslateX = openAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [-18, 0],
        });

        const controlsTranslateY = openAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [30, 0],
        });

        const backdropOpacity = Animated.multiply(
            openAnim,
            dragProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0.2],
            })
        );

        const handleToggleFavorite = () => {
            Animated.sequence([
                Animated.timing(heartScale, { toValue: 1.32, duration: 100, useNativeDriver: true }),
                Animated.spring(heartScale, { toValue: 1, damping: 12, stiffness: 260, useNativeDriver: true }),
            ]).start();
            toggleFavorite();
        };

        const handleTogglePlay = () => {
            Animated.sequence([
                Animated.timing(playScale, { toValue: 0.88, duration: 80, useNativeDriver: true }),
                Animated.spring(playScale, { toValue: 1, damping: 14, stiffness: 260, useNativeDriver: true }),
            ]).start();
            togglePlayPause();
        };

        const handleShare = async () => {
            setMenuOpen(false);
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(currentTrack.uri);
            } else {
                Alert.alert('Compartir', 'No disponible en este dispositivo.');
            }
        };

        const handleDeletePress = () => {
            setMenuOpen(false);
            if (!askDeleteAgain) {
                deleteCurrentTrack().then(() => onTrackMutated?.());
            } else {
                setDeleteOpen(true);
            }
        };

        return (
            <Modal
                visible={mounted}
                transparent
                animationType="none"
                statusBarTranslucent
                onRequestClose={animateClose}
            >
                <View style={styles.modalRoot}>
                    <Animated.View style={[styles.dimBg, { opacity: backdropOpacity }]} />

                    {/* PanResponder en TODO el contenedor para cerrar deslizando desde cualquier punto */}
                    <Animated.View
                        {...panResponder.panHandlers}
                        style={[
                            styles.container,
                            {
                                backgroundColor: palette.background,
                                transform: [{ translateY: sheetTranslateY }],
                            },
                        ]}
                    >
                        <LinearGradient
                            colors={[palette.background, palette.backgroundBottom]}
                            style={StyleSheet.absoluteFill}
                        />
                        <View>
                            <View style={styles.dragPill} />
                            <TouchableOpacity onPress={animateClose} style={styles.topBtn}>
                                <ChevronDown size={28} color={palette.foreground} />
                            </TouchableOpacity>

                            {/* Carátula grande con transición fluida de escala y posición */}
                            <Animated.View
                                style={[
                                    styles.artWrapper,
                                    parsedLyrics && {
                                        width: Math.min(screenWidth - 48, Math.round(screenHeight * 0.36)),
                                        alignSelf: 'center',
                                    },
                                    {
                                        opacity: openAnim,
                                        transform: [{ translateY: artTranslateY }, { scale: artScale }],
                                    },
                                ]}
                            >
                                {currentTrack.artworkUri ? (
                                    <Image source={{ uri: currentTrack.artworkUri }} style={styles.art} />
                                ) : (
                                    <Music size={90} color="#52525B" />
                                )}
                            </Animated.View>

                            {/* Información (título y artista) + Favorito + Menú 3 puntos */}
                            <Animated.View
                                style={[
                                    styles.infoRow,
                                    {
                                        opacity: openAnim,
                                        transform: [{ translateY: metaTranslateY }, { translateX: metaTranslateX }],
                                    },
                                ]}
                            >
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.title, { color: palette.foreground }]} numberOfLines={1}>
                                        {currentTrack.title}
                                    </Text>
                                    <Text style={[styles.artist, { color: palette.muted }]} numberOfLines={1}>
                                        {currentTrack.artist}
                                    </Text>
                                </View>
                                <Animated.View style={{ transform: [{ scale: heartScale }] }}>
                                    <TouchableOpacity style={styles.actionBtn} onPress={handleToggleFavorite}>
                                        <Heart
                                            size={24}
                                            color={currentTrack.isFavorite ? '#EF4444' : palette.foreground}
                                            fill={currentTrack.isFavorite ? '#EF4444' : 'transparent'}
                                        />
                                    </TouchableOpacity>
                                </Animated.View>
                                <TouchableOpacity style={styles.actionBtn} onPress={() => setMenuOpen(true)}>
                                    <MoreVertical size={24} color={palette.foreground} />
                                </TouchableOpacity>
                            </Animated.View>

                            {/* Carrusel vertical de letras en tiempo real debajo del título */}
                            {parsedLyrics && parsedLyrics.lines.length > 0 ? (
                                <Animated.View style={{ opacity: openAnim }}>
                                    <LyricsTicker
                                        lyrics={parsedLyrics}
                                        onPress={() => setLyricsSheetOpen(true)}
                                    />
                                </Animated.View>
                            ) : null}
                        </View>

                        {/* Seekbar aislado y controles */}
                        <Animated.View
                            style={{
                                opacity: openAnim,
                                transform: [{ translateY: controlsTranslateY }],
                            }}
                        >
                            <PlayerSeekBar
                                foreground={palette.foreground}
                                muted={palette.muted}
                                onSeek={seekTo}
                                onSlidingStart={handleSlidingStart}
                                onSlidingEnd={handleSlidingEnd}
                            />

                            {/* Controles centrales */}
                            <View style={styles.controlsRow}>
                                <TouchableOpacity onPress={playPrevious} style={styles.ctrlBtn}>
                                    <SkipBack size={32} color={palette.foreground} />
                                </TouchableOpacity>
                                <Animated.View style={{ transform: [{ scale: playScale }] }}>
                                    <TouchableOpacity onPress={handleTogglePlay} style={styles.playBtn}>
                                        {isPlaying ? (
                                            <Pause size={34} color="#000000" />
                                        ) : (
                                            <Play size={34} color="#000000" />
                                        )}
                                    </TouchableOpacity>
                                </Animated.View>
                                <TouchableOpacity onPress={playNext} style={styles.ctrlBtn}>
                                    <SkipForward size={32} color={palette.foreground} />
                                </TouchableOpacity>
                            </View>
                        </Animated.View>

                        {/* Footer inferior */}
                        <Animated.View style={[styles.footerRow, { opacity: openAnim }]}>
                            <TouchableOpacity
                                style={styles.footerBtn}
                                onPress={() => Alert.alert('Ecualizador', 'Módulo nativo listo para la siguiente fase.')}
                            >
                                <Sliders size={22} color={palette.foreground} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.footerBtn}
                                onPress={() => {
                                    if (parsedLyrics && parsedLyrics.lines.length > 0) {
                                        setLyricsSheetOpen(true);
                                    } else {
                                        Alert.alert(
                                            'Letras',
                                            'Esta canción no tiene letra incrustada ni archivo .lrc asociado.'
                                        );
                                    }
                                }}
                            >
                                <FileText
                                    size={22}
                                    color={parsedLyrics ? '#38BDF8' : palette.foreground}
                                />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.footerBtn}
                                onPress={() =>
                                    setShareModalState({
                                        open: true,
                                        mode: 'song',
                                        step: 'preview',
                                        lineIndex: 0,
                                    })
                                }
                            >
                                <Share2 size={21} color={palette.foreground} />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.footerBtn} onPress={cycleRepeatMode}>
                                <RepeatIcon size={22} color={palette.foreground} />
                            </TouchableOpacity>
                        </Animated.View>

                        {/* Bottom Sheet de opciones con slide-in / slide-out */}
                        <AnimatedBottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
                            <TouchableOpacity
                                style={styles.sheetItem}
                                onPress={() => {
                                    setMenuOpen(false);
                                    setPlaylistModalOpen(true);
                                }}
                            >
                                <Plus size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Agregar a playlist</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.sheetItem}
                                onPress={() => {
                                    setMenuOpen(false);
                                    setShareModalState({
                                        open: true,
                                        mode: 'song',
                                        step: 'preview',
                                        lineIndex: 0,
                                    });
                                }}
                            >
                                <Share2 size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Compartir tarjeta</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.sheetItem} onPress={handleShare}>
                                <Forward size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Compartir archivo de audio</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.sheetItem}
                                onPress={() => {
                                    setMenuOpen(false);
                                    setSpeedOpen(true);
                                }}
                            >
                                <Gauge size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>
                                    Velocidad ({playbackRate}x) y Tono ({pitch}x)
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.sheetItem}
                                onPress={() => {
                                    setMenuOpen(false);
                                    Alert.alert('Tono de llamada', 'Requiere módulo nativo WRITE_SETTINGS.');
                                }}
                            >
                                <BellRing size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Establecer como tono de llamada</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.sheetItem}
                                onPress={() => {
                                    setMenuOpen(false);
                                    Alert.alert('Alarma', 'Requiere módulo nativo de alarma.');
                                }}
                            >
                                <AlarmClock size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Configurar como alarma / Temporizador</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.sheetItem}
                                onPress={() => {
                                    setMenuOpen(false);
                                    hideCurrentTrack().then(() => onTrackMutated?.());
                                }}
                            >
                                <EyeOff size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Ocultar canción</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.sheetItem} onPress={handleDeletePress}>
                                <Trash2 size={20} color="#F87171" />
                                <Text style={[styles.sheetText, { color: '#F87171' }]}>
                                    Eliminar del dispositivo
                                </Text>
                            </TouchableOpacity>
                        </AnimatedBottomSheet>

                        {/* Modal de Velocidad y Tono con slide-in / slide-out */}
                        <AnimatedBottomSheet visible={speedOpen} onClose={() => setSpeedOpen(false)}>
                            <Text style={styles.sheetTitle}>
                                Velocidad: {playbackRate.toFixed(1)}x (tono preservado)
                            </Text>
                            <Slider
                                minimumValue={0.5}
                                maximumValue={2.0}
                                step={0.1}
                                value={playbackRate}
                                onValueChange={(v) => setSpeed(Math.round(v * 10) / 10)}
                                minimumTrackTintColor="#FFFFFF"
                                maximumTrackTintColor="#374151"
                                thumbTintColor="#FFFFFF"
                            />

                            <Text style={[styles.sheetTitle, { marginTop: 16 }]}>
                                Tono (Pitch): {pitch.toFixed(1)}x
                            </Text>
                            <Slider
                                minimumValue={0.5}
                                maximumValue={2.0}
                                step={0.1}
                                value={pitch}
                                onValueChange={(v) => setPitchValue(Math.round(v * 10) / 10)}
                                minimumTrackTintColor="#FFFFFF"
                                maximumTrackTintColor="#374151"
                                thumbTintColor="#FFFFFF"
                            />

                            <TouchableOpacity
                                style={{ alignSelf: 'flex-end', marginTop: 12, padding: 8 }}
                                onPress={() => {
                                    setSpeed(1);
                                    setPitchValue(1);
                                }}
                            >
                                <Text style={{ color: '#38BDF8', fontWeight: '700' }}>Restablecer (1.0x)</Text>
                            </TouchableOpacity>
                        </AnimatedBottomSheet>

                        {/* Modal de confirmación de borrado con switch */}
                        <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => setDeleteOpen(false)}>
                            <View style={styles.centerBackdrop}>
                                <View style={styles.confirmCard}>
                                    <Text style={styles.sheetTitle}>¿Mover a Eliminados recientemente?</Text>
                                    <View style={styles.checkRow}>
                                        <Switch value={askDeleteAgain} onValueChange={setAskDeleteAgain} />
                                        <Text style={{ color: '#D1D5DB', marginLeft: 10 }}>Volver a mostrar este aviso</Text>
                                    </View>
                                    <View style={styles.confirmActions}>
                                        <TouchableOpacity onPress={() => setDeleteOpen(false)}>
                                            <Text style={{ color: '#9CA3AF', padding: 10 }}>Cancelar</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={() => {
                                                setDeleteOpen(false);
                                                deleteCurrentTrack().then(() => onTrackMutated?.());
                                            }}
                                        >
                                            <Text style={{ color: '#F87171', fontWeight: '700', padding: 10 }}>
                                                Mover a papelera
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </View>
                        </Modal>

                        {/* Selector de playlist para la pista actual */}
                        <AddToPlaylistModal
                            visible={playlistModalOpen}
                            trackIds={[currentTrack.id]}
                            onClose={() => setPlaylistModalOpen(false)}
                            onAdded={() => onPlaylistUpdated?.()}
                        />

                        {/* Hoja deslizable de letras sincronizadas en tiempo real */}
                        {parsedLyrics && (
                            <LyricsSheetModal
                                visible={lyricsSheetOpen}
                                track={currentTrack}
                                lyrics={parsedLyrics}
                                onClose={() => setLyricsSheetOpen(false)}
                                onOpenShareLyrics={(lineIdx = 0) => {
                                    setLyricsSheetOpen(false);
                                    setTimeout(() => {
                                        setShareModalState({
                                            open: true,
                                            mode: 'lyrics',
                                            step: 'select_lyrics',
                                            lineIndex: lineIdx,
                                        });
                                    }, 230);
                                }}
                            />
                        )}

                        {/* Constructor y compartidor de tarjetas (Canción y Letra) con marca Snow Beats */}
                        <ShareCardModal
                            visible={shareModalState.open}
                            track={currentTrack}
                            lyrics={parsedLyrics}
                            initialMode={shareModalState.mode}
                            initialStep={shareModalState.step}
                            initialLineIndex={shareModalState.lineIndex}
                            onClose={() => setShareModalState((prev) => ({ ...prev, open: false }))}
                        />
                    </Animated.View>
                </View>
            </Modal>
        );
    }
);

const styles = StyleSheet.create({
    modalRoot: { flex: 1 },
    dimBg: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: '#000000',
    },
    container: {
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: 38,
        paddingBottom: 28,
        justifyContent: 'space-between',
    },
    dragPill: {
        alignSelf: 'center',
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.28)',
        marginBottom: 4,
    },
    topBtn: { alignSelf: 'flex-start', padding: 6, marginBottom: 6 },
    artWrapper: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: 16,
        backgroundColor: '#27272A',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    art: { width: '100%', height: '100%' },
    infoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
    title: { fontSize: 20, fontWeight: '700' },
    artist: { fontSize: 15, marginTop: 4 },
    actionBtn: { padding: 8, marginLeft: 6 },
    seekBox: { marginTop: 10 },
    timeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
    timeText: { fontSize: 12 },
    controlsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 36,
        marginTop: 12,
    },
    ctrlBtn: { padding: 10 },
    playBtn: {
        width: 68,
        height: 68,
        borderRadius: 34,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18 },
    footerBtn: { padding: 10 },
    sheetTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginBottom: 10 },
    sheetItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
    sheetText: { color: '#E5E7EB', fontSize: 15, marginLeft: 14 },
    centerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
    confirmCard: { backgroundColor: '#111827', borderRadius: 14, padding: 20 },
    checkRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
    confirmActions: { flexDirection: 'row', justifyContent: 'flex-end' },
});