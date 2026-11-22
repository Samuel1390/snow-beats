import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Maximize2 } from 'lucide-react-native';
import { usePlayerProgress } from '../../audio-engine/PlayerContext';
import { findActiveLyricIndex, ParsedLyrics } from '../../audio-engine/lyricsParser';

interface LyricsTickerProps {
    lyrics: ParsedLyrics;
    onPress: () => void;
}

// Carrusel vertical compacto debajo del título con altura fija para evitar cualquier layout shift
export const LyricsTicker: React.FC<LyricsTickerProps> = React.memo(({ lyrics, onPress }) => {
    const { position } = usePlayerProgress();

    const activeIndex = useMemo(() => {
        if (!lyrics.isSynced) return -1;
        const idx = findActiveLyricIndex(lyrics.lines, position);
        return idx >= 0 ? idx : 0;
    }, [lyrics, position]);

    const currentLine = lyrics.isSynced
        ? lyrics.lines[activeIndex]?.text ?? ''
        : lyrics.lines[0]?.text ?? '';
    const nextLine = lyrics.isSynced
        ? lyrics.lines[activeIndex + 1]?.text ?? ''
        : lyrics.lines[1]?.text ?? '';

    const slideAnim = useRef(new Animated.Value(0)).current;
    const opacityAnim = useRef(new Animated.Value(1)).current;
    const prevIdxRef = useRef(activeIndex);

    // Anima de abajo hacia arriba únicamente cuando existen marcas de tiempo sincronizadas
    useEffect(() => {
        if (!lyrics.isSynced || activeIndex < 0) return;
        if (prevIdxRef.current === activeIndex) return;
        prevIdxRef.current = activeIndex;

        slideAnim.setValue(18);
        opacityAnim.setValue(0.25);
        Animated.parallel([
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 240,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
                toValue: 1,
                duration: 220,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }),
        ]).start();
    }, [activeIndex, lyrics.isSynced, slideAnim, opacityAnim]);

    if (!currentLine) return null;

    return (
        <TouchableOpacity style={styles.card} activeOpacity={0.82} onPress={onPress}>
            <View style={styles.textClip}>
                {lyrics.isSynced ? (
                    <Animated.View
                        style={[
                            styles.linesContainer,
                            {
                                opacity: opacityAnim,
                                transform: [{ translateY: slideAnim }],
                            },
                        ]}
                    >
                        <Text style={styles.activeLine} numberOfLines={2} ellipsizeMode="tail">
                            {currentLine}
                        </Text>
                        <Text style={styles.nextLine} numberOfLines={1} ellipsizeMode="tail">
                            {nextLine || ' '}
                        </Text>
                    </Animated.View>
                ) : (
                    // Sin marcas de tiempo: no se resalta ninguna línea durante la reproducción (control manual)
                    <View style={styles.linesContainer}>
                        <Text style={styles.manualLine} numberOfLines={1} ellipsizeMode="tail">
                            {currentLine}
                        </Text>
                        <Text style={styles.manualLine} numberOfLines={1} ellipsizeMode="tail">
                            {nextLine || 'Toca para desplazar la letra manualmente'}
                        </Text>
                    </View>
                )}
            </View>
            <View style={styles.expandBadge}>
                <Maximize2 size={14} color="rgba(255,255,255,0.82)" />
            </View>
        </TouchableOpacity>
    );
});

const styles = StyleSheet.create({
    // Altura fija exacta (2 líneas activas = 40px + 1 línea siguiente = 19px + padding 20px + borde 2px)
    card: {
        marginTop: 12,
        height: 82,
        backgroundColor: 'rgba(0, 0, 0, 0.28)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.12)',
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
    },
    textClip: {
        flex: 1,
        height: 60,
        overflow: 'hidden',
        justifyContent: 'center',
    },
    linesContainer: {
        height: 60,
        justifyContent: 'center',
    },
    activeLine: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '800',
        lineHeight: 20,
        maxHeight: 40,
        textShadowColor: 'rgba(0, 0, 0, 0.35)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    nextLine: {
        color: 'rgba(255, 255, 255, 0.52)',
        fontSize: 12.5,
        fontWeight: '600',
        lineHeight: 17,
        height: 17,
        marginTop: 3,
    },
    manualLine: {
        color: 'rgba(255, 255, 255, 0.72)',
        fontSize: 13.5,
        fontWeight: '500',
        lineHeight: 20,
    },
    expandBadge: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: 'rgba(255, 255, 255, 0.12)',
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 10,
    },
});
