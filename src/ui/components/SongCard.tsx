import React, { useEffect, useRef } from 'react';
import {
    Animated,
    Easing,
    Image,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Check, Music } from 'lucide-react-native';
import { Track } from '../../types/music';
import { useTheme } from '../../theme/ThemeContext';

interface SongCardProps {
    track: Track;
    onPress: (track: Track) => void;
    highlightQuery?: string;
    selected?: boolean;
    onLongPress?: (track: Track) => void;
    onArtworkPress?: (track: Track) => void;
}

function HighlightedText({ text, query, style }: { text: string; query?: string; style: any }) {
    if (!query?.trim()) {
        return <Text style={style} numberOfLines={1}>{text}</Text>;
    }
    const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return (
        <Text style={style} numberOfLines={1}>
            {parts.map((part, i) =>
                part.toLowerCase() === query.trim().toLowerCase() ? (
                    <Text key={i} style={{ color: '#38BDF8', fontWeight: '700' }}>{part}</Text>
                ) : (
                    part
                )
            )}
        </Text>
    );
}

export const SongCard: React.FC<SongCardProps> = React.memo(
    ({ track, onPress, highlightQuery, selected = false, onLongPress, onArtworkPress }) => {
        const { fgColor, mutedColor } = useTheme();
        const selectAnim = useRef(new Animated.Value(selected ? 1 : 0)).current;
        const pressScale = useRef(new Animated.Value(1)).current;

        // Fade-in suave al azul al seleccionar y fade-out al deseleccionar
        useEffect(() => {
            Animated.timing(selectAnim, {
                toValue: selected ? 1 : 0,
                duration: selected ? 200 : 180,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false,
            }).start();
        }, [selected, selectAnim]);

        const bgColor = selectAnim.interpolate({
            inputRange: [0, 1],
            outputRange: ['rgba(56, 189, 248, 0)', 'rgba(56, 189, 248, 0.20)'],
        });

        const borderColor = selectAnim.interpolate({
            inputRange: [0, 1],
            outputRange: ['rgba(56, 189, 248, 0)', '#38BDF8'],
        });

        const checkScale = selectAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.55, 1],
        });

        const handlePressIn = () => {
            Animated.timing(pressScale, {
                toValue: 0.985,
                duration: 90,
                useNativeDriver: true,
            }).start();
        };

        const handlePressOut = () => {
            Animated.spring(pressScale, {
                toValue: 1,
                damping: 18,
                stiffness: 260,
                useNativeDriver: true,
            }).start();
        };

        const artworkContent = (
            <Animated.View style={[styles.artworkBox, { borderColor, borderWidth: selected ? 2 : 0 }]}>
                {track.artworkUri ? (
                    <Image source={{ uri: track.artworkUri }} style={styles.artwork} />
                ) : (
                    <Music size={22} color="#9CA3AF" />
                )}
                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.checkOverlay,
                        { opacity: selectAnim },
                    ]}
                >
                    <Animated.View style={{ transform: [{ scale: checkScale }] }}>
                        <Check size={20} color="#FFFFFF" strokeWidth={3} />
                    </Animated.View>
                </Animated.View>
            </Animated.View>
        );

        return (
            <Animated.View style={{ backgroundColor: bgColor }}>
                <Animated.View style={{ transform: [{ scale: pressScale }] }}>
                    <TouchableOpacity
                        style={styles.container}
                        onPress={() => onPress(track)}
                        onPressIn={handlePressIn}
                        onPressOut={handlePressOut}
                        activeOpacity={0.85}
                        onLongPress={() => onLongPress?.(track)}
                    >
                        {/* Carátula seleccionable al tocar o ícono por defecto */}
                        {onArtworkPress ? (
                            <TouchableOpacity
                                onPress={() => onArtworkPress(track)}
                                activeOpacity={0.8}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                                {artworkContent}
                            </TouchableOpacity>
                        ) : (
                            artworkContent
                        )}

                        {/* Título, etiqueta de letras (si aplica) y artista */}
                        <View style={styles.infoBox}>
                            <HighlightedText
                                text={track.title}
                                query={highlightQuery}
                                style={[styles.title, { color: fgColor }]}
                            />

                            <View style={styles.subtitleRow}>
                                {track.hasLyrics && (
                                    <View style={styles.lyricsBadge}>
                                        <Text style={styles.lyricsText}>Letras</Text>
                                    </View>
                                )}
                                <HighlightedText
                                    text={track.artist}
                                    query={highlightQuery}
                                    style={[styles.artist, { color: mutedColor }]}
                                />
                            </View>
                        </View>
                    </TouchableOpacity>
                </Animated.View>
            </Animated.View>
        );
    }
);

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    artworkBox: {
        width: 48,
        height: 48,
        borderRadius: 8,
        backgroundColor: '#1F2937',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        marginRight: 12,
    },
    checkOverlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: 'rgba(2, 132, 199, 0.72)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    artwork: {
        width: '100%',
        height: '100%',
    },
    infoBox: {
        flex: 1,
        justifyContent: 'center',
    },
    title: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '600',
    },
    subtitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 3,
    },
    lyricsBadge: {
        backgroundColor: '#374151',
        borderRadius: 4,
        paddingHorizontal: 5,
        paddingVertical: 1,
        marginRight: 6,
    },
    lyricsText: {
        color: '#E5E7EB',
        fontSize: 10,
        fontWeight: '600',
    },
    artist: {
        color: 'rgba(255, 255, 255, 0.7)',
        fontSize: 13,
        flexShrink: 1,
    },
});