import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    AppState,
    Image,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import {
    AlertCircle,
    ArrowUp,
    CheckCircle2,
    Clock,
    Download,
    Film,
    FolderLock,
    ListMusic,
    Music,
    Pause,
    Play,
    RotateCcw,
    Search,
    Trash2,
    Volume2,
    VolumeX,
    X,
    XCircle,
} from 'lucide-react-native';
import {
    addDownloadProgressListener,
    cancelDownload,
    DownloadFormatOption,
    downloadMedia,
    ExtractedMediaInfo,
    extractMediaInfo,
    hasStorageWritePermission,
    PlaylistDownloadEntry,
    requestStorageWritePermission,
} from '../../../modules/snow-metadata';
import { getDownloadPaths } from '../../storage/downloadSettings';
import { useTheme } from '../../theme/ThemeContext';
import { usePlayer } from '../../audio-engine/PlayerContext';
import { DownloadFormatSheet } from '../components/DownloadFormatSheet';
import { PlaylistDownloadModal } from '../components/PlaylistDownloadModal';

type QueueItemStatus = 'downloading' | 'queued' | 'completed' | 'cancelled' | 'error';

interface DownloadQueueItem {
    id: string;
    url: string;
    title: string;
    thumbnail?: string | null;
    format: DownloadFormatOption;
    targetPath: string;
    status: QueueItemStatus;
    progress: number;
    etaSeconds: number;
    errorCode?: string;
    errorMessage?: string;
    savedFileName?: string;
}

interface DownloadsTabProps {
    isActive: boolean;
    onDownloadCompleted: () => void;
}

const SUPPORTED_PLATFORMS = ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'X'] as const;

function detectPlatformFromUrl(raw: string): string | null {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;
    if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) return 'YouTube';
    if (trimmed.includes('instagram.com') || trimmed.includes('instagr.am')) return 'Instagram';
    if (trimmed.includes('tiktok.com')) return 'TikTok';
    if (trimmed.includes('facebook.com') || trimmed.includes('fb.watch') || trimmed.includes('fb.com'))
        return 'Facebook';
    if (trimmed.includes('x.com') || trimmed.includes('twitter.com') || trimmed.includes('t.co'))
        return 'X';
    return null;
}

function formatEta(seconds: number): string {
    if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '';
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

// Reproductor streaming de vista previa para videos (silenciado por defecto con botón Silenciar/Desilenciar)
const StreamingVideoPreview: React.FC<{
    streamUrl: string;
    isActive: boolean;
}> = React.memo(({ streamUrl, isActive }) => {
    const [muted, setMuted] = useState(true);
    const player = useVideoPlayer(streamUrl, (p) => {
        p.loop = true;
        p.muted = true;
        if (isActive) {
            p.play();
        }
    });

    useEffect(() => {
        try {
            player.muted = muted;
        } catch { }
    }, [player, muted]);

    useEffect(() => {
        try {
            if (isActive) {
                player.play();
            } else {
                player.pause();
            }
        } catch { }
    }, [player, isActive]);

    return (
        <View style={styles.videoPreviewBox}>
            <VideoView
                player={player}
                style={styles.videoView}
                contentFit="contain"
                nativeControls
            />
            <TouchableOpacity
                style={styles.muteFloatingBtn}
                activeOpacity={0.8}
                onPress={() => setMuted((prev) => !prev)}
            >
                {muted ? (
                    <VolumeX size={18} color="#FFFFFF" />
                ) : (
                    <Volume2 size={18} color="#FACC15" />
                )}
                <Text style={styles.muteFloatingText}>
                    {muted ? 'Silenciado' : 'Con sonido'}
                </Text>
            </TouchableOpacity>
        </View>
    );
});

// Reproductor streaming automático para enlaces de solo audio
const StreamingAudioPreview: React.FC<{
    streamUrl: string;
    title: string;
    uploader: string;
    thumbnail?: string | null;
    isActive: boolean;
}> = React.memo(({ streamUrl, title, uploader, thumbnail, isActive }) => {
    const audioRef = useRef<AudioPlayer | null>(null);
    const [playing, setPlaying] = useState(true);
    const [muted, setMuted] = useState(false);

    useEffect(() => {
        const player = createAudioPlayer({ uri: streamUrl });
        audioRef.current = player;
        if (isActive) {
            try {
                player.play();
                setPlaying(true);
            } catch { }
        }
        return () => {
            try {
                player.pause();
                player.remove();
            } catch { }
            audioRef.current = null;
        };
    }, [streamUrl]);

    useEffect(() => {
        const p = audioRef.current;
        if (!p) return;
        if (!isActive) {
            try {
                p.pause();
                setPlaying(false);
            } catch { }
        }
    }, [isActive]);

    const togglePlay = () => {
        const p = audioRef.current;
        if (!p) return;
        if (playing) {
            p.pause();
            setPlaying(false);
        } else {
            p.play();
            setPlaying(true);
        }
    };

    const toggleMute = () => {
        const p = audioRef.current;
        if (!p) return;
        const next = !muted;
        setMuted(next);
        try {
            p.muted = next;
        } catch { }
    };

    return (
        <View style={styles.audioPreviewCard}>
            {thumbnail ? (
                <Image source={{ uri: thumbnail }} style={styles.audioPreviewCover} resizeMode="cover" />
            ) : (
                <View style={[styles.audioPreviewCover, styles.coverFallback]}>
                    <Music size={24} color="#60A5FA" />
                </View>
            )}
            <View style={styles.audioPreviewMeta}>
                <Text style={styles.audioPreviewTitle} numberOfLines={1}>
                    {title}
                </Text>
                <Text style={styles.audioPreviewSub} numberOfLines={1}>
                    {uploader} · Streaming de audio
                </Text>
            </View>
            <TouchableOpacity style={styles.audioCircleBtn} onPress={toggleMute}>
                {muted ? <VolumeX size={17} color="#FFFFFF" /> : <Volume2 size={17} color="#FFFFFF" />}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.audioCircleBtn, styles.audioPlayBtn]} onPress={togglePlay}>
                {playing ? <Pause size={17} color="#111114" /> : <Play size={17} color="#111114" />}
            </TouchableOpacity>
        </View>
    );
});

