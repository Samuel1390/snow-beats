import { SortOption, Track } from '../../types/music';

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  trackCount: number;
  recentArtworks: (string | null)[];
}

export interface FolderItem {
  path: string;
  name: string;
  trackCount: number;
}

interface WebDbState {
  tracks: (Track & { lyricsText?: string; lastPlayedAt?: number; isCustomEdited?: boolean })[];
  searchHistory: { query: string; searchedAt: number }[];
  playlists: { id: string; name: string; createdAt: number }[];
  playlistTracks: { playlistId: string; trackId: string; position: number }[];
  appSettings: Record<string, string>;
}

const STORAGE_KEY = 'snow_beats_web_db_v1';

// Adaptador web (db.web.ts): Android e iOS usan db.ts con expo-sqlite sin cambios
let memoryState: WebDbState | null = null;

function loadState(): WebDbState {
  if (memoryState) return memoryState;
  const fallback: WebDbState = {
    tracks: [],
    searchHistory: [],
    playlists: [],
    playlistTracks: [],
    appSettings: {},
  };
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WebDbState>;
        memoryState = {
          tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
          searchHistory: Array.isArray(parsed.searchHistory) ? parsed.searchHistory : [],
          playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
          playlistTracks: Array.isArray(parsed.playlistTracks) ? parsed.playlistTracks : [],
          appSettings:
            parsed.appSettings && typeof parsed.appSettings === 'object' ? parsed.appSettings : {},
        };
        return memoryState;
      }
    }
  } catch { }
  memoryState = fallback;
  return memoryState;
}

function saveState(state: WebDbState): void {
  memoryState = state;
  try {
    if (typeof localStorage !== 'undefined') {
      // Las URLs blob: de archivos temporales no sobreviven recargas, pero sí playlists y ajustes
      const persistable: WebDbState = {
        ...state,
        tracks: state.tracks.filter((t) => !t.uri.startsWith('blob:')),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    }
  } catch { }
}

function sortTracks(list: Track[], sortBy: SortOption): Track[] {
  const copy = [...list];
  switch (sortBy) {
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
    case 'date_desc':
    default:
      return copy.sort((a, b) => b.creationTime - a.creationTime);
  }
}

export async function updateTrackMetadata(
  trackId: string,
  metadata: Partial<Pick<Track, 'title' | 'artist' | 'album' | 'artworkUri' | 'dominantColor'>>
): Promise<void> {
  const state = loadState();
  state.tracks = state.tracks.map((t) =>
    t.id === trackId
      ? {
          ...t,
          title: t.isCustomEdited ? t.title : (metadata.title ?? t.title),
          artist: t.isCustomEdited ? t.artist : (metadata.artist ?? t.artist),
          album: metadata.album ?? t.album,
          artworkUri: t.isCustomEdited ? t.artworkUri : (metadata.artworkUri ?? null),
          dominantColor: t.isCustomEdited ? t.dominantColor : (metadata.dominantColor ?? null),
        }
      : t
  );
  saveState(state);
}

export async function saveEditedTrackData(
  trackId: string,
  data: {
    title: string;
    artist: string;
    artworkUri: string | null;
    dominantColor: string | null;
    lyricsText?: string | null;
  }
): Promise<void> {
  const state = loadState();
  const cleanTitle = data.title.trim() || 'Sin título';
  const cleanArtist = data.artist.trim() || 'Artista desconocido';
  state.tracks = state.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const nextLyrics = data.lyricsText !== undefined ? (data.lyricsText?.trim() ?? '') : t.lyricsText;
    return {
      ...t,
      title: cleanTitle,
      artist: cleanArtist,
      artworkUri: data.artworkUri,
      dominantColor: data.dominantColor,
      isCustomEdited: true,
      ...(data.lyricsText !== undefined
        ? { lyricsText: nextLyrics, hasLyrics: Boolean(nextLyrics && nextLyrics.length > 0) }
        : {}),
    };
  });
  saveState(state);
}

export async function getTrackLyrics(trackId: string): Promise<string | null> {
  const state = loadState();
  const found = state.tracks.find((t) => t.id === trackId);
  const text = found?.lyricsText?.trim();
  return text ? text : null;
}

export async function updateTrackLyrics(trackId: string, lyricsText: string | null): Promise<void> {
  const state = loadState();
  const clean = lyricsText?.trim() ?? '';
  state.tracks = state.tracks.map((t) =>
    t.id === trackId ? { ...t, lyricsText: clean, hasLyrics: clean.length > 0 } : t
  );
  saveState(state);
}

export async function upsertScannedTracks(tracks: Track[]): Promise<void> {
  if (tracks.length === 0) return;
  const state = loadState();
  const map = new Map(state.tracks.map((t) => [t.id, t]));
  for (const t of tracks) {
    const existing = map.get(t.id);
    map.set(
      t.id,
      existing
        ? {
            ...existing,
            uri: t.uri,
            filename: t.filename,
            duration: t.duration,
            folderPath: t.folderPath,
            creationTime: t.creationTime,
          }
        : { ...t }
    );
  }
  state.tracks = Array.from(map.values());
  saveState(state);
}

