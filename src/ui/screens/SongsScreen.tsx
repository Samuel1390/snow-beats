import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
    Animated,
    View,
    Text,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    StyleSheet,
    ScrollView,
    Image,
    Alert,
    BackHandler,
    Platform,
    RefreshControl,
    useWindowDimensions,
    NativeSyntheticEvent,
    NativeScrollEvent,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { ArtistsTab } from './ArtistTab';
import { AlbumsTab } from './AlbumsTab';
import { VideosTab } from './VideosTab';
import { CompletedDownloadInfo, DownloadsTab } from './DownloadsTab';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, ArrowUpDown, Settings } from 'lucide-react-native';
import { MainTab, SortOption, Track } from '../../types/music';
import { requestAudioPermission } from '../../permissions/audioPermissions';
import {
    scanLocalAudioLibrary,
    scanMissingAudioTracks,
    upsertSingleDownloadedAudio,
} from '../../storage/scanner/mediaScanner';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { getVisibleTracks, softDeleteTracks, updateTrackMetadata } from '../../storage/database/db';
import { SONG_CARD_HEIGHT, SongCard } from '../components/SongCard';
import { useTheme } from '../../theme/ThemeContext';
import { SortModal } from '../components/SortModal';
import { SearchModal } from '../components/SearchModal';
import { SettingsModal } from './SettingsModal';
import { PlaylistsTab } from './PlaylistsTab';
import { FoldersTab } from './FoldersTab';
import { usePlayer } from '../../audio-engine/PlayerContext';
import { MiniPlayer } from '../components/MiniPlayer';
import { readTrackTags } from '../../../modules/snow-metadata';
import { FullPlayerModal } from './FullPlayerModal';
import { SelectionActionBar } from '../components/SelectionActionBar';
import { AddToPlaylistModal } from '../components/AddToPlaylistModal';
import { pickWebAudioFiles } from '../../storage/scanner/webAudioPicker';

const TABS: { key: MainTab; label: string }[] = [
    { key: 'downloads', label: 'Descargas' },
    { key: 'songs', label: 'Canciones' },
    { key: 'playlists', label: 'Playlists' },
    { key: 'folders', label: 'Carpetas' },
    { key: 'artists', label: 'Artistas' },
    { key: 'albums', label: 'Álbumes' },
    { key: 'videos', label: 'Videos' },
];

// Canciones sigue siendo la sección por defecto al abrir Snow Beats
const DEFAULT_TAB_INDEX = 1;
const INDICATOR_BASE_WIDTH = 100;

// Ordena la lista en memoria replicando el criterio activo de SQLite sin recargar toda la pantalla
function sortTracksInMemory(list: Track[], sortBy: SortOption): Track[] {
    const copy = [...list];
    switch (sortBy) {
        case 'date_desc':
            return copy.sort((a, b) => b.creationTime - a.creationTime);
        case 'most_played':
            return copy.sort((a, b) => b.playCount - a.playCount || a.title.localeCompare(b.title));
        case 'title_asc':
            return copy.sort((a, b) => a.title.localeCompare(b.title));
        case 'title_desc':
            return copy.sort((a, b) => b.title.localeCompare(a.title));
        case 'artist_asc':
            return copy.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
        case 'artist_desc':
            return copy.sort((a, b) => b.artist.localeCompare(a.artist) || a.title.localeCompare(b.title));
        case 'duration_asc':
            return copy.sort((a, b) => a.duration - b.duration);
        case 'duration_desc':
            return copy.sort((a, b) => b.duration - a.duration);
        default:
            return copy;
    }
}

interface SongsListPaneProps {
    tracks: Track[];
    sortBy: SortOption;
    selectedIds: string[];
    currentTrackId: string | null;
    isPlaying: boolean;
    refreshing: boolean;
    onRefresh: () => void;
    mutedColor: string;
    onToggleSelect: (id: string) => void;
    onClearSelect: () => void;
    onToggleSelectAll: () => void;
    onPlayTrack: (track: Track) => void;
    onAddToQueue: () => void;
    onOpenPlaylistModal: () => void;
    onShareSelected: () => void;
    onDeleteSelected: () => void;
    onWebFilesAdded: () => Promise<void>;
}

