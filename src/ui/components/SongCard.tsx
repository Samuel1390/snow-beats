import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
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

        const artworkContent = (
            <View style={[styles.artworkBox, selected && styles.artworkBoxSelected]}>
                {track.artworkUri ? (
                    <Image source={{ uri: track.artworkUri }} style={styles.artwork} />
                ) : (
                    <Music size={22} color="#9CA3AF" />
                )}
                {selected && (
                    <View style={styles.checkOverlay}>
                        <Check size={20} color="#FFFFFF" strokeWidth={3} />
                    </View>
                )}
            </View>
        );

        return (
            <TouchableOpacity
                style={[styles.container, selected && styles.containerSelected]}
                onPress={() => onPress(track)}
                activeOpacity={0.7}
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
    containerSelected: {
        backgroundColor: 'rgba(56, 189, 248, 0.16)',
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
    artworkBoxSelected: {
        borderWidth: 2,
        borderColor: '#38BDF8',
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