import * as SQLite from 'expo-sqlite';
import { SortOption, Track } from '../../types/music';

let dbInstance: SQLite.SQLiteDatabase | null = null;

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

// Inicializa la base de datos SQLite local y crea todas las tablas
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;

  const db = await SQLite.openDatabaseAsync('snow_beats.db');

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY NOT NULL,
      uri TEXT NOT NULL,
      filename TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      duration REAL NOT NULL,
      artwork_uri TEXT,
      has_lyrics INTEGER DEFAULT 0,
      lyrics_text TEXT DEFAULT '',
      folder_path TEXT NOT NULL,
      creation_time INTEGER NOT NULL,
      last_played_at INTEGER DEFAULT 0,
      play_count INTEGER DEFAULT 0,
      is_favorite INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      dominant_color TEXT
    );

    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT UNIQUE NOT NULL,
      searched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_visible ON tracks(is_deleted, is_hidden, creation_time DESC);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pid ON playlist_tracks(playlist_id, position DESC);
  `);

  // Migraciones seguras para columnas nuevas si la BD ya existía de Fase 1
  try { await db.execAsync(`ALTER TABLE tracks ADD COLUMN lyrics_text TEXT DEFAULT ''`); } catch { }
  try { await db.execAsync(`ALTER TABLE tracks ADD COLUMN last_played_at INTEGER DEFAULT 0`); } catch { }
  try { await db.execAsync(`ALTER TABLE tracks ADD COLUMN dominant_color TEXT`); } catch { }

  dbInstance = db;
  return db;
}

function mapRowToTrack(row: any): Track {
  return {
    id: row.id,
    uri: row.uri,
    filename: row.filename,
    title: row.title,
    artist: row.artist,
    album: row.album,
    duration: row.duration,
    artworkUri: row.artwork_uri,
    hasLyrics: Boolean(row.has_lyrics),
    folderPath: row.folder_path,
    creationTime: row.creation_time,
    playCount: row.play_count,
    isFavorite: Boolean(row.is_favorite),
    isHidden: Boolean(row.is_hidden),
    isDeleted: Boolean(row.is_deleted),
    dominantColor: row.dominant_color ?? null,
  };
}

// Actualiza etiquetas ID3, carátula y color dominante de una pista
export async function updateTrackMetadata(
  trackId: string,
  metadata: Partial<Pick<Track, 'title' | 'artist' | 'album' | 'artworkUri' | 'dominantColor'>>
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE tracks
     SET title = COALESCE(?, title),
         artist = COALESCE(?, artist),
         album = COALESCE(?, album),
         artwork_uri = ?,
         dominant_color = ?
     WHERE id = ?`,
    [
      metadata.title ?? null,
      metadata.artist ?? null,
      metadata.album ?? null,
      metadata.artworkUri ?? null,
      metadata.dominantColor ?? null,
      trackId,
    ]
  );
}

// Inserta o actualiza canciones en lotes de 50
export async function upsertScannedTracks(tracks: Track[]): Promise<void> {
  if (tracks.length === 0) return;
  const db = await getDatabase();
  const chunkSize = 50;

  for (let i = 0; i < tracks.length; i += chunkSize) {
    const chunk = tracks.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values: (string | number | null)[] = [];

    for (const track of chunk) {
      values.push(
        track.id, track.uri, track.filename, track.title, track.artist,
        track.album, track.duration, track.artworkUri, track.hasLyrics ? 1 : 0,
        track.folderPath, track.creationTime
      );
    }

    await db.runAsync(
      `INSERT INTO tracks (
        id, uri, filename, title, artist, album, duration,
        artwork_uri, has_lyrics, folder_path, creation_time
      ) VALUES ${placeholders}
      ON CONFLICT(id) DO UPDATE SET
        uri = excluded.uri,
        filename = excluded.filename,
        duration = excluded.duration,
        folder_path = excluded.folder_path,
        creation_time = excluded.creation_time`,
      values
    );
  }
}

