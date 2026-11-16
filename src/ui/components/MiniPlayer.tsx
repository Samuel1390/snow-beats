import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
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

    if (!currentTrack) return null;

    const palette = getDynamicPlayerPalette(currentTrack.dominantColor);
    const progressPct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

    const RepeatIcon =
        repeatMode === 'repeat_one' ? Repeat1 : repeatMode === 'shuffle' ? Shuffle : Repeat;

    return (
        <TouchableOpacity
            style={[styles.wrapper, { backgroundColor: palette.background }]}
            activeOpacity={0.9}
            onPress={onExpand}
        >
            return (
            <View style={[styles.wrapper, { backgroundColor: palette.background }]}>
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

                    <TouchableOpacity style={styles.btn} onPress={togglePlayPause}>
                        {isPlaying ? (
                            <Pause size={22} color={palette.foreground} />
                        ) : (
                            <Play size={22} color={palette.foreground} />
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.btn} onPress={cycleRepeatMode}>
                        <RepeatIcon size={20} color={palette.foreground} />
                    </TouchableOpacity>
                </TouchableOpacity>
            </View>
            );
        </TouchableOpacity>
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
    progressTrack: { height: 2.5, backgroundColor: 'rgba(255,255,255,0.15)' },
    progressFill: { height: '100%' },
    topSlider: { width: '100%', height: 18, marginTop: -8, marginBottom: -6 },
});