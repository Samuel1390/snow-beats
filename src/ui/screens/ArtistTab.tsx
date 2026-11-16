import React, { useEffect, useState } from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';
import { Mic2 } from 'lucide-react-native';
import { getArtistsSummary } from '../../storage/database/db';
import { useTheme } from '../../theme/ThemeContext';

export const ArtistsTab: React.FC = () => {
    const { fgColor, mutedColor } = useTheme();
    const [artists, setArtists] = useState<{ name: string; trackCount: number }[]>([]);

    useEffect(() => { getArtistsSummary().then(setArtists); }, []);

    return (
        <FlatList
            data={artists}
            keyExtractor={(item) => item.name}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
                <View style={styles.row}>
                    <Mic2 size={20} color={fgColor} />
                    <View style={{ marginLeft: 12 }}>
                        <Text style={[styles.name, { color: fgColor }]}>{item.name}</Text>
                        <Text style={{ color: mutedColor, fontSize: 12 }}>{item.trackCount} canciones</Text>
                    </View>
                </View>
            )}
        />
    );
};

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    name: { fontSize: 15, fontWeight: '600' },
});