export async function getVisibleTracks(sortBy: SortOption = 'date_desc'): Promise<Track[]> {
  const state = loadState();
  return sortTracks(
    state.tracks.filter((t) => !t.isHidden && !t.isDeleted),
    sortBy
  );
}

export async function searchTracks(query: string): Promise<Track[]> {
  const clean = query.trim().toLowerCase();
  if (!clean) return [];
  const state = loadState();
  return state.tracks
    .filter(
      (t) =>
        !t.isHidden &&
        !t.isDeleted &&
        (t.title.toLowerCase().includes(clean) ||
          t.artist.toLowerCase().includes(clean) ||
          (t.lyricsText ?? '').toLowerCase().includes(clean))
    )
    .sort((a, b) => {
      const pa = a.title.toLowerCase().includes(clean) ? 1 : a.artist.toLowerCase().includes(clean) ? 2 : 3;
      const pb = b.title.toLowerCase().includes(clean) ? 1 : b.artist.toLowerCase().includes(clean) ? 2 : 3;
      return pa - pb || a.title.localeCompare(b.title);
    });
}

export async function getSearchHistory(): Promise<string[]> {
  const state = loadState();
  return [...state.searchHistory]
    .sort((a, b) => b.searchedAt - a.searchedAt)
    .slice(0, 10)
    .map((item) => item.query);
}

export async function addSearchHistory(query: string): Promise<void> {
  const clean = query.trim();
  if (!clean) return;
  const state = loadState();
  state.searchHistory = [
    { query: clean, searchedAt: Date.now() },
    ...state.searchHistory.filter((item) => item.query !== clean),
  ].slice(0, 10);
  saveState(state);
}

export async function getPlaylists(): Promise<Playlist[]> {
  const state = loadState();
  const trackMap = new Map(state.tracks.filter((t) => !t.isDeleted).map((t) => [t.id, t]));
  return [...state.playlists]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => {
      const items = state.playlistTracks
        .filter((pt) => pt.playlistId === p.id && trackMap.has(pt.trackId))
        .sort((a, b) => b.position - a.position);
      return {
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        trackCount: items.length,
        recentArtworks: items.slice(0, 4).map((pt) => trackMap.get(pt.trackId)?.artworkUri ?? null),
      };
    });
}

export async function createPlaylist(name: string): Promise<Playlist> {
  const state = loadState();
  const created: Playlist = {
    id: `pl_${Date.now()}`,
    name: name.trim(),
    createdAt: Date.now(),
    trackCount: 0,
    recentArtworks: [],
  };
  state.playlists.push({ id: created.id, name: created.name, createdAt: created.createdAt });
  saveState(state);
  return created;
}

export async function getAutoPlaylistTracks(
  type: 'favorites' | 'recent' | 'most_played' | 'with_lyrics'
): Promise<Track[]> {
  const state = loadState();
  const alive = state.tracks.filter((t) => !t.isDeleted);
  switch (type) {
    case 'favorites':
      return alive.filter((t) => t.isFavorite).sort((a, b) => a.title.localeCompare(b.title));
    case 'recent':
      return alive
        .filter((t) => (t.lastPlayedAt ?? 0) > 0)
        .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
        .slice(0, 50);
    case 'most_played':
      return alive
        .filter((t) => t.playCount > 0)
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, 50);
    case 'with_lyrics':
      return alive.filter((t) => t.hasLyrics).sort((a, b) => a.title.localeCompare(b.title));
  }
}

export async function getFolders(includeHidden = false): Promise<FolderItem[]> {
  const state = loadState();
  const counts = new Map<string, number>();
  for (const t of state.tracks) {
    if (t.isDeleted) continue;
    if (!includeHidden && t.isHidden) continue;
    counts.set(t.folderPath, (counts.get(t.folderPath) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, trackCount]) => {
      const parts = path.split('/');
      return { path, name: parts[parts.length - 1] || path, trackCount };
    });
}

