import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    View,
    Text,
    TouchableOpacity,
    Modal,
    Image,
    StyleSheet,
    Platform,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Film, X, LayoutGrid, List } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { usePlayer } from '../../audio-engine/PlayerContext';

const VideoModalPlayer: React.FC<{ uri: string; onClose: () => void }> = React.memo(
    ({ uri, onClose }) => {
        const insets = useSafeAreaInsets();
        const [ready, setReady] = useState(false);
        const player = useVideoPlayer(uri);

        // Inicia la reproducción en el siguiente frame para evitar congelar la apertura del Modal
        useEffect(() => {
            const raf = requestAnimationFrame(() => {
                try {
                    player.play();
                } catch { }
            });
            return () => {
                cancelAnimationFrame(raf);
                try {
                    player.pause();
                } catch { }
            };
        }, [player]);

        return (
            <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
                <View style={styles.modalBg}>
                    <TouchableOpacity
                        style={[styles.closeBtn, { top: Math.max(insets.top, 24) + 12 }]}
                        onPress={onClose}
                        activeOpacity={0.8}
                    >
                        <X size={24} color="#FFFFFF" />
                    </TouchableOpacity>

                    {!ready && (
                        <View style={styles.loaderOverlay} pointerEvents="none">
                            <ActivityIndicator size="large" color="#FFFFFF" />
                        </View>
                    )}

                    <VideoView
                        player={player}
                        style={styles.video}
                        contentFit="contain"
                        nativeControls
                        onFirstFrameRender={() => setReady(true)}
                    />
                </View>
            </Modal>
        );
    }
);

const VideoItemCard: React.FC<{
    item: MediaLibrary.Asset;
    thumb?: string;
    viewMode: 'grid' | 'list';
    fgColor: string;
    mutedColor: string;
    onSelect: (uri: string) => void;
}> = React.memo(({ item, thumb, viewMode, fgColor, mutedColor, onSelect }) =>
    viewMode === 'grid' ? (
        <TouchableOpacity style={styles.gridCard} activeOpacity={0.75} onPress={() => onSelect(item.uri)}>
            <View style={styles.gridThumb}>
                {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.fill} />
                ) : (
                    <Film size={28} color="#9CA3AF" />
                )}
            </View>
            <Text style={[styles.name, { color: fgColor, marginTop: 6 }]} numberOfLines={1}>
                {item.filename}
            </Text>
        </TouchableOpacity>
    ) : (
        <TouchableOpacity style={styles.listRow} activeOpacity={0.75} onPress={() => onSelect(item.uri)}>
            <View style={styles.listThumb}>
                {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.fill} />
                ) : (
                    <Film size={20} color="#9CA3AF" />
                )}
            </View>
            <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={[styles.name, { color: fgColor }]} numberOfLines={1}>
                    {item.filename}
                </Text>
                <Text style={{ color: mutedColor, fontSize: 12 }}>{Math.round(item.duration)}s</Text>
            </View>
        </TouchableOpacity>
    )
);

