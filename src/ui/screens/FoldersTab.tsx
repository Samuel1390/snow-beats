import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Switch, StyleSheet } from 'react-native';
import { Folder } from 'lucide-react-native';
import { FolderItem, getFolders } from '../../storage/database/db';
import { useTheme } from '../../theme/ThemeContext';

export const FoldersTab: React.FC = () => {
    const { fgColor, mutedColor } = useTheme();
    const [showHidden, setShowHidden] = useState(false);
    const [folders, setFolders] = useState<FolderItem[]>([]);

    useEffect(() => {
        getFolders(showHidden).then(setFolders);
    }, [showHidden]);

    return (
        <View style={styles.container}>
            <View style={styles.hiddenBar}>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.hiddenTitle, { color: fgColor }]}>¿Canciones no encontradas?</Text>
                    <Text style={{ color: mutedColor, fontSize: 12 }}>Mostrar archivos ocultos</Text>
                </View>
                <Switch value={showHidden} onValueChange={setShowHidden} />
            </View>

            <FlatList
                data={folders}
                keyExtractor={(item) => item.path}
                renderItem={({ item }) => (
                    <View style={styles.row}>
                        <Folder size={22} color={fgColor} />
                        <View style={{ marginLeft: 12, flex: 1 }}>
                            <Text style={[styles.folderName, { color: fgColor }]} numberOfLines={1}>
                                {item.name}
                            </Text>
                            <Text style={{ color: mutedColor, fontSize: 12 }}>
                                {item.trackCount} canciones
                            </Text>
                        </View>
                    </View>
                )}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, padding: 16 },
    hiddenBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: 14,
        marginBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(156,163,175,0.2)',
    },
    hiddenTitle: { fontSize: 14, fontWeight: '600' },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    folderName: { fontSize: 15, fontWeight: '600' },
});