export const DownloadsTab: React.FC<DownloadsTabProps> = React.memo(
    ({ isActive, onDownloadCompleted }) => {
        const { fgColor, mutedColor, isLightText } = useTheme();
        const { pausePlayback } = usePlayer();

        const [urlInput, setUrlInput] = useState('');
        const [searching, setSearching] = useState(false);
        const [searchError, setSearchError] = useState<string | null>(null);
        const [mediaInfo, setMediaInfo] = useState<ExtractedMediaInfo | null>(null);

        const [formatSheetOpen, setFormatSheetOpen] = useState(false);
        const [playlistModalOpen, setPlaylistModalOpen] = useState(false);

        const [storagePermModalOpen, setStoragePermModalOpen] = useState(false);
        const [hasStoragePerm, setHasStoragePerm] = useState<boolean>(Platform.OS !== 'android');
        const initialPromptShownRef = useRef(false);
        const pendingActionRef = useRef<(() => void) | null>(null);

        const [queue, setQueue] = useState<DownloadQueueItem[]>([]);
        const queueRef = useRef<DownloadQueueItem[]>(queue);
        queueRef.current = queue;
        const activeTaskIdRef = useRef<string | null>(null);
        const processingRef = useRef<boolean>(false);

        const detectedPlatform = useMemo(() => detectPlatformFromUrl(urlInput), [urlInput]);

        // Verifica permisos de almacenamiento al entrar por primera vez a Descargas
        const refreshStoragePermission = useCallback(async () => {
            if (Platform.OS !== 'android') {
                setHasStoragePerm(true);
                return true;
            }
            const granted = await hasStorageWritePermission();
            setHasStoragePerm(granted);
            return granted;
        }, []);

        useEffect(() => {
            if (!isActive) return;
            refreshStoragePermission().then((granted) => {
                if (!granted && !initialPromptShownRef.current) {
                    initialPromptShownRef.current = true;
                    setStoragePermModalOpen(true);
                }
            });
        }, [isActive, refreshStoragePermission]);

        // Re-verifica automáticamente cuando el usuario vuelve de los ajustes de Android
        useEffect(() => {
            if (Platform.OS !== 'android') return;
            const sub = AppState.addEventListener('change', (state) => {
                if (state === 'active') {
                    refreshStoragePermission().then((granted) => {
                        if (granted) {
                            setStoragePermModalOpen(false);
                            if (pendingActionRef.current) {
                                const fn = pendingActionRef.current;
                                pendingActionRef.current = null;
                                fn();
                            }
                        }
                    });
                }
            });
            return () => sub.remove();
        }, [refreshStoragePermission]);

        // Escucha progreso en vivo emitido por el módulo nativo yt-dlp
        useEffect(() => {
            if (Platform.OS !== 'android') return;
            const sub = addDownloadProgressListener((evt) => {
                setQueue((prev) =>
                    prev.map((item) =>
                        item.id === evt.taskId && item.status === 'downloading'
                            ? {
                                  ...item,
                                  progress: Math.max(0, Math.min(100, evt.progress)),
                                  etaSeconds: evt.etaSeconds,
                              }
                            : item
                    )
                );
            });
            return () => sub?.remove();
        }, []);

        // Motor secuencial por orden de prioridad: descarga el primer elemento pendiente y avanza automáticamente
        const processQueue = useCallback(async () => {
            if (processingRef.current) return;
            const nextItem = queueRef.current.find((item) => item.status === 'queued');
            if (!nextItem) return;

            processingRef.current = true;
            activeTaskIdRef.current = nextItem.id;

            setQueue((prev) =>
                prev.map((item) =>
                    item.id === nextItem.id
                        ? {
                              ...item,
                              status: 'downloading',
                              progress: 0,
                              etaSeconds: 0,
                              errorCode: undefined,
                              errorMessage: undefined,
                          }
                        : item
                )
            );

            try {
                const res = await downloadMedia({
                    taskId: nextItem.id,
                    url: nextItem.url,
                    formatId: nextItem.format.formatId,
                    mediaType: nextItem.format.mediaType,
                    audioQuality: nextItem.format.audioQuality,
                    targetPath: nextItem.targetPath,
                });

                setQueue((prev) =>
                    prev.map((item) => {
                        if (item.id !== nextItem.id) return item;
                        if (item.status === 'cancelled') return item;
                        if (res.ok) {
                            return {
                                ...item,
                                status: 'completed',
                                progress: 100,
                                etaSeconds: 0,
                                savedFileName: res.fileName || item.title,
                            };
                        }
                        if (res.errorCode === 'CANCELLED') {
                            return {
                                ...item,
                                status: 'cancelled',
                                errorCode: 'CANCELLED',
                                errorMessage: res.errorMessage || 'Descarga cancelada.',
                            };
                        }
                        return {
                            ...item,
                            status: 'error',
                            errorCode: res.errorCode || 'UNKNOWN',
                            errorMessage:
                                res.errorMessage || 'Ocurrió un error inesperado al descargar.',
                        };
                    })
                );

                if (res.ok) {
                    onDownloadCompleted();
                }
            } catch (err: any) {
                setQueue((prev) =>
                    prev.map((item) =>
                        item.id === nextItem.id
                            ? {
                                  ...item,
                                  status: 'error',
                                  errorCode: 'UNKNOWN',
                                  errorMessage:
                                      err?.message || 'Error inesperado durante la descarga.',
                              }
                            : item
                    )
                );
            } finally {
                processingRef.current = false;
                activeTaskIdRef.current = null;
                setTimeout(() => {
                    processQueue();
                }, 120);
            }
        }, [onDownloadCompleted]);

        useEffect(() => {
            const hasQueued = queue.some((q) => q.status === 'queued');
            if (hasQueued && !processingRef.current) {
                processQueue();
            }
        }, [queue, processQueue]);

        // Busca y analiza el enlace mediante yt-dlp nativo
        const handleSearchUrl = useCallback(async () => {
            const trimmed = urlInput.trim();
            if (!trimmed) {
                setSearchError('Pega un enlace de YouTube, Instagram, TikTok, Facebook o X.');
                return;
            }
            if (!detectPlatformFromUrl(trimmed)) {
                setSearchError(
                    'Plataforma no soportada. Usa enlaces de YouTube, Instagram, TikTok, Facebook o X.'
                );
                return;
            }

            setSearching(true);
            setSearchError(null);
            setMediaInfo(null);

            try {
                const info = await extractMediaInfo(trimmed);
                if (!info.ok) {
                    setSearchError(
                        info.errorMessage || 'No se pudo obtener información del enlace.'
                    );
                    return;
                }
                if (info.isAudioOnly) {
                    pausePlayback();
                }
                setMediaInfo(info);
            } catch (err: any) {
                setSearchError(err?.message || 'Error al analizar la URL con yt-dlp.');
            } finally {
                setSearching(false);
            }
        }, [urlInput, pausePlayback]);

        // Asegura permisos antes de abrir el selector o iniciar descarga; si el usuario los omitió, vuelve a pedirlos
        const runWithStoragePermission = useCallback(
            async (action: () => void) => {
                if (Platform.OS !== 'android') {
                    action();
                    return;
                }
                const granted = await refreshStoragePermission();
                if (!granted) {
                    pendingActionRef.current = action;
                    setStoragePermModalOpen(true);
                    return;
                }
                action();
            },
            [refreshStoragePermission]
        );

        const handleOpenDownloadOptions = useCallback(() => {
            if (!mediaInfo) return;
            runWithStoragePermission(() => {
                if (mediaInfo.isPlaylist && (mediaInfo.entries?.length ?? 0) > 0) {
                    setPlaylistModalOpen(true);
                } else {
                    setFormatSheetOpen(true);
                }
            });
        }, [mediaInfo, runWithStoragePermission]);

        const enqueueItems = useCallback(
            async (
                items: { url: string; title: string; thumbnail?: string | null }[],
                format: DownloadFormatOption
            ) => {
                const paths = await getDownloadPaths();
                const targetPath =
                    format.mediaType === 'video' ? paths.videoPath : paths.audioPath;
                const baseTs = Date.now();
                const newTasks: DownloadQueueItem[] = items.map((entry, idx) => ({
                    id: `dl_${baseTs}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
                    url: entry.url,
                    title: entry.title,
                    thumbnail: entry.thumbnail,
                    format,
                    targetPath,
                    status: 'queued',
                    progress: 0,
                    etaSeconds: 0,
                }));
                setQueue((prev) => [...prev, ...newTasks]);
            },
            []
        );

        const handleConfirmSingleFormat = useCallback(
            (format: DownloadFormatOption) => {
                setFormatSheetOpen(false);
                if (!mediaInfo?.url) return;
                runWithStoragePermission(() => {
                    enqueueItems(
                        [
                            {
                                url: mediaInfo.url!,
                                title: mediaInfo.title || 'Archivo descargado',
                                thumbnail: mediaInfo.thumbnail,
                            },
                        ],
                        format
                    );
                });
            },
            [mediaInfo, runWithStoragePermission, enqueueItems]
        );

        const handleConfirmPlaylist = useCallback(
            (entries: PlaylistDownloadEntry[], format: DownloadFormatOption) => {
                setPlaylistModalOpen(false);
                if (entries.length === 0) return;
                runWithStoragePermission(() => {
                    enqueueItems(
                        entries.map((e) => ({
                            url: e.url,
                            title: e.title,
                            thumbnail: e.thumbnail,
                        })),
                        format
                    );
                });
            },
            [runWithStoragePermission, enqueueItems]
        );

        const handleCancelTask = useCallback((taskId: string) => {
            if (activeTaskIdRef.current === taskId) {
                cancelDownload(taskId).catch(() => { });
            }
            setQueue((prev) =>
                prev.map((item) =>
                    item.id === taskId
                        ? {
                              ...item,
                              status: 'cancelled',
                              errorCode: 'CANCELLED',
                              errorMessage: 'Descarga cancelada.',
                          }
                        : item
                )
            );
        }, []);

        const handleRetryTask = useCallback(
            (taskId: string) => {
                runWithStoragePermission(() => {
                    setQueue((prev) =>
                        prev.map((item) =>
                            item.id === taskId
                                ? {
                                      ...item,
                                      status: 'queued',
                                      progress: 0,
                                      etaSeconds: 0,
                                      errorCode: undefined,
                                      errorMessage: undefined,
                                  }
                                : item
                        )
                    );
                });
            },
            [runWithStoragePermission]
        );

        const handleMovePriorityUp = useCallback((taskId: string) => {
            setQueue((prev) => {
                const idx = prev.findIndex((item) => item.id === taskId);
                if (idx <= 0) return prev;
                const prevItem = prev[idx - 1];
                // No intercambia por encima del elemento que ya está descargándose activamente
                if (prevItem.status === 'downloading') return prev;
                const copy = [...prev];
                copy[idx - 1] = prev[idx];
                copy[idx] = prevItem;
                return copy;
            });
        }, []);

        const handleRemoveTask = useCallback((taskId: string) => {
            setQueue((prev) => prev.filter((item) => item.id !== taskId));
        }, []);

        const cardBg = isLightText ? 'rgba(20, 22, 30, 0.72)' : 'rgba(255, 255, 255, 0.78)';
        const borderCol = isLightText ? 'rgba(255, 255, 255, 0.12)' : 'rgba(17, 24, 39, 0.14)';

        return (
            <View style={styles.root}>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* Aviso compacto si el usuario omitió el permiso */}
                    {Platform.OS === 'android' && !hasStoragePerm && (
                        <TouchableOpacity
                            style={styles.permBanner}
                            activeOpacity={0.85}
                            onPress={() => setStoragePermModalOpen(true)}
                        >
                            <FolderLock size={18} color="#FACC15" />
                            <Text style={styles.permBannerText}>
                                Permiso de almacenamiento pendiente. Toca aquí para habilitarlo.
                            </Text>
                        </TouchableOpacity>
                    )}

                    {/* Barra superior de búsqueda por URL */}
                    <View style={[styles.searchRow, { backgroundColor: cardBg, borderColor: borderCol }]}>
                        <TextInput
                            style={[styles.urlInput, { color: fgColor }]}
                            placeholder="Pega enlace de YouTube, TikTok, IG, FB o X..."
                            placeholderTextColor={mutedColor}
                            value={urlInput}
                            onChangeText={(t) => {
                                setUrlInput(t);
                                if (searchError) setSearchError(null);
                            }}
                            autoCapitalize="none"
                            autoCorrect={false}
                            returnKeyType="search"
                            onSubmitEditing={handleSearchUrl}
                        />
                        {urlInput.length > 0 && (
                            <TouchableOpacity
                                style={styles.clearInputBtn}
                                onPress={() => {
                                    setUrlInput('');
                                    setSearchError(null);
                                }}
                            >
                                <X size={16} color={mutedColor} />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            style={[styles.searchBtn, searching && { opacity: 0.7 }]}
                            activeOpacity={0.85}
                            disabled={searching}
                            onPress={handleSearchUrl}
                        >
                            {searching ? (
                                <ActivityIndicator size="small" color="#111114" />
                            ) : (
                                <>
                                    <Search size={17} color="#111114" />
                                    <Text style={styles.searchBtnText}>Buscar</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>

                    {/* Indicadores de plataformas soportadas */}
                    <View style={styles.platformsRow}>
                        {SUPPORTED_PLATFORMS.map((p) => {
                            const highlighted = detectedPlatform === p;
                            return (
                                <View
                                    key={p}
                                    style={[
                                        styles.platformBadge,
                                        {
                                            borderColor: highlighted ? '#FACC15' : borderCol,
                                            backgroundColor: highlighted
                                                ? 'rgba(250,204,21,0.16)'
                                                : cardBg,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.platformBadgeText,
                                            { color: highlighted ? '#FACC15' : mutedColor },
                                        ]}
                                    >
                                        {p}
                                    </Text>
                                </View>
                            );
                        })}
                    </View>

                    {/* Mensaje de error de búsqueda / extracción */}
                    {searchError && (
                        <View style={styles.errorBox}>
                            <AlertCircle size={18} color="#F87171" />
                            <Text style={styles.errorBoxText}>{searchError}</Text>
                        </View>
                    )}

                    {/* Estado cargando análisis yt-dlp */}
                    {searching && (
                        <View style={[styles.loadingCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
                            <ActivityIndicator size="large" color="#FACC15" />
                            <Text style={[styles.loadingText, { color: fgColor }]}>
                                Analizando enlace con yt-dlp...
                            </Text>
                            <Text style={[styles.loadingSub, { color: mutedColor }]}>
                                Obteniendo vista previa en streaming y formatos disponibles
                            </Text>
                        </View>
                    )}

                    {/* Reproductor superior en streaming (Video silenciado por defecto o Audio automático) */}
                    {mediaInfo && !searching && (
                        <View style={[styles.previewSection, { backgroundColor: cardBg, borderColor: borderCol }]}>
                            {mediaInfo.isPlaylist ? (
                                <View style={styles.playlistPreviewHeader}>
                                    {mediaInfo.thumbnail ? (
                                        <Image
                                            source={{ uri: mediaInfo.thumbnail }}
                                            style={styles.playlistCover}
                                            resizeMode="cover"
                                        />
                                    ) : (
                                        <View style={[styles.playlistCover, styles.coverFallback]}>
                                            <ListMusic size={28} color="#FACC15" />
                                        </View>
                                    )}
                                    <View style={styles.playlistHeaderMeta}>
                                        <View style={styles.playlistPill}>
                                            <ListMusic size={12} color="#111114" />
                                            <Text style={styles.playlistPillText}>
                                                Lista · {mediaInfo.entries?.length ?? 0} elementos
                                            </Text>
                                        </View>
                                        <Text style={[styles.previewTitle, { color: fgColor }]} numberOfLines={2}>
                                            {mediaInfo.title}
                                        </Text>
                                        <Text style={[styles.previewUploader, { color: mutedColor }]} numberOfLines={1}>
                                            {mediaInfo.uploader} · {mediaInfo.platform}
                                        </Text>
                                    </View>
                                </View>
                            ) : mediaInfo.isAudioOnly && mediaInfo.previewStreamUrl ? (
                                <StreamingAudioPreview
                                    streamUrl={mediaInfo.previewStreamUrl}
                                    title={mediaInfo.title || 'Audio'}
                                    uploader={mediaInfo.uploader || mediaInfo.platform || 'Streaming'}
                                    thumbnail={mediaInfo.thumbnail}
                                    isActive={isActive}
                                />
                            ) : mediaInfo.previewStreamUrl ? (
                                <>
                                    <StreamingVideoPreview
                                        streamUrl={mediaInfo.previewStreamUrl}
                                        isActive={isActive}
                                    />
                                    <View style={styles.previewMetaRow}>
                                        <Text style={[styles.previewTitle, { color: fgColor }]} numberOfLines={2}>
                                            {mediaInfo.title}
                                        </Text>
                                        <Text style={[styles.previewUploader, { color: mutedColor }]} numberOfLines={1}>
                                            {mediaInfo.uploader} · {mediaInfo.platform}
                                        </Text>
                                    </View>
                                </>
                            ) : (
                                <View style={styles.previewMetaRow}>
                                    {mediaInfo.thumbnail && (
                                        <Image
                                            source={{ uri: mediaInfo.thumbnail }}
                                            style={styles.fallbackBannerImg}
                                            resizeMode="cover"
                                        />
                                    )}
                                    <Text style={[styles.previewTitle, { color: fgColor }]} numberOfLines={2}>
                                        {mediaInfo.title}
                                    </Text>
                                    <Text style={[styles.previewUploader, { color: mutedColor }]} numberOfLines={1}>
                                        {mediaInfo.uploader} · {mediaInfo.platform}
                                    </Text>
                                </View>
                            )}

                            {/* Botón grande Descargar */}
                            <TouchableOpacity
                                style={styles.bigDownloadBtn}
                                activeOpacity={0.85}
                                onPress={handleOpenDownloadOptions}
                            >
                                <Download size={20} color="#111114" />
                                <Text style={styles.bigDownloadBtnText}>
                                    {mediaInfo.isPlaylist
                                        ? `Descargar lista (${mediaInfo.entries?.length ?? 0})`
                                        : 'Descargar'}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Cola de descargas con orden de prioridad y estados detallados */}
                    <View style={styles.queueSection}>
                        <View style={styles.queueHeaderRow}>
                            <Text style={[styles.queueHeading, { color: fgColor }]}>
                                Cola de descargas ({queue.length})
                            </Text>
                            {queue.some(
                                (q) => q.status === 'completed' || q.status === 'cancelled'
                            ) && (
                                <TouchableOpacity
                                    onPress={() =>
                                        setQueue((prev) =>
                                            prev.filter(
                                                (q) =>
                                                    q.status === 'downloading' ||
                                                    q.status === 'queued' ||
                                                    q.status === 'error'
                                            )
                                        )
                                    }
                                >
                                    <Text style={styles.clearDoneText}>Limpiar historial</Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        {queue.length === 0 ? (
                            <View style={[styles.emptyQueueCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
                                <Download size={26} color={mutedColor} />
                                <Text style={[styles.emptyQueueTitle, { color: fgColor }]}>
                                    Sin descargas activas
                                </Text>
                                <Text style={[styles.emptyQueueSub, { color: mutedColor }]}>
                                    Pega una URL arriba, previsualiza el audio o video en streaming y pulsa Descargar.
                                </Text>
                            </View>
                        ) : (
                            queue.map((item, idx) => {
                                const queuedPosition =
                                    item.status === 'queued'
                                        ? queue
                                              .slice(0, idx)
                                              .filter(
                                                  (q) =>
                                                      q.status === 'downloading' ||
                                                      q.status === 'queued'
                                              ).length + 1
                                        : 0;
                                const canMoveUp =
                                    item.status === 'queued' &&
                                    idx > 0 &&
                                    queue[idx - 1].status !== 'downloading';

                                return (
                                    <View
                                        key={item.id}
                                        style={[
                                            styles.queueCard,
                                            { backgroundColor: cardBg, borderColor: borderCol },
                                        ]}
                                    >
                                        <View style={styles.queueTopRow}>
                                            {item.thumbnail ? (
                                                <Image
                                                    source={{ uri: item.thumbnail }}
                                                    style={styles.queueThumb}
                                                    resizeMode="cover"
                                                />
                                            ) : (
                                                <View style={[styles.queueThumb, styles.coverFallback]}>
                                                    {item.format.mediaType === 'audio' ? (
                                                        <Music size={18} color="#9CA3AF" />
                                                    ) : (
                                                        <Film size={18} color="#9CA3AF" />
                                                    )}
                                                </View>
                                            )}

                                            <View style={styles.queueMeta}>
                                                <Text
                                                    style={[styles.queueItemTitle, { color: fgColor }]}
                                                    numberOfLines={1}
                                                >
                                                    {item.title}
                                                </Text>
                                                <Text
                                                    style={[styles.queueItemFormat, { color: mutedColor }]}
                                                    numberOfLines={1}
                                                >
                                                    {item.format.label} ·{' '}
                                                    {item.format.mediaType === 'audio'
                                                        ? 'Audio'
                                                        : 'Video'}
                                                </Text>
                                            </View>

                                            <View style={styles.queueActions}>
                                                {canMoveUp && (
                                                    <TouchableOpacity
                                                        style={styles.queueIconBtn}
                                                        onPress={() => handleMovePriorityUp(item.id)}
                                                    >
                                                        <ArrowUp size={16} color="#60A5FA" />
                                                    </TouchableOpacity>
                                                )}

                                                {(item.status === 'downloading' ||
                                                    item.status === 'queued') && (
                                                    <TouchableOpacity
                                                        style={styles.queueIconBtn}
                                                        onPress={() => handleCancelTask(item.id)}
                                                    >
                                                        <X size={16} color="#F87171" />
                                                    </TouchableOpacity>
                                                )}

                                                {(item.status === 'error' ||
                                                    item.status === 'cancelled') && (
                                                    <TouchableOpacity
                                                        style={styles.queueIconBtn}
                                                        onPress={() => handleRetryTask(item.id)}
                                                    >
                                                        <RotateCcw size={16} color="#FACC15" />
                                                    </TouchableOpacity>
                                                )}

                                                {(item.status === 'completed' ||
                                                    item.status === 'error' ||
                                                    item.status === 'cancelled') && (
                                                    <TouchableOpacity
                                                        style={styles.queueIconBtn}
                                                        onPress={() => handleRemoveTask(item.id)}
                                                    >
                                                        <Trash2 size={15} color="#9CA3AF" />
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        </View>

                                        {/* Estado 1: Descargando con barra de progreso real */}
                                        {item.status === 'downloading' && (
                                            <View style={styles.progressBlock}>
                                                <View style={styles.progressBarTrack}>
                                                    <View
                                                        style={[
                                                            styles.progressBarFill,
                                                            {
                                                                width: `${Math.max(
                                                                    4,
                                                                    Math.min(100, item.progress)
                                                                )}%`,
                                                            },
                                                        ]}
                                                    />
                                                </View>
                                                <View style={styles.progressLabelRow}>
                                                    <Text style={styles.downloadingStatusText}>
                                                        Descargando... {Math.round(item.progress)}%
                                                    </Text>
                                                    {item.etaSeconds > 0 && (
                                                        <Text style={[styles.etaText, { color: mutedColor }]}>
                                                            Restante: {formatEta(item.etaSeconds)}
                                                        </Text>
                                                    )}
                                                </View>
                                            </View>
                                        )}

                                        {/* Estado 2: En espera en la cola */}
                                        {item.status === 'queued' && (
                                            <View style={styles.statusPillRow}>
                                                <Clock size={14} color="#60A5FA" />
                                                <Text style={styles.queuedStatusText}>
                                                    Esperando su turno (prioridad #{queuedPosition})
                                                </Text>
                                            </View>
                                        )}

                                        {/* Estado 3: Completado */}
                                        {item.status === 'completed' && (
                                            <View style={styles.statusPillRow}>
                                                <CheckCircle2 size={14} color="#4ADE80" />
                                                <Text style={styles.completedStatusText} numberOfLines={1}>
                                                    Guardado en {item.targetPath}
                                                </Text>
                                            </View>
                                        )}

                                        {/* Estado 4: Cancelada */}
                                        {item.status === 'cancelled' && (
                                            <View style={styles.statusPillRow}>
                                                <XCircle size={14} color="#A1A1AA" />
                                                <Text style={styles.cancelledStatusText}>
                                                    Descarga cancelada
                                                </Text>
                                            </View>
                                        )}

                                        {/* Estado 5: Error identificado (conexión, espacio en disco, permisos, etc.) */}
                                        {item.status === 'error' && (
                                            <View style={styles.errorDetailBox}>
                                                <AlertCircle size={15} color="#F87171" />
                                                <Text style={styles.errorDetailText}>
                                                    {item.errorMessage ||
                                                        'Error al descargar el archivo.'}
                                                </Text>
                                            </View>
                                        )}
                                    </View>
                                );
                            })
                        )}
                    </View>
                </ScrollView>

                {/* Modal de permiso de almacenamiento (se vuelve a mostrar al descargar si el usuario lo omitió) */}
                <Modal
                    visible={storagePermModalOpen}
                    transparent
                    animationType="fade"
                    statusBarTranslucent
                    onRequestClose={() => {
                        pendingActionRef.current = null;
                        setStoragePermModalOpen(false);
                    }}
                >
                    <View style={styles.permOverlay}>
                        <View style={styles.permCard}>
                            <View style={styles.permIconCircle}>
                                <FolderLock size={28} color="#FACC15" />
                            </View>
                            <Text style={styles.permTitle}>Permiso de almacenamiento</Text>
                            <Text style={styles.permBody}>
                                Snow Beats necesita permiso para guardar los audios y videos descargados en tu almacenamiento interno (carpeta Snow beats/Download).
                            </Text>
                            <TouchableOpacity
                                style={styles.permAllowBtn}
                                activeOpacity={0.85}
                                onPress={async () => {
                                    await requestStorageWritePermission();
                                    const granted = await refreshStoragePermission();
                                    if (granted) {
                                        setStoragePermModalOpen(false);
                                        if (pendingActionRef.current) {
                                            const fn = pendingActionRef.current;
                                            pendingActionRef.current = null;
                                            fn();
                                        }
                                    }
                                }}
                            >
                                <Text style={styles.permAllowText}>Permitir almacenamiento</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.permSkipBtn}
                                onPress={() => {
                                    pendingActionRef.current = null;
                                    setStoragePermModalOpen(false);
                                }}
                            >
                                <Text style={styles.permSkipText}>Omitir por ahora</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>

                {/* Selector de formatos para recurso individual */}
                <DownloadFormatSheet
                    visible={formatSheetOpen}
                    mediaInfo={mediaInfo}
                    onClose={() => setFormatSheetOpen(false)}
                    onConfirm={handleConfirmSingleFormat}
                />

                {/* Selector de elementos para listas de reproducción */}
                <PlaylistDownloadModal
                    visible={playlistModalOpen}
                    mediaInfo={mediaInfo}
                    onClose={() => setPlaylistModalOpen(false)}
                    onConfirm={handleConfirmPlaylist}
                />
            </View>
        );
    }
);

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 96,
        gap: 12,
    },
    permBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: 'rgba(250,204,21,0.14)',
        borderWidth: 1,
        borderColor: 'rgba(250,204,21,0.35)',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
    },
    permBannerText: {
        flex: 1,
        color: '#FEF08A',
        fontSize: 12.5,
        fontWeight: '600',
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 14,
        borderWidth: 1,
        paddingLeft: 12,
        paddingRight: 6,
        paddingVertical: 6,
        gap: 6,
    },
    urlInput: {
        flex: 1,
        fontSize: 13.5,
        paddingVertical: 8,
    },
    clearInputBtn: {
        padding: 6,
    },
    searchBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#FACC15',
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 10,
    },
    searchBtnText: {
        color: '#111114',
        fontSize: 13.5,
        fontWeight: '800',
    },
    platformsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    platformBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: 1,
    },
    platformBadgeText: {
        fontSize: 11.5,
        fontWeight: '700',
    },
    errorBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: 'rgba(239,68,68,0.14)',
        borderWidth: 1,
        borderColor: 'rgba(248,113,113,0.4)',
        padding: 12,
        borderRadius: 12,
    },
    errorBoxText: {
        flex: 1,
        color: '#FCA5A5',
        fontSize: 13,
        lineHeight: 18,
    },
    loadingCard: {
        borderRadius: 16,
        borderWidth: 1,
        padding: 24,
        alignItems: 'center',
        gap: 8,
    },
    loadingText: {
        fontSize: 14.5,
        fontWeight: '700',
    },
    loadingSub: {
        fontSize: 12.5,
        textAlign: 'center',
    },
    previewSection: {
        borderRadius: 18,
        borderWidth: 1,
        overflow: 'hidden',
        padding: 12,
        gap: 12,
    },
    videoPreviewBox: {
        width: '100%',
        height: 215,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: '#000000',
        position: 'relative',
    },
    videoView: {
        width: '100%',
        height: '100%',
    },
    muteFloatingBtn: {
        position: 'absolute',
        top: 10,
        right: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(0,0,0,0.72)',
        paddingHorizontal: 11,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.18)',
    },
    muteFloatingText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '700',
    },
    audioPreviewCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: 'rgba(0,0,0,0.35)',
        padding: 10,
        borderRadius: 14,
    },
    audioPreviewCover: {
        width: 54,
        height: 54,
        borderRadius: 10,
        backgroundColor: '#1F2937',
    },
    audioPreviewMeta: {
        flex: 1,
        gap: 3,
    },
    audioPreviewTitle: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '700',
    },
    audioPreviewSub: {
        color: '#9CA3AF',
        fontSize: 12,
    },
    audioCircleBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.14)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    audioPlayBtn: {
        backgroundColor: '#FACC15',
    },
    playlistPreviewHeader: {
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
    },
    playlistCover: {
        width: 96,
        height: 72,
        borderRadius: 10,
        backgroundColor: '#1F2937',
    },
    playlistHeaderMeta: {
        flex: 1,
        gap: 4,
    },
    playlistPill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 5,
        backgroundColor: '#FACC15',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
    },
    playlistPillText: {
        color: '#111114',
        fontSize: 11,
        fontWeight: '800',
    },
    fallbackBannerImg: {
        width: '100%',
        height: 170,
        borderRadius: 12,
        marginBottom: 8,
    },
    previewMetaRow: {
        gap: 3,
    },
    previewTitle: {
        fontSize: 15,
        fontWeight: '800',
        lineHeight: 20,
    },
    previewUploader: {
        fontSize: 12.5,
    },
    bigDownloadBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#FACC15',
        paddingVertical: 14,
        borderRadius: 14,
    },
    bigDownloadBtnText: {
        color: '#111114',
        fontSize: 16,
        fontWeight: '800',
    },
    queueSection: {
        marginTop: 4,
        gap: 10,
    },
    queueHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    queueHeading: {
        fontSize: 15.5,
        fontWeight: '800',
    },
    clearDoneText: {
        color: '#60A5FA',
        fontSize: 12.5,
        fontWeight: '700',
    },
    emptyQueueCard: {
        borderRadius: 16,
        borderWidth: 1,
        padding: 22,
        alignItems: 'center',
        gap: 6,
    },
    emptyQueueTitle: {
        fontSize: 14.5,
        fontWeight: '700',
        marginTop: 4,
    },
    emptyQueueSub: {
        fontSize: 12.5,
        textAlign: 'center',
        lineHeight: 18,
    },
    queueCard: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 12,
        gap: 10,
    },
    queueTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    queueThumb: {
        width: 52,
        height: 40,
        borderRadius: 8,
        backgroundColor: '#27272A',
    },
    coverFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    queueMeta: {
        flex: 1,
        gap: 2,
    },
    queueItemTitle: {
        fontSize: 13.5,
        fontWeight: '700',
    },
    queueItemFormat: {
        fontSize: 12,
    },
    queueActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    queueIconBtn: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.06)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    progressBlock: {
        gap: 6,
    },
    progressBarTrack: {
        height: 7,
        borderRadius: 4,
        backgroundColor: 'rgba(255,255,255,0.14)',
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        borderRadius: 4,
        backgroundColor: '#FACC15',
    },
    progressLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    downloadingStatusText: {
        color: '#FACC15',
        fontSize: 12,
        fontWeight: '700',
    },
    etaText: {
        fontSize: 11.5,
    },
    statusPillRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    queuedStatusText: {
        color: '#93C5FD',
        fontSize: 12.5,
        fontWeight: '600',
    },
    completedStatusText: {
        flex: 1,
        color: '#86EFAC',
        fontSize: 12,
        fontWeight: '600',
    },
    cancelledStatusText: {
        color: '#A1A1AA',
        fontSize: 12.5,
        fontWeight: '600',
    },
    errorDetailBox: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 7,
        backgroundColor: 'rgba(239,68,68,0.12)',
        padding: 8,
        borderRadius: 8,
    },
    errorDetailText: {
        flex: 1,
        color: '#FCA5A5',
        fontSize: 12,
        lineHeight: 17,
    },
    permOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.72)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    permCard: {
        width: '100%',
        maxWidth: 360,
        backgroundColor: '#161822',
        borderRadius: 20,
        padding: 22,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        gap: 10,
    },
    permIconCircle: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: 'rgba(250,204,21,0.14)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 4,
    },
    permTitle: {
        color: '#FFFFFF',
        fontSize: 17.5,
        fontWeight: '800',
        textAlign: 'center',
    },
    permBody: {
        color: '#A1A1AA',
        fontSize: 13.5,
        lineHeight: 20,
        textAlign: 'center',
        marginBottom: 6,
    },
    permAllowBtn: {
        width: '100%',
        backgroundColor: '#FACC15',
        paddingVertical: 13,
        borderRadius: 12,
        alignItems: 'center',
    },
    permAllowText: {
        color: '#111114',
        fontSize: 14.5,
        fontWeight: '800',
    },
    permSkipBtn: {
        width: '100%',
        paddingVertical: 10,
        alignItems: 'center',
    },
    permSkipText: {
        color: '#9CA3AF',
        fontSize: 13.5,
        fontWeight: '600',
    },
});
