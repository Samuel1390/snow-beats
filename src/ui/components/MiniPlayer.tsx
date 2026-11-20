import React, { useEffect, useRef } from 'react';
import { Animated, View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Music, Play, Pause, Repeat, Repeat1, Shuffle } from 'lucide-react-native';
import { usePlayer, usePlayerProgress } from '../../audio-engine/PlayerContext';
import { getDynamicPlayerPalette } from '../../theme/colorContrast';
import Slider from '@react-native-community/slider';

interface MiniPlayerProps {
    onExpand: () => void;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({ onExpand }) => {
    const { currentTrack, isPlaying, repeatMode, togglePlayPause, cycleRepeatMode, seekTo } =
        usePlayer();
    const { position, duration } = usePlayerProgress();
    const entranceAnim = useRef(new Animated.Value(currentTrack ? 1 : 0)).current;
    const playScale = useRef(new Animated.Value(1)).current;
    const hasShownRef = useRef(Boolean(currentTrack));

    // Animación de entrada suave al aparecer el mini reproductor por primera vez
    useEffect(() => {
        if (currentTrack && !hasShownRef.current) {
            hasShownRef.current = true;
            entranceAnim.setValue(0);
            Animated.spring(entranceAnim, {
                toValue: 1,
                damping: 20,
                stiffness: 220,
                useNativeDriver: true,
            }).start();
        }
    }, [currentTrack, entranceAnim]);

    if (!currentTrack) return null;

    const palette = getDynamicPlayerPalette(currentTrack.dominantColor);
    const RepeatIcon =
        repeatMode === 'repeat_one' ? Repeat1 : repeatMode === 'shuffle' ? Shuffle : Repeat;

    const handlePlayPress = () => {
        Animated.sequence([
            Animated.timing(playScale, { toValue: 0.82, duration: 80, useNativeDriver: true }),
            Animated.spring(playScale, { toValue: 1, damping: 14, stiffness: 280, useNativeDriver: true }),
        ]).start();
        togglePlayPause();
    };

    const translateY = entranceAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [64, 0],
    });

    return (
        <Animated.View
            style={[
                styles.wrapper,
                {
                    backgroundColor: palette.background,
                    opacity: entranceAnim,
                    transform: [{ translateY }],
                },
            ]}
        >
            {/* Barra de progreso interactiva en el borde superior */}
            <Slider
                style={styles.topSlider}
                minimumValue={0}
                maximumValue={Math.max(1, duration)}
                value={position}
                onSlidingComplete={seekTo}
                minimumTrackTintColor={palette.foreground}
                maximumTrackTintColor="rgba(255,255,255,0.22)"
                thumbTintColor={palette.foreground}
            />

            <TouchableOpacity style={styles.row} activeOpacity={0.9} onPress={onExpand}>
                <View style={styles.artBox}>
                    {currentTrack.artworkUri ? (
                        <Image source={{ uri: currentTrack.artworkUri }} style={styles.art} />
                    ) : (
                        <Music size={20} color="#9CA3AF" />
                    )}
                </View>

                <View style={styles.info}>
                    <Text style={[styles.title, { color: palette.foreground }]} numberOfLines={1}>
                        {currentTrack.title}
                    </Text>
                    <Text style={[styles.artist, { color: palette.muted }]} numberOfLines={1}>
                        {currentTrack.artist}
                    </Text>
                </View>

                <Animated.View style={{ transform: [{ scale: playScale }] }}>
                    <TouchableOpacity style={styles.btn} onPress={handlePlayPress}>
                        {isPlaying ? (
                            <Pause size={22} color={palette.foreground} />
                        ) : (
                            <Play size={22} color={palette.foreground} />
                        )}
                    </TouchableOpacity>
                </Animated.View>

                <TouchableOpacity style={styles.btn} onPress={cycleRepeatMode}>
                    <RepeatIcon size={20} color={palette.foreground} />
                </TouchableOpacity>
            </TouchableOpacity>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.08)',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    artBox: {
        width: 42,
        height: 42,
        borderRadius: 6,
        backgroundColor: '#27272A',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        marginRight: 10,
    },
    art: { width: '100%', height: '100%' },
    info: { flex: 1 },
    title: { fontSize: 14, fontWeight: '700' },
    artist: { fontSize: 12, marginTop: 2 },
    btn: { padding: 8, marginLeft: 4 },
    topSlider: { width: '100%', height: 18, marginTop: -8, marginBottom: -6 },
});