// Subcomponente memoizado para la lista de 1300+ canciones: evita re-renders al cambiar pestañas o abrir el reproductor
const SongsListPane: React.FC<SongsListPaneProps> = React.memo(
    ({
        tracks,
        sortBy,
        selectedIds,
        currentTrackId,
        isPlaying,
        refreshing,
        onRefresh,
        mutedColor,
        onToggleSelect,
        onClearSelect,
        onToggleSelectAll,
        onPlayTrack,
        onAddToQueue,
        onOpenPlaylistModal,
        onShareSelected,
        onDeleteSelected,
        onWebFilesAdded,
    }) => {
        const listRef = useRef<FlatList<Track>>(null);
        const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
        const hasSelectionRef = useRef(selectedIds.length > 0);
        hasSelectionRef.current = selectedIds.length > 0;
        const extraData = useMemo(
            () => ({ selectedSet, currentTrackId, isPlaying }),
            [selectedSet, currentTrackId, isPlaying]
        );

        // Callbacks estables para que React.memo en SongCard evite re-renderizar filas intactas
        const handlePress = useCallback(
            (selected: Track) => {
                if (hasSelectionRef.current) {
                    onToggleSelect(selected.id);
                } else {
                    onPlayTrack(selected);
                }
            },
            [onToggleSelect, onPlayTrack]
        );

        const handleSelectCard = useCallback(
            (selected: Track) => {
                onToggleSelect(selected.id);
            },
            [onToggleSelect]
        );

        const renderItem = useCallback(
            ({ item }: { item: Track }) => {
                const isCurrent = currentTrackId === item.id;
                return (
                    <SongCard
                        track={item}
                        selected={selectedSet.has(item.id)}
                        isCurrentTrack={isCurrent}
                        isPlaying={isCurrent && isPlaying}
                        onPress={handlePress}
                        onLongPress={handleSelectCard}
                        onArtworkPress={handleSelectCard}
                    />
                );
            },
            [selectedSet, currentTrackId, isPlaying, handlePress, handleSelectCard]
        );

        const getItemLayout = useCallback(
            (_: ArrayLike<Track> | null | undefined, index: number) => ({
                length: SONG_CARD_HEIGHT,
                offset: SONG_CARD_HEIGHT * index,
                index,
            }),
            []
        );

        const handleSelectLetter = useCallback(
            (letter: string) => {
                const idx = tracks.findIndex((t) =>
                    (sortBy.startsWith('artist') ? t.artist : t.title)
                        .toUpperCase()
                        .startsWith(letter)
                );
                if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, animated: true });
            },
            [tracks, sortBy]
        );

        return (
            <View style={{ flex: 1 }}>
                <SelectionActionBar
                    selectedCount={selectedIds.length}
                    totalCount={tracks.length}
                    onClear={onClearSelect}
                    onToggleSelectAll={onToggleSelectAll}
                    onAddToQueue={onAddToQueue}
                    onAddToPlaylist={onOpenPlaylistModal}
                    onShare={onShareSelected}
                    onDelete={onDeleteSelected}
                />

                <FlatList
                    ref={listRef}
                    data={tracks}
                    keyExtractor={(item) => item.id}
                    extraData={extraData}
                    getItemLayout={getItemLayout}
                    initialNumToRender={16}
                    maxToRenderPerBatch={12}
                    windowSize={7}
                    contentContainerStyle={tracks.length === 0 ? { flexGrow: 1 } : undefined}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            colors={['#38BDF8', '#1E3A8A']}
                            tintColor="#38BDF8"
                            progressBackgroundColor="#111827"
                        />
                    }
                    renderItem={renderItem}
                    ListEmptyComponent={
                        <View style={styles.centered}>
                            <Text style={[styles.statusText, { color: mutedColor }]}>
                                {Platform.OS === 'web'
                                    ? 'Vista previa web: carga archivos de audio locales para probar la app aquí.'
                                    : 'No se encontraron canciones en el dispositivo.'}
                            </Text>
                            {Platform.OS === 'web' && (
                                <TouchableOpacity
                                    style={styles.retryButton}
                                    onPress={async () => {
                                        const added = await pickWebAudioFiles();
                                        if (added > 0) await onWebFilesAdded();
                                    }}
                                >
                                    <Text style={styles.retryText}>Cargar audios locales</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    }
                />
                <AlphabetIndex
                    visible={['title_asc', 'title_desc', 'artist_asc', 'artist_desc'].includes(sortBy)}
                    onSelectLetter={handleSelectLetter}
                />
            </View>
        );
    }
);

