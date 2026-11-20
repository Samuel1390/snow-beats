import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
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
    const [activeTab, setActiveTab] = useState<MainTab>('songs');
    const [tracks, setTracks] = useState<Track[]>([]);
    const [sortBy, setSortBy] = useState<SortOption>('date_desc');
    const [loading, setLoading] = useState<boolean>(true);
    const [permissionDenied, setPermissionDenied] = useState<boolean>(false);

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

    // Sale del modo selección al pulsar el botón físico Atrás en Android
    useEffect(() => {
        if (selectedIds.length === 0) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            setSelectedIds([]);
            return true;
        });
        return () => sub.remove();
    }, [selectedIds.length]);

    // Refresca la lista visible desde SQLite sin re-escanear el almacenamiento
    const refreshTracks = useCallback(async () => {
        const list = await getVisibleTracks(sortBy);
        setTracks(list);
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

    const loadLibrary = useCallback(async (currentSort: SortOption, fromUserAction = false) => {
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
            enrichMetadataInBackground(list).catch(() => { });
        } catch (error: any) {
            setErrorMessage(error?.message ?? String(error));
            setPermissionDenied(true);
        } finally {
            setLoading(false);
        }
    }, [enrichMetadataInBackground]);

    useEffect(() => {
        loadLibrary(sortBy);
    }, [loadLibrary, sortBy]);

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
                            await Sharing.shareAsync(selectedTracks[0].uri);
                            setSelectedIds([]);
                        },
                    },
                ]
            );
            return;
        }
        await Sharing.shareAsync(selectedTracks[0].uri);
        setSelectedIds([]);
    };

    const handleDeleteSelected = () => {
        if (selectedIds.length === 0) return;
        Alert.alert(
            'Mover a papelera',
            `¿Mover ${selectedIds.length} ${selectedIds.length === 1 ? 'canción' : 'canciones'} a Eliminados recientemente?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Mover a papelera',
                    style: 'destructive',
                    onPress: async () => {
                        await softDeleteTracks(selectedIds);
                        setSelectedIds([]);
                        await refreshTracks();
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.safeArea} edges={['top']} >
            {/* Fila superior del Header */}
            < View style={styles.headerTop} >
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

            {/* Segunda fila del Header: 6 pestañas */}
            <View style={styles.tabsWrapper}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent}>
                    {TABS.map((tab) => {
                        const isActive = activeTab === tab.key;
                        return (
                            <TouchableOpacity
                                key={tab.key}
                                style={[
                                    styles.tabItem,
                                    isActive && { borderBottomColor: fgColor },
                                ]}
                                onPress={() => {
                                    setSelectedIds([]);
                                    setActiveTab(tab.key);
                                }}
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
                </ScrollView>
            </View>

            {/* Contenido principal */}
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
            ) : activeTab === 'playlists' ? (
                <PlaylistsTab onOpenPlayer={() => setPlayerOpen(true)} />
            ) : activeTab === 'folders' ? (
                <FoldersTab onOpenPlayer={() => setPlayerOpen(true)} onLibraryChanged={refreshTracks} />
            ) : activeTab === 'artists' ? (
                <ArtistsTab onOpenPlayer={() => setPlayerOpen(true)} onLibraryChanged={refreshTracks} />
            ) : activeTab === 'albums' ? (
                <AlbumsTab onOpenPlayer={() => setPlayerOpen(true)} onLibraryChanged={refreshTracks} />
            ) : activeTab === 'videos' ? (
                <VideosTab />
            ) : (
                <View style={{ flex: 1 }}>
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
                            Alert.alert(
                                'Cola actualizada',
                                `Se agregaron ${selectedTracks.length} canciones a la cola.`
                            );
                            setSelectedIds([]);
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
                        removeClippedSubviews
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
            )}

            <AddToPlaylistModal
                visible={playlistModalOpen}
                trackIds={selectedIds}
                onClose={() => setPlaylistModalOpen(false)}
                onAdded={() => setSelectedIds([])}
            />
            <SortModal
                visible={sortOpen}
                currentSort={sortBy}
                onSelect={setSortBy}
                onClose={() => setSortOpen(false)}
            />
            <SearchModal
                visible={searchOpen}
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
        borderBottomColor: '#1F2937',
    },
    tabsContent: {
        paddingHorizontal: 12,
    },
    tabItem: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    tabItemActive: {
        borderBottomColor: '#FFFFFF',
    },
    tabText: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontSize: 14,
        fontWeight: '600',
    },
    tabTextActive: {
        color: '#FFFFFF',
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