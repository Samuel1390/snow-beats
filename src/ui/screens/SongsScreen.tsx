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
} from 'react-native';
import { ArtistsTab } from './ArtistTab';
import { AlbumsTab } from './AlbumsTab';
import { VideosTab } from './VideosTab';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, ArrowUpDown, Settings } from 'lucide-react-native';
import { MainTab, SortOption, Track } from '../../types/music';
import { requestAudioPermission } from '../../permissions/audioPermissions';
import { scanLocalAudioLibrary } from '../../storage/scanner/mediaScanner';
import { AlphabetIndex } from '../components/AlphabetIndex';
import { getVisibleTracks } from '../../storage/database/db';
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
import { updateTrackMetadata } from '../../storage/database/db';
import { FullPlayerModal } from './FullPlayerModal';

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

    const { playTrack } = usePlayer();
    const [playerOpen, setPlayerOpen] = useState(false);

    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const toggleSelect = (id: string) =>
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const listRef = useRef<FlatList<Track>>(null);
    // Enriquecimiento progresivo en segundo plano de carátulas y etiquetas ID3
    const enrichMetadataInBackground = useCallback(async (list: Track[]) => {
        const pending = list.filter((t) => !t.artworkUri && t.artist === 'Artista desconocido');
        for (let i = 0; i < pending.length; i += 5) {
            const batch = pending.slice(i, i + 5);
            const updates = await Promise.all(
                batch.map(async (track) => {
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
            enrichMetadataInBackground(list);
        } catch (error: any) {
            setErrorMessage(error?.message ?? String(error));
            setPermissionDenied(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadLibrary(sortBy);
    }, [loadLibrary, sortBy]);

    // Alterna rápidamente entre Más reciente y Título A-Z como prueba en Fase 1
    const cycleSortDemo = () => {
        setSortBy((prev) => (prev === 'date_desc' ? 'title_asc' : 'date_desc'));
    };

    return (
        <SafeAreaView style={styles.safeArea} edges={['top']} >
            {/* Fila superior del Header */}
            < View style={styles.headerTop} >
                <View style={styles.brandRow}>
                    <Image source={require('../../../assets/images/logo.png')} style={styles.logo} />
                    <Text style={styles.brandTitle}> Snow Beats </Text>
                </View>

                < View style={styles.headerActions} >
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
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContent} >
                    {
                        TABS.map((tab) => {
                            const isActive = activeTab === tab.key;
                            return (
                                <TouchableOpacity
                                    key={tab.key}
                                    style={[styles.tabItem, isActive && styles.tabItemActive]}
                                    onPress={() => setActiveTab(tab.key)
                                    }
                                >
                                    <Text style={[styles.tabText, isActive && styles.tabTextActive]} >
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
                <PlaylistsTab />
            ) : activeTab === 'folders' ? (
                <FoldersTab />
            ) : activeTab === 'artists' ? (
                <ArtistsTab />
            ) : activeTab === 'albums' ? (
                <AlbumsTab />
            ) : activeTab === 'videos' ? (
                <VideosTab />
            ) : (
                <View style={{ flex: 1 }}>
                    <FlatList
                        ref={listRef}
                        data={tracks}
                        keyExtractor={(item) => item.id}
                        initialNumToRender={15}
                        maxToRenderPerBatch={10}
                        windowSize={5}
                        removeClippedSubviews
                        renderItem={({ item }) => (
                            <SongCard track={item} onPress={(selected) => {
                                if (selectedIds.length > 0) {
                                    toggleSelect(selected.id);
                                } else {
                                    playTrack(selected, tracks);
                                    setPlayerOpen(true);
                                }
                            }} />
                        )}
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

            <SortModal
                visible={sortOpen}
                currentSort={sortBy}
                onSelect={setSortBy}
                onClose={() => setSortOpen(false)}
            />
            <SearchModal
                visible={searchOpen}
                onClose={() => setSearchOpen(false)}
                onSelectTrack={(selected) => playTrack(selected, tracks)}
            />
            <SettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
            <MiniPlayer onExpand={() => setPlayerOpen(true)} />
            <FullPlayerModal visible={playerOpen} onClose={() => setPlayerOpen(false)} />
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