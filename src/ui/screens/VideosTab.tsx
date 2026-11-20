import React, { useEffect, useState } from 'react';
import { FlatList, View, Text, TouchableOpacity, Modal, Image, StyleSheet } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Film, X, LayoutGrid, List } from 'lucide-react-native';
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
    const [thumbs, setThumbs] = useState<Record<string, string>>({});
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid'); // Cuadrícula por defecto
    const [selectedUri, setSelectedUri] = useState<string | null>(null);

    useEffect(() => {
        MediaLibrary.requestPermissionsAsync(false, ['video']).then(async (res) => {
            if (!res.granted) return;
            const page = await MediaLibrary.getAssetsAsync({ mediaType: 'video', first: 100 });
            setVideos(page.assets);

            // Extrae el primer frame (time: 0) en segundo plano
            for (const v of page.assets) {
                try {
                    const { uri } = await VideoThumbnails.getThumbnailAsync(v.uri, { time: 0 });
                    setThumbs((prev) => ({ ...prev, [v.id]: uri }));
                } catch { }
            }
        });
    }, []);

    return (
        <View style={{ flex: 1 }}>
            {/* Selector fijo arriba al scrollear */}
            <View style={styles.toolbar}>
                <Text style={{ color: mutedColor, fontSize: 13 }}>{videos.length} videos</Text>
                <View style={styles.modeBtns}>
                    <TouchableOpacity
                        style={[styles.modeBtn, viewMode === 'grid' && styles.modeBtnActive]}
                        onPress={() => setViewMode('grid')}
                    >
                        <LayoutGrid size={18} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.modeBtn, viewMode === 'list' && styles.modeBtnActive]}
                        onPress={() => setViewMode('list')}
                    >
                        <List size={18} color="#FFFFFF" />
                    </TouchableOpacity>
                </View>
            </View>

            <FlatList
                key={viewMode}
                numColumns={viewMode === 'grid' ? 2 : 1}
                data={videos}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ padding: 12 }}
                columnWrapperStyle={viewMode === 'grid' ? { gap: 10 } : undefined}
                renderItem={({ item }) =>
                    viewMode === 'grid' ? (
                        <TouchableOpacity style={styles.gridCard} onPress={() => setSelectedUri(item.uri)}>
                            <View style={styles.gridThumb}>
                                {thumbs[item.id] ? (
                                    <Image source={{ uri: thumbs[item.id] }} style={styles.fill} />
                                ) : (
                                    <Film size={28} color="#9CA3AF" />
                                )}
                            </View>
                            <Text style={[styles.name, { color: fgColor, marginTop: 6 }]} numberOfLines={1}>
                                {item.filename}
                            </Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity style={styles.listRow} onPress={() => setSelectedUri(item.uri)}>
                            <View style={styles.listThumb}>
                                {thumbs[item.id] ? (
                                    <Image source={{ uri: thumbs[item.id] }} style={styles.fill} />
                                ) : (
                                    <Film size={20} color="#9CA3AF" />
                                )}
                            </View>
                            <View style={{ marginLeft: 12, flex: 1 }}>
                                <Text style={[styles.name, { color: fgColor }]} numberOfLines={1}>{item.filename}</Text>
                                <Text style={{ color: mutedColor, fontSize: 12 }}>{Math.round(item.duration)}s</Text>
                            </View>
                        </TouchableOpacity>
                    )
                }
            />
            {selectedUri && <VideoModalPlayer uri={selectedUri} onClose={() => setSelectedUri(null)} />}
        </View>
    );
};

const styles = StyleSheet.create({
    toolbar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(156,163,175,0.2)',
    },
    modeBtns: { flexDirection: 'row', gap: 8 },
    modeBtn: { padding: 7, borderRadius: 8, backgroundColor: '#1F2937' },
    modeBtnActive: { backgroundColor: '#2563EB' },
    gridCard: { flex: 1, marginBottom: 14 },
    gridThumb: {
        width: '100%',
        aspectRatio: 16 / 10,
        borderRadius: 10,
        backgroundColor: '#1F2937',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    listThumb: {
        width: 72,
        height: 46,
        borderRadius: 6,
        backgroundColor: '#1F2937',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    fill: { width: '100%', height: '100%' },
    name: { fontSize: 13, fontWeight: '600' },
    modalBg: { flex: 1, backgroundColor: '#000000', justifyContent: 'center' },
    closeBtn: { position: 'absolute', top: 44, right: 16, zIndex: 10, padding: 8 },
    video: { width: '100%', height: 300 },
});