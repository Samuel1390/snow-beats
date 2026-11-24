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
    RefreshControl,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Film, X, LayoutGrid, List, Maximize2, Minimize2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { usePlayer } from '../../audio-engine/PlayerContext';
import { setScreenOrientation } from '../../../modules/snow-metadata';

const VideoModalPlayer: React.FC<{ uri: string; onClose: () => void }> = React.memo(
    ({ uri, onClose }) => {
        const insets = useSafeAreaInsets();
        const [ready, setReady] = useState(false);
        const [isLandscape, setIsLandscape] = useState(false);
        const player = useVideoPlayer(uri);

        // Inicia la reproducción en el siguiente frame y asegura restaurar orientación vertical al salir
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
                if (Platform.OS === 'android') {
                    setScreenOrientation('portrait').catch(() => { });
                }
            };
        }, [player]);

        const handleClose = useCallback(() => {
            if (Platform.OS === 'android') {
                setScreenOrientation('portrait').catch(() => { });
            }
            setIsLandscape(false);
            onClose();
        }, [onClose]);

        // Alterna manualmente entre vertical y pantalla completa horizontal para cualquier video
        const handleToggleLandscape = useCallback(() => {
            setIsLandscape((prev) => {
                const next = !prev;
                if (Platform.OS === 'android') {
                    setScreenOrientation(next ? 'landscape' : 'portrait').catch(() => { });
                }
                return next;
            });
        }, []);

        const topOffset = isLandscape ? 14 : Math.max(insets.top, 24) + 12;

        return (
            <Modal
                visible
                animationType="fade"
                statusBarTranslucent
                supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
                onRequestClose={handleClose}
            >
                <View style={styles.modalBg}>
                    <View style={[styles.topControlsRow, { top: topOffset }]}>
                        <TouchableOpacity
                            style={styles.controlCircleBtn}
                            onPress={handleToggleLandscape}
                            activeOpacity={0.8}
                        >
                            {isLandscape ? (
                                <Minimize2 size={20} color="#FFFFFF" />
                            ) : (
                                <Maximize2 size={20} color="#FFFFFF" />
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.controlCircleBtn}
                            onPress={handleClose}
                            activeOpacity={0.8}
                        >
                            <X size={22} color="#FFFFFF" />
                        </TouchableOpacity>
                    </View>

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
                        fullscreenOptions={{ enable: true, orientation: 'landscape' }}
                        onFullscreenEnter={() => {
                            setIsLandscape(true);
                            if (Platform.OS === 'android') {
                                setScreenOrientation('landscape').catch(() => { });
                            }
                        }}
                        onFullscreenExit={() => {
                            setIsLandscape(false);
                            if (Platform.OS === 'android') {
                                setScreenOrientation('portrait').catch(() => { });
                            }
                        }}
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

interface VideosTabProps {
    refreshSignal?: number;
}

export const VideosTab: React.FC<VideosTabProps> = React.memo(({ refreshSignal = 0 }) => {
    const { fgColor, mutedColor } = useTheme();
    const { pausePlayback } = usePlayer();
    const [videos, setVideos] = useState<MediaLibrary.Asset[]>([]);
    const [thumbs, setThumbs] = useState<Record<string, string>>({});
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid'); // Cuadrícula por defecto
    const [selectedUri, setSelectedUri] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const mountedRef = useRef(true);
    const videosRef = useRef<MediaLibrary.Asset[]>(videos);
    videosRef.current = videos;
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

    // Escaneo incremental de videos locales: mantiene los existentes y agrega solo los faltantes (.mp4 / video)
    const scanVideosIncremental = useCallback(
        async (showSpinner: boolean) => {
            if (Platform.OS === 'web') return;
            if (showSpinner) setRefreshing(true);
            try {
                const perm = await MediaLibrary.requestPermissionsAsync(false, ['video']);
                if (!perm.granted || !mountedRef.current) return;

                const existingIds = new Set(videosRef.current.map((v) => v.id));
                const existingUris = new Set(videosRef.current.map((v) => v.uri));
                const newlyFound: MediaLibrary.Asset[] = [];

                let hasNextPage = true;
                let after: string | undefined = undefined;
                while (hasNextPage && mountedRef.current) {
                    const page = await MediaLibrary.getAssetsAsync({
                        mediaType: 'video',
                        first: 200,
                        after,
                        sortBy: [MediaLibrary.SortBy.creationTime],
                    });
                    for (const asset of page.assets) {
                        if (!existingIds.has(asset.id) && !existingUris.has(asset.uri)) {
                            existingIds.add(asset.id);
                            existingUris.add(asset.uri);
                            newlyFound.push(asset);
                        }
                    }
                    if (!page.hasNextPage || page.assets.length === 0 || page.endCursor === after) {
                        hasNextPage = false;
                    } else {
                        after = page.endCursor;
                    }
                }

                if (!mountedRef.current) return;
                if (newlyFound.length > 0) {
                    setVideos((prev) => [...newlyFound, ...prev]);
                    enqueueThumbnails(newlyFound.slice(0, 8));
                }
            } catch {
            } finally {
                if (showSpinner && mountedRef.current) {
                    setRefreshing(false);
                }
            }
        },
        [enqueueThumbnails]
    );

    useEffect(() => {
        mountedRef.current = true;
        scanVideosIncremental(false);
        return () => {
            mountedRef.current = false;
        };
    }, [scanVideosIncremental]);

    // Cuando termina la descarga de un video en Descargas, agrega solo el video faltante sin reiniciar la vista
    useEffect(() => {
        if (refreshSignal > 0) {
            scanVideosIncremental(false);
        }
    }, [refreshSignal, scanVideosIncremental]);

    const handlePullRefresh = useCallback(() => {
        scanVideosIncremental(true);
    }, [scanVideosIncremental]);

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
                contentContainerStyle={{ padding: 12, flexGrow: 1 }}
                columnWrapperStyle={viewMode === 'grid' ? { gap: 10 } : undefined}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handlePullRefresh}
                        colors={['#38BDF8', '#1E3A8A']}
                        tintColor="#38BDF8"
                        progressBackgroundColor="#111827"
                    />
                }
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
    topControlsRow: {
        position: 'absolute',
        right: 16,
        zIndex: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    controlCircleBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.58)',
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