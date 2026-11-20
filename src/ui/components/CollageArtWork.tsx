import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Music } from 'lucide-react-native';

interface CollageArtworkProps {
    artworks: (string | null)[];
    totalTracks: number;
    size?: number;
}

export const CollageArtwork: React.FC<CollageArtworkProps> = React.memo(({
    artworks,
    totalTracks,
    size = 52,
}) => {
    // 1 a 3 canciones: usa la carátula más reciente disponible
    if (totalTracks < 4) {
        const first = artworks.find((uri) => Boolean(uri)) ?? null;
        return (
            <View style={[styles.single, { width: size, height: size }]}>
                {first ? (
                    <Image source={{ uri: first }} style={styles.fill} />
                ) : (
                    <Music size={size * 0.42} color="#9CA3AF" />
                )}
            </View>
        );
    }

    // 4 o más canciones: collage 2x2 con las 4 más recientes
    const slots = [0, 1, 2, 3].map((i) => artworks[i] ?? null);
    const half = size / 2;

    return (
        <View style={[styles.grid, { width: size, height: size }]}>
            {slots.map((uri, idx) => (
                <View key={idx} style={[styles.cell, { width: half, height: half }]}>
                    {uri ? (
                        <Image source={{ uri }} style={styles.fill} />
                    ) : (
                        <Music size={half * 0.55} color="#9CA3AF" />
                    )}
                </View>
            ))}
        </View>
    );
});

const styles = StyleSheet.create({
    single: {
        borderRadius: 8,
        backgroundColor: '#1F2937',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#1F2937',
    },
    cell: {
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#1F2937',
    },
    fill: { width: '100%', height: '100%' },
});