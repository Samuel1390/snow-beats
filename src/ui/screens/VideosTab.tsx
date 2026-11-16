import React, { useEffect, useState } from 'react';
import { FlatList, View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Film, X } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';

const VideoModalPlayer: React.FC<{ uri: string; onClose: () => void }> = ({ uri, onClose }) => {
    const player = useVideoPlayer(uri, (p) => { p.play(); });
    return (
        <Modal visible animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalBg}>
                <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                    <X size={26} color="#FFFFFF" />
                </TouchableOpacity>
                <VideoView player={player} style={styles.video} nativeControls />
            </View>
        </Modal>
    );
};

export const VideosTab: React.FC = () => {
    const { fgColor, mutedColor } = useTheme();
    const [videos, setVideos] = useState<MediaLibrary.Asset[]>([]);
    const [selectedUri, setSelectedUri] = useState<string | null>(null);

    useEffect(() => {
        MediaLibrary.requestPermissionsAsync(false, ['video']).then((res) => {
            if (!res.granted) return;
            MediaLibrary.getAssetsAsync({ mediaType: 'video', first: 100 }).then((page) =>
                setVideos(page.assets)
            );
        });
    }, []);

    return (
        <View style={{ flex: 1 }}>
            <FlatList
                data={videos}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ padding: 16 }}
                renderItem={({ item }) => (
                    <TouchableOpacity style={styles.row} onPress={() => setSelectedUri(item.uri)}>
                        <Film size={20} color={fgColor} />
                        <View style={{ marginLeft: 12, flex: 1 }}>
                            <Text style={[styles.name, { color: fgColor }]} numberOfLines={1}>{item.filename}</Text>
                            <Text style={{ color: mutedColor, fontSize: 12 }}>{Math.round(item.duration)}s</Text>
                        </View>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={
                    <Text style={{ color: mutedColor, textAlign: 'center', marginTop: 32 }}>
                        No se encontraron videos locales.
                    </Text>
                }
            />
            {selectedUri && <VideoModalPlayer uri={selectedUri} onClose={() => setSelectedUri(null)} />}
        </View>
    );
};

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    name: { fontSize: 15, fontWeight: '600' },
    modalBg: { flex: 1, backgroundColor: '#000000', justifyContent: 'center' },
    closeBtn: { position: 'absolute', top: 44, right: 16, zIndex: 10, padding: 8 },
    video: { width: '100%', height: 300 },
});