// Obtiene las canciones visibles ordenadas (por defecto: más reciente)
export async function getVisibleTracks(sortBy: SortOption = 'date_desc'): Promise<Track[]> {
  const db = await getDatabase();
  const orderMap: Record<SortOption, string> = {
    date_desc: 'creation_time DESC',
    most_played: 'play_count DESC, title COLLATE NOCASE ASC',
    title_asc: 'title COLLATE NOCASE ASC',
    title_desc: 'title COLLATE NOCASE DESC',
    artist_asc: 'artist COLLATE NOCASE ASC, title COLLATE NOCASE ASC',
    artist_desc: 'artist COLLATE NOCASE DESC, title COLLATE NOCASE ASC',
    duration_asc: 'duration ASC',
    duration_desc: 'duration DESC',
  };

  const rows = await db.getAllAsync<any>(
    `SELECT * FROM tracks WHERE is_hidden = 0 AND is_deleted = 0 ORDER BY ${orderMap[sortBy]}`
  );
  return rows.map(mapRowToTrack);
}

// Búsqueda con prioridad: 1.º título, 2.º artista, 3.º letras
export async function searchTracks(query: string): Promise<Track[]> {
  const clean = query.trim();
  if (!clean) return [];
  const db = await getDatabase();
  const like = `%${clean}%`;

  const rows = await db.getAllAsync<any>(
    `SELECT *,
      CASE
        WHEN title LIKE ? COLLATE NOCASE THEN 1
        WHEN artist LIKE ? COLLATE NOCASE THEN 2
        ELSE 3
      END AS priority
     FROM tracks
     WHERE is_hidden = 0 AND is_deleted = 0
       AND (title LIKE ? COLLATE NOCASE OR artist LIKE ? COLLATE NOCASE OR lyrics_text LIKE ? COLLATE NOCASE)
     ORDER BY priority ASC, title COLLATE NOCASE ASC`,
    [like, like, like, like, like]
  );
  return rows.map(mapRowToTrack);
}

// Historial de las últimas 10 búsquedas
export async function getSearchHistory(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ query: string }>(
    `SELECT query FROM search_history ORDER BY searched_at DESC LIMIT 10`
  );
  return rows.map((r) => r.query);
}

export async function addSearchHistory(query: string): Promise<void> {
  const clean = query.trim();
  if (!clean) return;
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO search_history (query, searched_at) VALUES (?, ?)
     ON CONFLICT(query) DO UPDATE SET searched_at = excluded.searched_at`,
    [clean, Date.now()]
  );
  await db.runAsync(
    `DELETE FROM search_history WHERE id NOT IN (
       SELECT id FROM search_history ORDER BY searched_at DESC LIMIT 10
     )`
  );
}

// Playlists manuales con sus 4 portadas más recientes en 2 consultas sin N+1
export async function getPlaylists(): Promise<Playlist[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT p.id, p.name, p.created_at, COUNT(t.id) as track_count
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
     LEFT JOIN tracks t ON t.id = pt.track_id AND t.is_deleted = 0
     GROUP BY p.id
     ORDER BY p.created_at DESC`
  );

  // Obtiene las carátulas de todas las playlists en una sola consulta ordenada por posición reciente
  const artRows = await db.getAllAsync<{ playlist_id: string; artwork_uri: string | null }>(
    `SELECT pt.playlist_id, t.artwork_uri
     FROM playlist_tracks pt
     INNER JOIN tracks t ON t.id = pt.track_id AND t.is_deleted = 0
     ORDER BY pt.position DESC`
  );

  const artMap = new Map<string, (string | null)[]>();
  for (const ar of artRows) {
    const arr = artMap.get(ar.playlist_id) ?? [];
    if (arr.length < 4) {
      arr.push(ar.artwork_uri ?? null);
      artMap.set(ar.playlist_id, arr);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    trackCount: r.track_count,
    recentArtworks: artMap.get(r.id) ?? [],
  }));
}

export async function createPlaylist(name: string): Promise<Playlist> {
  const db = await getDatabase();
  const id = `pl_${Date.now()}`;
  const createdAt = Date.now();
  await db.runAsync(`INSERT INTO playlists (id, name, created_at) VALUES (?, ?, ?)`, [
    id,
    name.trim(),
    createdAt,
  ]);
  return { id, name: name.trim(), createdAt, trackCount: 0, recentArtworks: [] };
}