export const VideosTab: React.FC = React.memo(() => {
    const { fgColor, mutedColor } = useTheme();
    const { pausePlayback } = usePlayer();
    const [videos, setVideos] = useState<MediaLibrary.Asset[]>([]);
    const [thumbs, setThumbs] = useState<Record<string, string>>({});
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid'); // Cuadrícula por defecto
    const [selectedUri, setSelectedUri] = useState<string | null>(null);

    const mountedRef = useRef(true);
    const pausedThumbsRef = useRef(false);
    const requestedIdsRef = useRef<Set<string>>(new Set());
    const queueRef = useRef<MediaLibrary.Asset[]>([]);
    const processingRef = useRef(false);

    // Extrae miniaturas de forma perezosa y pausable para NO saturar MediaCodec al abrir un video
    const processThumbQueue = useCallback(async () => {
        if (processingRef.current || pausedThumbsRef.current) return;
        processingRef.current = true;
        try {
            let pendingBatch: Record<string, string> = {};
            let batchCount = 0;

            while (queueRef.current.length > 0 && mountedRef.current && !pausedThumbsRef.current) {
                const asset = queueRef.current.shift()!;
                try {
                    const { uri } = await VideoThumbnails.getThumbnailAsync(asset.uri, {
                        time: 0,
                        quality: 0.4,
                    });
                    if (!mountedRef.current) break;
                    pendingBatch[asset.id] = uri;
                    batchCount += 1;

                    if (batchCount >= 3 || queueRef.current.length === 0) {
                        const commit = pendingBatch;
                        pendingBatch = {};
                        batchCount = 0;
                        setThumbs((prev) => ({ ...prev, ...commit }));
                    }
                } catch { }

                // Cede el hilo entre decodificaciones para mantener 60fps
                await new Promise((r) => setTimeout(r, 45));
            }

            if (batchCount > 0 && mountedRef.current) {
                setThumbs((prev) => ({ ...prev, ...pendingBatch }));
            }
        } finally {
            processingRef.current = false;
        }
    }, []);

    const enqueueThumbnails = useCallback(
        (assets: MediaLibrary.Asset[]) => {
            let added = false;
            for (const a of assets) {
                if (!requestedIdsRef.current.has(a.id)) {
                    requestedIdsRef.current.add(a.id);
                    queueRef.current.push(a);
                    added = true;
                }
            }
            if (added && !pausedThumbsRef.current) {
                processThumbQueue();
            }
        },
        [processThumbQueue]
    );

    useEffect(() => {
        mountedRef.current = true;
        if (Platform.OS === 'web') return;

        MediaLibrary.requestPermissionsAsync(false, ['video'])
            .then(async (res) => {
                if (!res.granted || !mountedRef.current) return;
                const page = await MediaLibrary.getAssetsAsync({ mediaType: 'video', first: 100 });
                if (!mountedRef.current) return;
                setVideos(page.assets);
                // Solo decodifica inicialmente las primeras 8 miniaturas visibles
                enqueueThumbnails(page.assets.slice(0, 8));
            })
            .catch(() => { });

        return () => {
            mountedRef.current = false;
        };
    }, [enqueueThumbnails]);

    const handleOpenVideo = useCallback(
        (uri: string) => {
            // Pausa decodificación de miniaturas y audio activo para liberar MediaCodec y AudioFocus al instante
            pausedThumbsRef.current = true;
            pausePlayback();
            setSelectedUri(uri);
        },
        [pausePlayback]
    );

    const handleCloseVideo = useCallback(() => {
        setSelectedUri(null);
        pausedThumbsRef.current = false;
        if (queueRef.current.length > 0) {
            processThumbQueue();
        }
    }, [processThumbQueue]);

    const onViewableItemsChanged = useRef(
        ({ viewableItems }: { viewableItems: Array<{ item?: unknown }> }) => {
            const visibleAssets = viewableItems
                .map((v) => v.item as MediaLibrary.Asset | undefined)
                .filter((a): a is MediaLibrary.Asset => Boolean(a));
            if (visibleAssets.length > 0) {
                enqueueThumbnails(visibleAssets);
            }
        }
    ).current;

    const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;

    const renderItem = useCallback(
        ({ item }: { item: MediaLibrary.Asset }) => (
            <VideoItemCard
                item={item}
                thumb={thumbs[item.id]}
                viewMode={viewMode}
                fgColor={fgColor}
                mutedColor={mutedColor}
                onSelect={handleOpenVideo}
            />
        ),
        [thumbs, viewMode, fgColor, mutedColor, handleOpenVideo]
    );

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
                initialNumToRender={8}
                maxToRenderPerBatch={6}
                windowSize={5}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={viewabilityConfig}
                contentContainerStyle={{ padding: 12 }}
                columnWrapperStyle={viewMode === 'grid' ? { gap: 10 } : undefined}
                renderItem={renderItem}
                ListEmptyComponent={
                    <Text style={{ color: mutedColor, textAlign: 'center', marginTop: 32 }}>
                        {Platform.OS === 'web'
                            ? 'Los videos locales se escanean en Android.'
                            : 'No se encontraron videos locales.'}
                    </Text>
                }
            />
            {selectedUri && <VideoModalPlayer uri={selectedUri} onClose={handleCloseVideo} />}
        </View>
    );
});

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
    modalBg: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
    closeBtn: {
        position: 'absolute',
        right: 16,
        zIndex: 20,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.55)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    loaderOverlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 5,
    },
    // Ocupa el 100% de la pantalla para que videos verticales y horizontales aprovechen todo el espacio
    video: { width: '100%', height: '100%' },
});