export async function getDeletedTracks(): Promise<Track[]> {
  return loadState()
    .tracks.filter((t) => t.isDeleted)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function restoreTrack(trackId: string): Promise<void> {
  const state = loadState();
  state.tracks = state.tracks.map((t) => (t.id === trackId ? { ...t, isDeleted: false } : t));
  saveState(state);
}

export async function emptyTrash(): Promise<void> {
  const state = loadState();
  state.tracks = state.tracks.filter((t) => !t.isDeleted);
  saveState(state);
}

export async function getAppSetting(key: string): Promise<string | null> {
  return loadState().appSettings[key] ?? null;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const state = loadState();
  state.appSettings[key] = value;
  saveState(state);
}

export async function markTrackPlayed(trackId: string): Promise<void> {
  const state = loadState();
  state.tracks = state.tracks.map((t) =>
    t.id === trackId ? { ...t, playCount: t.playCount + 1, lastPlayedAt: Date.now() } : t
  );
  saveState(state);
}

export async function toggleTrackFavorite(trackId: string, isFavorite: boolean): Promise<void> {
  const state = loadState();
  state.tracks = state.tracks.map((t) => (t.id === trackId ? { ...t, isFavorite } : t));
  saveState(state);
}

export async function hideTrack(trackId: string): Promise<void> {
  const state = loadState();
  state.tracks = state.tracks.map((t) => (t.id === trackId ? { ...t, isHidden: true } : t));
  saveState(state);
}

export async function softDeleteTrack(trackId: string): Promise<void> {
  const state = loadState();
  state.tracks = state.tracks.map((t) => (t.id === trackId ? { ...t, isDeleted: true } : t));
  saveState(state);
}

export async function softDeleteTracks(trackIds: string[]): Promise<void> {
  if (trackIds.length === 0) return;
  const set = new Set(trackIds);
  const state = loadState();
  state.tracks = state.tracks.map((t) => (set.has(t.id) ? { ...t, isDeleted: true } : t));
  saveState(state);
}

export async function addTrackToPlaylist(playlistId: string, trackId: string): Promise<void> {
  await addTracksToPlaylist(playlistId, [trackId]);
}

export async function addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<number> {
  const state = loadState();
  const existing = new Set(
    state.playlistTracks.filter((pt) => pt.playlistId === playlistId).map((pt) => pt.trackId)
  );
  let maxPos = state.playlistTracks
    .filter((pt) => pt.playlistId === playlistId)
    .reduce((acc, item) => Math.max(acc, item.position), -1);
  let inserted = 0;

  for (const trackId of trackIds) {
    if (existing.has(trackId)) continue;
    maxPos += 1;
    state.playlistTracks.push({ playlistId, trackId, position: maxPos });
    existing.add(trackId);
    inserted += 1;
  }
  saveState(state);
  return inserted;
}

export async function getTracksByFolder(folderPath: string, includeHidden = false): Promise<Track[]> {
  return loadState()
    .tracks.filter(
      (t) => t.folderPath === folderPath && !t.isDeleted && (includeHidden || !t.isHidden)
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getTracksByArtist(artist: string): Promise<Track[]> {
  return loadState()
    .tracks.filter((t) => t.artist === artist && !t.isHidden && !t.isDeleted)
    .sort((a, b) => a.album.localeCompare(b.album) || a.title.localeCompare(b.title));
}

export async function getTracksByAlbum(album: string): Promise<Track[]> {
  return loadState()
    .tracks.filter((t) => t.album === album && !t.isHidden && !t.isDeleted)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getArtistsSummary(): Promise<
  { name: string; trackCount: number; recentArtworks: (string | null)[] }[]
> {
  const visible = loadState().tracks.filter((t) => !t.isHidden && !t.isDeleted);
  const groups = new Map<string, Track[]>();
  for (const t of visible) {
    const arr = groups.get(t.artist) ?? [];
    arr.push(t);
    groups.set(t.artist, arr);
  }
  return Array.from(groups.entries())
    .map(([name, list]) => ({
      name,
      trackCount: list.length,
      recentArtworks: [...list]
        .sort((a, b) => b.creationTime - a.creationTime)
        .slice(0, 4)
        .map((t) => t.artworkUri),
    }))
    .sort((a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name));
}

export async function getAlbumsSummary(): Promise<
  { name: string; trackCount: number; recentArtworks: (string | null)[] }[]
> {
  const visible = loadState().tracks.filter((t) => !t.isHidden && !t.isDeleted);
  const groups = new Map<string, Track[]>();
  for (const t of visible) {
    const arr = groups.get(t.album) ?? [];
    arr.push(t);
    groups.set(t.album, arr);
  }
  return Array.from(groups.entries())
    .map(([name, list]) => ({
      name,
      trackCount: list.length,
      recentArtworks: [...list]
        .sort((a, b) => b.creationTime - a.creationTime)
        .slice(0, 4)
        .map((t) => t.artworkUri),
    }))
    .sort((a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name));
}

export async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  const state = loadState();
  const trackMap = new Map(state.tracks.filter((t) => !t.isDeleted).map((t) => [t.id, t]));
  return state.playlistTracks
    .filter((pt) => pt.playlistId === playlistId)
    .sort((a, b) => a.position - b.position)
    .map((pt) => trackMap.get(pt.trackId))
    .filter((t): t is Track => Boolean(t));
}

export async function removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
  const state = loadState();
  state.playlistTracks = state.playlistTracks.filter(
    (pt) => !(pt.playlistId === playlistId && pt.trackId === trackId)
  );
  saveState(state);
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  const state = loadState();
  state.playlistTracks = state.playlistTracks.filter((pt) => pt.playlistId !== playlistId);
  state.playlists = state.playlists.filter((p) => p.id !== playlistId);
  saveState(state);
}