export async function getAutoPlaylistTracks(
  type: 'favorites' | 'recent' | 'most_played' | 'with_lyrics'
): Promise<Track[]> {
  const db = await getDatabase();
  const queries: Record<typeof type, string> = {
    favorites: `SELECT * FROM tracks WHERE is_favorite = 1 AND is_deleted = 0 ORDER BY title COLLATE NOCASE ASC`,
    recent: `SELECT * FROM tracks WHERE last_played_at > 0 AND is_deleted = 0 ORDER BY last_played_at DESC LIMIT 50`,
    most_played: `SELECT * FROM tracks WHERE play_count > 0 AND is_deleted = 0 ORDER BY play_count DESC LIMIT 50`,
    with_lyrics: `SELECT * FROM tracks WHERE has_lyrics = 1 AND is_deleted = 0 ORDER BY title COLLATE NOCASE ASC`,
  };
  const rows = await db.getAllAsync<any>(queries[type]);
  return rows.map(mapRowToTrack);
}

// Carpetas del dispositivo (con soporte para incluir archivos ocultos)
export async function getFolders(includeHidden = false): Promise<FolderItem[]> {
  const db = await getDatabase();
  const whereHidden = includeHidden ? '' : 'AND is_hidden = 0';
  const rows = await db.getAllAsync<{ folder_path: string; track_count: number }>(
    `SELECT folder_path, COUNT(*) as track_count
     FROM tracks
     WHERE is_deleted = 0 ${whereHidden}
     GROUP BY folder_path
     ORDER BY folder_path ASC`
  );
  return rows.map((r) => {
    const parts = r.folder_path.split('/');
    return {
      path: r.folder_path,
      name: parts[parts.length - 1] || r.folder_path,
      trackCount: r.track_count,
    };
  });
}

// Papelera interna (Eliminados recientemente)
export async function getDeletedTracks(): Promise<Track[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(`SELECT * FROM tracks WHERE is_deleted = 1 ORDER BY title ASC`);
  return rows.map(mapRowToTrack);
}

export async function restoreTrack(trackId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE tracks SET is_deleted = 0 WHERE id = ?`, [trackId]);
}

export async function emptyTrash(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM tracks WHERE is_deleted = 1`);
}

// Preferencias locales clave-valor (tema, idioma, estadísticas)
export async function getAppSetting(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = ?`,
    [key]
  );
  return row ? row.value : null;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

// Registra reproducción para "Recientemente reproducidas" y "Más reproducido"
export async function markTrackPlayed(trackId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE tracks SET play_count = play_count + 1, last_played_at = ? WHERE id = ?`,
    [Date.now(), trackId]
  );
}

// Alterna estado de favorito
export async function toggleTrackFavorite(trackId: string, isFavorite: boolean): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE tracks SET is_favorite = ? WHERE id = ?`, [
    isFavorite ? 1 : 0,
    trackId,
  ]);
}

// Oculta una canción de la lista principal
export async function hideTrack(trackId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE tracks SET is_hidden = 1 WHERE id = ?`, [trackId]);
}

// Mueve una canción a la papelera interna ("Eliminados recientemente")
export async function softDeleteTrack(trackId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE tracks SET is_deleted = 1 WHERE id = ?`, [trackId]);
}

// Mueve varias canciones a la papelera interna en una sola operación
export async function softDeleteTracks(trackIds: string[]): Promise<void> {
  if (trackIds.length === 0) return;
  const db = await getDatabase();
  const placeholders = trackIds.map(() => '?').join(', ');
  await db.runAsync(`UPDATE tracks SET is_deleted = 1 WHERE id IN (${placeholders})`, trackIds);
}

// Agrega una canción a una playlist existente
export async function addTrackToPlaylist(playlistId: string, trackId: string): Promise<void> {
  const db = await getDatabase();
  const countRow = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM playlist_tracks WHERE playlist_id = ?`,
    [playlistId]
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`,
    [playlistId, trackId, countRow?.c ?? 0]
  );
}

// Agrega múltiples canciones a una playlist respetando la posición secuencial
export async function addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<number> {
  if (trackIds.length === 0) return 0;
  const db = await getDatabase();
  const maxRow = await db.getFirstAsync<{ maxPos: number | null }>(
    `SELECT MAX(position) as maxPos FROM playlist_tracks WHERE playlist_id = ?`,
    [playlistId]
  );
  let nextPos = (maxRow?.maxPos ?? -1) + 1;
  let inserted = 0;

  for (const trackId of trackIds) {
    const res = await db.runAsync(
      `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)`,
      [playlistId, trackId, nextPos]
    );
    if (res.changes > 0) {
      nextPos += 1;
      inserted += 1;
    }
  }
  return inserted;
}

// Obtiene las canciones de una carpeta específica
export async function getTracksByFolder(
  folderPath: string,
  includeHidden = false
): Promise<Track[]> {
  const db = await getDatabase();
  const whereHidden = includeHidden ? '' : 'AND is_hidden = 0';
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM tracks
     WHERE folder_path = ? AND is_deleted = 0 ${whereHidden}
     ORDER BY title COLLATE NOCASE ASC`,
    [folderPath]
  );
  return rows.map(mapRowToTrack);
}

