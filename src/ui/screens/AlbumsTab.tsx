import React, { useEffect, useState } from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';
import { Disc3 } from 'lucide-react-native';
import { getAlbumsSummary } from '../../storage/database/db';
import { useTheme } from '../../theme/ThemeContext';

export const AlbumsTab: React.FC = () => {
    const { fgColor, mutedColor } = useTheme();
    const [albums, setAlbums] = useState<{ name: string; trackCount: number }[]>([]);

    useEffect(() => { getAlbumsSummary().then(setAlbums); }, []);

    return (
        <FlatList
            data={albums}
            keyExtractor={(item) => item.name}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => (
                <View style={styles.row}>
                    <Disc3 size={20} color={fgColor} />
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