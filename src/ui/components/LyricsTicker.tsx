import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Maximize2 } from 'lucide-react-native';
import { usePlayerProgress } from '../../audio-engine/PlayerContext';
import { findActiveLyricIndex, ParsedLyrics } from '../../audio-engine/lyricsParser';

interface LyricsTickerProps {
    lyrics: ParsedLyrics;
    onPress: () => void;
}

// Carrusel vertical compacto debajo del título: muestra la letra sincronizada en tiempo real
export const LyricsTicker: React.FC<LyricsTickerProps> = React.memo(({ lyrics, onPress }) => {
    const { position } = usePlayerProgress();

    const activeIndex = useMemo(() => {
        if (!lyrics.isSynced) return 0;
        const idx = findActiveLyricIndex(lyrics.lines, position);
        return idx >= 0 ? idx : 0;
    }, [lyrics, position]);

    const currentLine = lyrics.lines[activeIndex]?.text ?? '';
    const nextLine = lyrics.lines[activeIndex + 1]?.text ?? '';

    const slideAnim = useRef(new Animated.Value(0)).current;
    const opacityAnim = useRef(new Animated.Value(1)).current;
    const prevIdxRef = useRef(activeIndex);

    // Anima de abajo hacia arriba cada vez que cambia la línea cantada
    useEffect(() => {
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
    }, [activeIndex, slideAnim, opacityAnim]);

    if (!currentLine) return null;

    return (
        <TouchableOpacity style={styles.card} activeOpacity={0.82} onPress={onPress}>
            <View style={styles.textClip}>
                <Animated.View
                    style={{
                        opacity: opacityAnim,
                        transform: [{ translateY: slideAnim }],
                    }}
                >
                    <Text style={styles.activeLine} numberOfLines={2}>
                        {currentLine}
                    </Text>
                    {nextLine ? (
                        <Text style={styles.nextLine} numberOfLines={1}>
                            {nextLine}
                        </Text>
                    ) : null}
                </Animated.View>
            </View>
            <View style={styles.expandBadge}>
                <Maximize2 size={14} color="rgba(255,255,255,0.82)" />
            </View>
        </TouchableOpacity>
    );
});

const styles = StyleSheet.create({
    card: {
        marginTop: 12,
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
        overflow: 'hidden',
        minHeight: 42,
        justifyContent: 'center',
    },
    activeLine: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '800',
        lineHeight: 20,
        textShadowColor: 'rgba(0, 0, 0, 0.35)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    nextLine: {
        color: 'rgba(255, 255, 255, 0.52)',
        fontSize: 12.5,
        fontWeight: '600',
        marginTop: 2,
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
