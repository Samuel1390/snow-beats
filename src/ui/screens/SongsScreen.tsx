import React, { useEffect, useState, useCallback, useRef } from 'react';
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
    useWindowDimensions,
    NativeSyntheticEvent,
    NativeScrollEvent,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { ArtistsTab } from './ArtistTab';
import { AlbumsTab } from './AlbumsTab';
import { VideosTab } from './VideosTab';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, ArrowUpDown, Settings } from 'lucide-react-native';
import { MainTab, SortOption, Track } from '../../types/music';
import { requestAudioPermission } from '../../permissions/audioPermissions';
import { scanLocalAudioLibrary } from '../../storage/scanner/mediaScanner';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { getVisibleTracks, softDeleteTracks, updateTrackMetadata } from '../../storage/database/db';
import { SongCard } from '../components/SongCard';
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
    { key: 'songs', label: 'Canciones' },
    { key: 'playlists', label: 'Playlists' },
    { key: 'folders', label: 'Carpetas' },
    { key: 'artists', label: 'Artistas' },
    { key: 'albums', label: 'Álbumes' },
    { key: 'videos', label: 'Videos' },
];

export const SongsScreen: React.FC = () => {
    const { width: screenWidth } = useWindowDimensions();
    const [activeIndex, setActiveIndex] = useState<number>(0);
    const [visitedTabs, setVisitedTabs] = useState<Record<number, boolean>>({ 0: true });
    const [tracks, setTracks] = useState<Track[]>([]);
    const [sortBy, setSortBy] = useState<SortOption>('date_desc');
    const [loading, setLoading] = useState<boolean>(true);
    const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
    const [libraryVersion, setLibraryVersion] = useState<number>(0);

    const { fgColor, mutedColor } = useTheme();
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [scanStatus, setScanStatus] = useState<string>('Verificando permisos...');
    const [searchOpen, setSearchOpen] = useState(false);
    const [sortOpen, setSortOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const { playTrack, addToQueue } = usePlayer();
    const [playerOpen, setPlayerOpen] = useState(false);

    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [playlistModalOpen, setPlaylistModalOpen] = useState(false);

    const toggleSelect = (id: string) =>
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const listRef = useRef<FlatList<Track>>(null);
    const pagerRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
    const tabsScrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
    const scrollX = useRef(new Animated.Value(0)).current;
    const [tabLayouts, setTabLayouts] = useState<Record<number, { x: number; width: number }>>({});

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

    // Enriquecimiento progresivo en segundo plano de carátulas y etiquetas ID3
    const enrichMetadataInBackground = useCallback(async (list: Track[]) => {
        const pending = list.filter((t) => !t.artworkUri && t.artist === 'Artista desconocido');
        for (let i = 0; i < pending.length; i += 5) {
            const batch = pending.slice(i, i + 5);
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

    // Cambia de sección deslizando suavemente el pager horizontal
    const goToTab = useCallback(
        (index: number) => {
            setSelectedIds([]);
            setActiveIndex(index);
            setVisitedTabs((prev) => (prev[index] ? prev : { ...prev, [index]: true }));
            pagerRef.current?.scrollTo({ x: index * screenWidth, animated: true });
            syncTabBarScroll(index);
        },
        [screenWidth, syncTabBarScroll]
    );

    // Sincroniza pestaña activa al terminar el gesto de swipe horizontal
    const handlePagerMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const nextIdx = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, screenWidth));
        if (nextIdx >= 0 && nextIdx < TABS.length && nextIdx !== activeIndex) {
            setSelectedIds([]);
            setActiveIndex(nextIdx);
            setVisitedTabs((prev) => (prev[nextIdx] ? prev : { ...prev, [nextIdx]: true }));
            syncTabBarScroll(nextIdx);
        }
    };

    // Monta preventivamente la pestaña vecina mientras el usuario desliza con el dedo
    const handlePagerScrollBegin = () => {
        setVisitedTabs((prev) => {
            const next = { ...prev };
            if (activeIndex > 0) next[activeIndex - 1] = true;
            if (activeIndex < TABS.length - 1) next[activeIndex + 1] = true;
            return next;
        });
    };

    const selectedTracks = tracks.filter((t) => selectedIds.includes(t.id));

    const handleShareSelected = async () => {
        if (selectedTracks.length === 0) return;
        if (!(await Sharing.isAvailableAsync())) {
            Alert.alert('Compartir', 'No disponible en este dispositivo.');
            return;
        }
        // expo-sharing comparte un archivo a la vez en Android
        if (selectedTracks.length > 1) {
            Alert.alert(
                'Compartir',
                `Android permite compartir 1 archivo por vez. Se compartirá "${selectedTracks[0].title}".`,
                [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                        text: 'Compartir',
                        onPress: async () => {
                            const uri = selectedTracks[0].uri;
                            setSelectedIds([]);
                            await Sharing.shareAsync(uri);
                        },
                    },
                ]
            );
            return;
        }
        const uri = selectedTracks[0].uri;
        setSelectedIds([]);
        await Sharing.shareAsync(uri);
    };

    const handleDeleteSelected = () => {
        if (selectedIds.length === 0) return;
        const idsToDelete = [...selectedIds];
        Alert.alert(
            'Mover a papelera',
            `¿Mover ${idsToDelete.length} ${idsToDelete.length === 1 ? 'canción' : 'canciones'} a Eliminados recientemente?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Mover a papelera',
                    style: 'destructive',
                    onPress: () => {
                        // Desactiva el selector y quita las pistas de la UI al instante (sin esperar bloqueos SQLite)
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
    };

    // Interpolaciones de la barra blanca deslizante debajo de las pestañas
    const allTabsMeasured = TABS.every((_, idx) => Boolean(tabLayouts[idx]));
    const inputRange = TABS.map((_, idx) => idx * Math.max(1, screenWidth));
    const indicatorTranslateX = allTabsMeasured
        ? scrollX.interpolate({
              inputRange,
              outputRange: TABS.map((_, idx) => tabLayouts[idx].x),
              extrapolate: 'clamp',
          })
        : null;
    const indicatorWidth = allTabsMeasured
        ? scrollX.interpolate({
              inputRange,
              outputRange: TABS.map((_, idx) => tabLayouts[idx].width),
              extrapolate: 'clamp',
          })
        : null;

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

            {/* Segunda fila del Header: 6 pestañas con indicador blanco deslizante */}
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

                        {/* Barra blanca deslizante debajo de la pestaña activa */}
                        {indicatorTranslateX && indicatorWidth && (
                            <Animated.View
                                pointerEvents="none"
                                style={[
                                    styles.tabIndicator,
                                    {
                                        backgroundColor: fgColor,
                                        width: indicatorWidth,
                                        transform: [{ translateX: indicatorTranslateX }],
                                    },
                                ]}
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
                    showsHorizontalScrollIndicator={false}
                    scrollEventThrottle={16}
                    onScrollBeginDrag={handlePagerScrollBegin}
                    onMomentumScrollEnd={handlePagerMomentumEnd}
                    onScroll={Animated.event(
                        [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                        { useNativeDriver: false }
                    )}
                    style={{ flex: 1 }}
                >
                    {/* Página 0: Canciones */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        <SelectionActionBar
                            selectedCount={selectedIds.length}
                            totalCount={tracks.length}
                            onClear={() => setSelectedIds([])}
                            onToggleSelectAll={() =>
                                setSelectedIds(
                                    selectedIds.length >= tracks.length ? [] : tracks.map((t) => t.id)
                                )
                            }
                            onAddToQueue={() => {
                                addToQueue(selectedTracks);
                                setSelectedIds([]);
                                Alert.alert(
                                    'Cola actualizada',
                                    `Se agregaron ${selectedTracks.length} canciones a la cola.`
                                );
                            }}
                            onAddToPlaylist={() => setPlaylistModalOpen(true)}
                            onShare={handleShareSelected}
                            onDelete={handleDeleteSelected}
                        />

                        <FlatList
                            ref={listRef}
                            data={tracks}
                            keyExtractor={(item) => item.id}
                            extraData={selectedIds}
                            initialNumToRender={15}
                            maxToRenderPerBatch={10}
                            windowSize={5}
                            renderItem={({ item }) => (
                                <SongCard
                                    track={item}
                                    selected={selectedIds.includes(item.id)}
                                    onPress={(selected) => {
                                        if (selectedIds.length > 0) {
                                            toggleSelect(selected.id);
                                        } else {
                                            playTrack(selected, tracks);
                                            setPlayerOpen(true);
                                        }
                                    }}
                                    onLongPress={(selected) => toggleSelect(selected.id)}
                                    onArtworkPress={(selected) => toggleSelect(selected.id)}
                                />
                            )}
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
                                                if (added > 0) await refreshTracks();
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
                            onSelectLetter={(letter) => {
                                const idx = tracks.findIndex((t) =>
                                    (sortBy.startsWith('artist') ? t.artist : t.title)
                                        .toUpperCase()
                                        .startsWith(letter)
                                );
                                if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, animated: true });
                            }}
                        />
                    </View>

                    {/* Página 1: Playlists */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        {visitedTabs[1] && (
                            <PlaylistsTab
                                onOpenPlayer={() => setPlayerOpen(true)}
                                refreshKey={libraryVersion}
                            />
                        )}
                    </View>

                    {/* Página 2: Carpetas */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        {visitedTabs[2] && (
                            <FoldersTab
                                onOpenPlayer={() => setPlayerOpen(true)}
                                onLibraryChanged={refreshTracks}
                                refreshKey={libraryVersion}
                            />
                        )}
                    </View>

                    {/* Página 3: Artistas */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        {visitedTabs[3] && (
                            <ArtistsTab
                                onOpenPlayer={() => setPlayerOpen(true)}
                                onLibraryChanged={refreshTracks}
                                refreshKey={libraryVersion}
                            />
                        )}
                    </View>

                    {/* Página 4: Álbumes */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        {visitedTabs[4] && (
                            <AlbumsTab
                                onOpenPlayer={() => setPlayerOpen(true)}
                                onLibraryChanged={refreshTracks}
                                refreshKey={libraryVersion}
                            />
                        )}
                    </View>

                    {/* Página 5: Videos */}
                    <View style={{ width: screenWidth, flex: 1 }}>
                        {visitedTabs[5] && <VideosTab />}
                    </View>
                </Animated.ScrollView>
            )}

            <AddToPlaylistModal
                visible={playlistModalOpen}
                trackIds={selectedIds}
                onClose={() => setPlaylistModalOpen(false)}
                onAdded={() => {
                    setSelectedIds([]);
                    setLibraryVersion((v) => v + 1);
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
                onSelectTrack={(selected) => {
                    playTrack(selected, tracks);
                    setPlayerOpen(true);
                }}
            />
            <SettingsModal
                visible={settingsOpen}
                onClose={() => {
                    setSettingsOpen(false);
                    refreshTracks();
                }}
            />
            <MiniPlayer onExpand={() => setPlayerOpen(true)} />
            <FullPlayerModal
                visible={playerOpen}
                onClose={() => {
                    setPlayerOpen(false);
                    refreshTracks();
                }}
                onPlaylistUpdated={() => setLibraryVersion((v) => v + 1)}
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