// Obtiene las canciones de un artista específico
export async function getTracksByArtist(artist: string): Promise<Track[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM tracks
     WHERE artist = ? AND is_hidden = 0 AND is_deleted = 0
     ORDER BY album COLLATE NOCASE ASC, title COLLATE NOCASE ASC`,
    [artist]
  );
  return rows.map(mapRowToTrack);
}

// Obtiene las canciones de un álbum específico
export async function getTracksByAlbum(album: string): Promise<Track[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM tracks
     WHERE album = ? AND is_hidden = 0 AND is_deleted = 0
     ORDER BY title COLLATE NOCASE ASC`,
    [album]
  );
  return rows.map(mapRowToTrack);
}

// Artistas en una sola consulta rápida, ordenados de mayor a menor cantidad de canciones
export async function getArtistsSummary(): Promise<
  { name: string; trackCount: number; recentArtworks: (string | null)[] }[]
> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ artist: string; artwork_uri: string | null }>(
    `SELECT artist, artwork_uri
     FROM tracks
     WHERE is_hidden = 0 AND is_deleted = 0
     ORDER BY creation_time DESC`
  );

  const map = new Map<string, { name: string; trackCount: number; recentArtworks: (string | null)[] }>();
  for (const r of rows) {
    let entry = map.get(r.artist);
    if (!entry) {
      entry = { name: r.artist, trackCount: 0, recentArtworks: [] };
      map.set(r.artist, entry);
    }
    entry.trackCount += 1;
    if (entry.recentArtworks.length < 4) {
      entry.recentArtworks.push(r.artwork_uri ?? null);
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name)
  );
}

// Álbumes en una sola consulta rápida, ordenados de mayor a menor cantidad de canciones
export async function getAlbumsSummary(): Promise<
  { name: string; trackCount: number; recentArtworks: (string | null)[] }[]
> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ album: string; artwork_uri: string | null }>(
    `SELECT album, artwork_uri
     FROM tracks
     WHERE is_hidden = 0 AND is_deleted = 0
     ORDER BY creation_time DESC`
  );

  const map = new Map<string, { name: string; trackCount: number; recentArtworks: (string | null)[] }>();
  for (const r of rows) {
    let entry = map.get(r.album);
    if (!entry) {
      entry = { name: r.album, trackCount: 0, recentArtworks: [] };
      map.set(r.album, entry);
    }
    entry.trackCount += 1;
    if (entry.recentArtworks.length < 4) {
      entry.recentArtworks.push(r.artwork_uri ?? null);
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name)
  );
}

// Obtiene las canciones de una playlist manual
export async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT t.* FROM tracks t
     INNER JOIN playlist_tracks pt ON t.id = pt.track_id
     WHERE pt.playlist_id = ? AND t.is_deleted = 0
     ORDER BY pt.position ASC`,
    [playlistId]
  );
  return rows.map(mapRowToTrack);
}

// Quita una canción de una playlist manual o elimina la playlist completa
export async function removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?`, [playlistId, trackId]);
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM playlist_tracks WHERE playlist_id = ?`, [playlistId]);
  await db.runAsync(`DELETE FROM playlists WHERE id = ?`, [playlistId]);
}