export const SongsScreen: React.FC = () => {
    const { width: screenWidth } = useWindowDimensions();
    const [activeIndex, setActiveIndex] = useState<number>(DEFAULT_TAB_INDEX);
    const [visitedTabs, setVisitedTabs] = useState<Record<number, boolean>>({
        [DEFAULT_TAB_INDEX]: true,
    });
    const [tracks, setTracks] = useState<Track[]>([]);
    const [sortBy, setSortBy] = useState<SortOption>('date_desc');
    const [loading, setLoading] = useState<boolean>(true);
    const [refreshingLibrary, setRefreshingLibrary] = useState<boolean>(false);
    const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
    const [libraryVersion, setLibraryVersion] = useState<number>(0);
    const [videoRefreshSignal, setVideoRefreshSignal] = useState<number>(0);

    const { fgColor, mutedColor } = useTheme();
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [scanStatus, setScanStatus] = useState<string>('Verificando permisos...');
    const [searchOpen, setSearchOpen] = useState(false);
    const [sortOpen, setSortOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const { currentTrack, isPlaying, playTrack, addToQueue } = usePlayer();
    const [playerOpen, setPlayerOpen] = useState(false);

    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
    const refreshingRef = useRef<boolean>(false);

    const tracksRef = useRef<Track[]>(tracks);
    tracksRef.current = tracks;
    const selectedIdsRef = useRef<string[]>(selectedIds);
    selectedIdsRef.current = selectedIds;

    const pagerRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
    const tabsScrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
    const initialAlignedRef = useRef<boolean>(false);
    const scrollX = useRef(new Animated.Value(DEFAULT_TAB_INDEX * screenWidth)).current;
    const [tabLayouts, setTabLayouts] = useState<Record<number, { x: number; width: number }>>({});

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedIds((prev) => (prev.length === 0 ? prev : []));
    }, []);

    const toggleSelectAll = useCallback(() => {
        setSelectedIds((prev) =>
            prev.length >= tracksRef.current.length ? [] : tracksRef.current.map((t) => t.id)
        );
    }, []);

    const openPlayer = useCallback(() => setPlayerOpen(true), []);
    const closePlayer = useCallback(() => setPlayerOpen(false), []);
    const bumpLibraryVersion = useCallback(() => setLibraryVersion((v) => v + 1), []);

    const handlePlayFromSongs = useCallback(
        (selected: Track) => {
            playTrack(selected, tracksRef.current);
            setPlayerOpen(true);
        },
        [playTrack]
    );

    // Sale del modo selección al pulsar el botón físico Atrás en Android
    useEffect(() => {
        if (selectedIds.length === 0) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            setSelectedIds([]);
            return true;
        });
        return () => sub.remove();
    }, [selectedIds.length]);

    // Refresca la lista visible desde SQLite y notifica a pestañas secundarias
    const refreshTracks = useCallback(async () => {
        const list = await getVisibleTracks(sortBy);
        setTracks(list);
        setLibraryVersion((v) => v + 1);
    }, [sortBy]);

    // Enriquecimiento progresivo con pausas cortas para no saturar SQLite ni el hilo JS en 1300+ pistas
    const enrichMetadataInBackground = useCallback(async (list: Track[]) => {
        const pending = list.filter((t) => !t.artworkUri && t.artist === 'Artista desconocido');
        for (let i = 0; i < pending.length; i += 12) {
            const batch = pending.slice(i, i + 12);
            const updates = await Promise.all(
                batch.map(async (track) => {
                    try {
                        const tags = await readTrackTags(track.uri, track.id);
                        if (!tags) return null;
                        const updated: Track = {
                            ...track,
                            title: tags.title || track.title,
                            artist: tags.artist || track.artist,
                            album: tags.album || track.album,
                            artworkUri: tags.artworkUri ?? null,
                            dominantColor: tags.dominantColor ?? null,
                        };
                        await updateTrackMetadata(track.id, updated);
                        return updated;
                    } catch {
                        return null;
                    }
                })
            );

            const validMap = new Map(updates.filter(Boolean).map((u) => [u!.id, u!]));
            if (validMap.size > 0) {
                setTracks((prev) => prev.map((item) => validMap.get(item.id) ?? item));
            }
            // Cede el hilo entre lotes para mantener 60fps durante navegación
            await new Promise((r) => setTimeout(r, 80));
        }
    }, []);

    const loadLibrary = useCallback(
        async (currentSort: SortOption, fromUserAction = false) => {
            setLoading(true);
            setErrorMessage(null);
            setScanStatus('Verificando permisos...');
            try {
                const perm = await requestAudioPermission(fromUserAction);
                if (!perm.granted) {
                    setPermissionDenied(true);
                    return;
                }
                setPermissionDenied(false);
                setScanStatus('Escaneando música local...');
                await scanLocalAudioLibrary((msg) => setScanStatus(msg));
                setScanStatus('Cargando biblioteca...');
                const list = await getVisibleTracks(currentSort);
                setTracks(list);
                setLibraryVersion((v) => v + 1);
                enrichMetadataInBackground(list).catch(() => { });
            } catch (error: any) {
                setErrorMessage(error?.message ?? String(error));
                setPermissionDenied(true);
            } finally {
                setLoading(false);
            }
        },
        [enrichMetadataInBackground]
    );

    useEffect(() => {
        loadLibrary(sortBy);
    }, [loadLibrary, sortBy]);

    // Inserta únicamente la canción recién descargada sin recargar toda la lista ni mostrar pantalla de carga
    const handleDownloadCompleted = useCallback(
        async (info: CompletedDownloadInfo) => {
            if (info.mediaType === 'video') {
                setVideoRefreshSignal((v) => v + 1);
                return;
            }
            try {
                const currentList = tracksRef.current;
                const existingIds = new Set(currentList.map((t) => t.id));
                const existingUris = new Set(currentList.map((t) => t.uri));
                const existingFilenames = new Set(currentList.map((t) => t.filename.toLowerCase()));

                let addedTrack = await upsertSingleDownloadedAudio({
                    filePath: info.filePath,
                    fileName: info.fileName,
                    title: info.title,
                    thumbnail: info.thumbnail,
                    existingIds,
                    existingUris,
                    existingFilenames,
                });

                if (!addedTrack) return;

                // Intenta enriquecer inmediatamente las etiquetas ID3/carátula solo de esta canción nueva
                try {
                    const tags = await readTrackTags(addedTrack.uri, addedTrack.id);
                    if (tags) {
                        addedTrack = {
                            ...addedTrack,
                            title: tags.title || addedTrack.title,
                            artist: tags.artist || addedTrack.artist,
                            album: tags.album || addedTrack.album,
                            artworkUri: tags.artworkUri ?? addedTrack.artworkUri,
                            dominantColor: tags.dominantColor ?? addedTrack.dominantColor,
                        };
                        await updateTrackMetadata(addedTrack.id, addedTrack);
                    }
                } catch { }

                const finalTrack = addedTrack;
                setTracks((prev) => {
                    if (
                        prev.some(
                            (t) =>
                                t.id === finalTrack.id ||
                                t.uri === finalTrack.uri ||
                                t.filename.toLowerCase() === finalTrack.filename.toLowerCase()
                        )
                    ) {
                        return prev;
                    }
                    return sortTracksInMemory([finalTrack, ...prev], sortBy);
                });
                setLibraryVersion((v) => v + 1);
            } catch { }
        },
        [sortBy]
    );

    // Pull-to-refresh incremental rápido: conserva las canciones actuales y agrega solo las faltantes del dispositivo
    const handleIncrementalAudioRefresh = useCallback(async () => {
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        setRefreshingLibrary(true);
        try {
            const currentList = tracksRef.current;
            const existingIds = new Set(currentList.map((t) => t.id));
            const existingUris = new Set(currentList.map((t) => t.uri));
            const existingFilenames = new Set(currentList.map((t) => t.filename.toLowerCase()));

            const missingTracks = await scanMissingAudioTracks(
                existingIds,
                existingUris,
                existingFilenames
            );

            if (missingTracks.length > 0) {
                setTracks((prev) => {
                    const prevIds = new Set(prev.map((t) => t.id));
                    const prevUris = new Set(prev.map((t) => t.uri));
                    const uniqueNew = missingTracks.filter(
                        (t) => !prevIds.has(t.id) && !prevUris.has(t.uri)
                    );
                    if (uniqueNew.length === 0) return prev;
                    return sortTracksInMemory([...uniqueNew, ...prev], sortBy);
                });
                setLibraryVersion((v) => v + 1);
                // Enriquece metadatos únicamente de las canciones recién agregadas
                enrichMetadataInBackground(missingTracks).catch(() => { });
            } else {
                setLibraryVersion((v) => v + 1);
            }
        } catch {
        } finally {
            refreshingRef.current = false;
            setRefreshingLibrary(false);
        }
    }, [sortBy, enrichMetadataInBackground]);

    // Mantiene centrada la pestaña activa en la barra horizontal superior
    const syncTabBarScroll = useCallback(
        (index: number) => {
            const layout = tabLayouts[index];
            if (!layout || !tabsScrollRef.current) return;
            const targetX = Math.max(0, layout.x - screenWidth / 2 + layout.width / 2);
            tabsScrollRef.current.scrollTo({ x: targetX, animated: true });
        },
        [tabLayouts, screenWidth]
    );

    // Alinea inicialmente el paginador en Canciones (índice 1) cuando termina de cargar la biblioteca
    useEffect(() => {
        if (loading || permissionDenied || initialAlignedRef.current || screenWidth <= 0) return;
        initialAlignedRef.current = true;
        const initialOffset = DEFAULT_TAB_INDEX * screenWidth;
        scrollX.setValue(initialOffset);
        requestAnimationFrame(() => {
            pagerRef.current?.scrollTo({ x: initialOffset, animated: false });
        });
    }, [loading, permissionDenied, screenWidth, scrollX]);

    // Cambia de sección disparando primero el scroll nativo sin bloquear el hilo JS
    const goToTab = useCallback(
        (index: number) => {
            if (index === activeIndex) return;
            pagerRef.current?.scrollTo({ x: index * screenWidth, animated: true });
            syncTabBarScroll(index);

            // En web scrollTo animado no siempre dispara eventos intermedios de scroll
            if (Platform.OS === 'web') {
                Animated.timing(scrollX, {
                    toValue: index * screenWidth,
                    duration: 240,
                    useNativeDriver: true,
                }).start();
            }

            if (selectedIdsRef.current.length > 0) {
                setSelectedIds([]);
            }
            setActiveIndex(index);
            // Monta pestañas no visitadas en el siguiente frame para que el scroll nativo arranque sin trabas
            requestAnimationFrame(() => {
                setVisitedTabs((prev) => (prev[index] ? prev : { ...prev, [index]: true }));
            });
        },
        [activeIndex, screenWidth, syncTabBarScroll, scrollX]
    );

    // Sincroniza pestaña activa al terminar el gesto de swipe horizontal
    const handlePagerMomentumEnd = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const nextIdx = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, screenWidth));
            if (nextIdx >= 0 && nextIdx < TABS.length && nextIdx !== activeIndex) {
                if (selectedIdsRef.current.length > 0) {
                    setSelectedIds([]);
                }
                setActiveIndex(nextIdx);
                setVisitedTabs((prev) => (prev[nextIdx] ? prev : { ...prev, [nextIdx]: true }));
                syncTabBarScroll(nextIdx);
            }
        },
        [screenWidth, activeIndex, syncTabBarScroll]
    );

    // Monta preventivamente las pestañas vecinas al iniciar un deslizamiento
    const handlePagerScrollBegin = useCallback(() => {
        setVisitedTabs((prev) => {
            const left = activeIndex > 0 ? activeIndex - 1 : activeIndex;
            const right = activeIndex < TABS.length - 1 ? activeIndex + 1 : activeIndex;
            if (prev[left] && prev[right]) return prev;
            return { ...prev, [left]: true, [right]: true };
        });
    }, [activeIndex]);

    const handleAddToQueueSelected = useCallback(() => {
        const idSet = new Set(selectedIdsRef.current);
        const picked = tracksRef.current.filter((t) => idSet.has(t.id));
        if (picked.length === 0) return;
        addToQueue(picked);
        setSelectedIds([]);
        Alert.alert('Cola actualizada', `Se agregaron ${picked.length} canciones a la cola.`);
    }, [addToQueue]);

    const handleOpenPlaylistModal = useCallback(() => setPlaylistModalOpen(true), []);

    const handleShareSelected = useCallback(async () => {
        const idSet = new Set(selectedIdsRef.current);
        const picked = tracksRef.current.filter((t) => idSet.has(t.id));
        if (picked.length === 0) return;
        if (!(await Sharing.isAvailableAsync())) {
            Alert.alert('Compartir', 'No disponible en este dispositivo.');
            return;
        }
        // expo-sharing comparte un archivo a la vez en Android
        if (picked.length > 1) {
            Alert.alert(
                'Compartir',
                `Android permite compartir 1 archivo por vez. Se compartirá "${picked[0].title}".`,
                [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                        text: 'Compartir',
                        onPress: async () => {
                            const uri = picked[0].uri;
                            setSelectedIds([]);
                            await Sharing.shareAsync(uri);
                        },
                    },
                ]
            );
            return;
        }
        const uri = picked[0].uri;
        setSelectedIds([]);
        await Sharing.shareAsync(uri);
    }, []);

    const handleDeleteSelected = useCallback(() => {
        const idsToDelete = [...selectedIdsRef.current];
        if (idsToDelete.length === 0) return;
        Alert.alert(
            'Mover a papelera',
            `¿Mover ${idsToDelete.length} ${idsToDelete.length === 1 ? 'canción' : 'canciones'} a Eliminados recientemente?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Mover a papelera',
                    style: 'destructive',
                    onPress: () => {
                        // Desactiva el selector y quita las pistas de la UI al instante
                        const idSet = new Set(idsToDelete);
                        setSelectedIds([]);
                        setTracks((prev) => prev.filter((t) => !idSet.has(t.id)));
                        softDeleteTracks(idsToDelete)
                            .then(() => setLibraryVersion((v) => v + 1))
                            .catch(() => { });
                    },
                },
            ]
        );
    }, []);

    // Evento de scroll 100% en hilo nativo UI para la barra blanca deslizante
    const onPagerScroll = useMemo(
        () =>
            Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
                useNativeDriver: true,
            }),
        [scrollX]
    );

    // Barra blanca deslizante acelerada por GPU (translateX + scaleX con useNativeDriver: true)
    const indicatorStyle = useMemo(() => {
        const allMeasured = TABS.every((_, idx) => Boolean(tabLayouts[idx]));
        if (!allMeasured) return null;

        const inputRange = TABS.map((_, idx) => idx * Math.max(1, screenWidth));
        const translateX = scrollX.interpolate({
            inputRange,
            outputRange: TABS.map(
                (_, idx) => tabLayouts[idx].x + tabLayouts[idx].width / 2 - INDICATOR_BASE_WIDTH / 2
            ),
            extrapolate: 'clamp',
        });
        const scaleX = scrollX.interpolate({
            inputRange,
            outputRange: TABS.map((_, idx) => Math.max(0.1, tabLayouts[idx].width / INDICATOR_BASE_WIDTH)),
            extrapolate: 'clamp',
        });

        return {
            backgroundColor: fgColor,
            width: INDICATOR_BASE_WIDTH,
            transform: [{ translateX }, { scaleX }],
        };
    }, [tabLayouts, screenWidth, scrollX, fgColor]);

    return (
        <SafeAreaView style={styles.safeArea} edges={['top']}>
            {/* Fila superior del Header */}
            <View style={styles.headerTop}>
                <View style={styles.brandRow}>
                    <Image source={require('../../../assets/images/logo.png')} style={styles.logo} />
                    <Text style={[styles.brandTitle, { color: fgColor }]}>Snow Beats</Text>
                </View>

                <View style={styles.headerActions}>
                    <TouchableOpacity style={styles.iconButton} onPress={() => setSearchOpen(true)}>
                        <Search size={21} color={fgColor} />
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.iconButton} onPress={() => setSortOpen(true)}>
                        <ArrowUpDown size={21} color={fgColor} />
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.iconButton} onPress={() => setSettingsOpen(true)}>
                        <Settings size={21} color={fgColor} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Segunda fila del Header: 6 pestañas con indicador blanco deslizante en GPU */}
            <View style={styles.tabsWrapper}>
                <ScrollView
                    ref={tabsScrollRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tabsContent}
                >
                    <View style={styles.tabsInnerRow}>
                        {TABS.map((tab, idx) => {
                            const isActive = activeIndex === idx;
                            return (
                                <TouchableOpacity
                                    key={tab.key}
                                    style={styles.tabItem}
                                    onLayout={(e) => {
                                        const { x, width } = e.nativeEvent.layout;
                                        setTabLayouts((prev) => {
                                            const curr = prev[idx];
                                            if (curr && curr.x === x && curr.width === width) return prev;
                                            return { ...prev, [idx]: { x, width } };
                                        });
                                    }}
                                    onPress={() => goToTab(idx)}
                                >
                                    <Text
                                        style={[
                                            styles.tabText,
                                            { color: isActive ? fgColor : mutedColor },
                                        ]}
                                    >
                                        {tab.label}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}

                        {indicatorStyle && (
                            <Animated.View
                                pointerEvents="none"
                                style={[styles.tabIndicator, indicatorStyle]}
                            />
                        )}
                    </View>
                </ScrollView>
            </View>

            {/* Contenido principal con swipe horizontal entre las 6 secciones */}
            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color={fgColor} />
                    <Text style={[styles.statusText, { color: mutedColor }]}>{scanStatus}</Text>
                </View>
            ) : permissionDenied ? (
                <View style={styles.centered}>
                    <Text style={[styles.statusText, { color: mutedColor }]}>
                        {errorMessage ? `Error: ${errorMessage}` : 'Se requiere permiso para leer tu música local.'}
                    </Text>
                    <TouchableOpacity style={styles.retryButton} onPress={() => loadLibrary(sortBy, true)}>
                        <Text style={styles.retryText}>Conceder permiso</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <Animated.ScrollView
                    ref={pagerRef}
                    horizontal
                    pagingEnabled
                    bounces={false}
                    contentOffset={{ x: DEFAULT_TAB_INDEX * screenWidth, y: 0 }}
                    showsHorizontalScrollIndicator={false}
                    scrollEventThrottle={16}
                    onScrollBeginDrag={handlePagerScrollBegin}
                    onMomentumScrollEnd={handlePagerMomentumEnd}
                    onScroll={onPagerScroll}
                    style={{ flex: 1 }}
                >
                    {/* Página 0 (a la izquierda de Canciones): Descargas con yt-dlp */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        {visitedTabs[0] && (
                            <DownloadsTab
                                isActive={activeIndex === 0}
                                onDownloadCompleted={handleDownloadCompleted}
                            />
                        )}
                    </View>

                    {/* Página 1 (por defecto): Canciones */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        <SongsListPane
                            tracks={tracks}
                            sortBy={sortBy}
                            selectedIds={selectedIds}
                            currentTrackId={currentTrack?.id ?? null}
                            isPlaying={isPlaying}
                            refreshing={refreshingLibrary}
                            onRefresh={handleIncrementalAudioRefresh}
                            mutedColor={mutedColor}
                            onToggleSelect={toggleSelect}
                            onClearSelect={clearSelection}
                            onToggleSelectAll={toggleSelectAll}
                            onPlayTrack={handlePlayFromSongs}
                            onAddToQueue={handleAddToQueueSelected}
                            onOpenPlaylistModal={handleOpenPlaylistModal}
                            onShareSelected={handleShareSelected}
                            onDeleteSelected={handleDeleteSelected}
                            onWebFilesAdded={refreshTracks}
                        />
                    </View>

                    {/* Página 2: Playlists */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        {visitedTabs[2] && (
                            <PlaylistsTab
                                onOpenPlayer={openPlayer}
                                refreshKey={libraryVersion}
                                refreshing={refreshingLibrary}
                                onRefresh={handleIncrementalAudioRefresh}
                            />
                        )}
                    </View>

                    {/* Página 3: Carpetas */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        {visitedTabs[3] && (
                            <FoldersTab
                                tracks={tracks}
                                onOpenPlayer={openPlayer}
                                onLibraryChanged={refreshTracks}
                                refreshKey={libraryVersion}
                                refreshing={refreshingLibrary}
                                onRefresh={handleIncrementalAudioRefresh}
                            />
                        )}
                    </View>

                    {/* Página 4: Artistas */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        {visitedTabs[4] && (
                            <ArtistsTab
                                tracks={tracks}
                                onOpenPlayer={openPlayer}
                                onLibraryChanged={refreshTracks}
                                refreshing={refreshingLibrary}
                                onRefresh={handleIncrementalAudioRefresh}
                            />
                        )}
                    </View>

                    {/* Página 5: Álbumes */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        {visitedTabs[5] && (
                            <AlbumsTab
                                tracks={tracks}
                                onOpenPlayer={openPlayer}
                                onLibraryChanged={refreshTracks}
                                refreshing={refreshingLibrary}
                                onRefresh={handleIncrementalAudioRefresh}
                            />
                        )}
                    </View>

                    {/* Página 6: Videos */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        {visitedTabs[6] && <VideosTab refreshSignal={videoRefreshSignal} />}
                    </View>
                </Animated.ScrollView>
            )}

            <AddToPlaylistModal
                visible={playlistModalOpen}
                trackIds={selectedIds}
                onClose={() => setPlaylistModalOpen(false)}
                onAdded={() => {
                    setSelectedIds([]);
                    bumpLibraryVersion();
                }}
            />
            <SortModal
                visible={sortOpen}
                currentSort={sortBy}
                onSelect={setSortBy}
                onClose={() => setSortOpen(false)}
            />
            <SearchModal
                visible={searchOpen}
                tracks={tracks}
                onClose={() => setSearchOpen(false)}
                onSelectTrack={handlePlayFromSongs}
            />
            <SettingsModal
                visible={settingsOpen}
                onClose={() => {
                    setSettingsOpen(false);
                    refreshTracks();
                }}
            />
            <MiniPlayer onExpand={openPlayer} />
            <FullPlayerModal
                visible={playerOpen}
                onClose={closePlayer}
                onPlaylistUpdated={bumpLibraryVersion}
                onTrackMutated={refreshTracks}
            />
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    headerTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    brandRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    logo: {
        width: 30,
        height: 30,
        borderRadius: 6,
        marginRight: 10,
    },
    brandTitle: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: '700',
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    iconButton: {
        padding: 8,
        marginLeft: 4,
    },
    tabsWrapper: {
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(156,163,175,0.2)',
    },
    tabsContent: {
        paddingHorizontal: 12,
    },
    tabsInnerRow: {
        flexDirection: 'row',
        position: 'relative',
    },
    tabItem: {
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    tabIndicator: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        height: 2.5,
        borderRadius: 2,
    },
    tabText: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontSize: 14,
        fontWeight: '600',
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    statusText: {
        color: 'rgba(255, 255, 255, 0.75)',
        marginTop: 12,
        textAlign: 'center',
    },
    retryButton: {
        marginTop: 16,
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 8,
    },
    retryText: {
        color: '#000000',
        fontWeight: '700',
    },
});