import * as SQLite from 'expo-sqlite';
import { SortOption, Track } from '../../types/music';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  trackCount: number;
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
      is_deleted INTEGER DEFAULT 0
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
  };
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

// Playlists manuales y automáticas
export async function getPlaylists(): Promise<Playlist[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT p.id, p.name, p.created_at, COUNT(pt.track_id) as track_count
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
     GROUP BY p.id
     ORDER BY p.created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    trackCount: r.track_count,
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
  return { id, name: name.trim(), createdAt, trackCount: 0 };
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

// Artistas con las 4 portadas más recientes
export async function getArtistsSummary(): Promise<
  { name: string; trackCount: number; recentArtworks: (string | null)[] }[]
> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ artist: string; c: number }>(
    `SELECT artist, COUNT(*) as c FROM tracks WHERE is_hidden = 0 AND is_deleted = 0 GROUP BY artist ORDER BY artist COLLATE NOCASE ASC`
  );
  const result = [];
  for (const r of rows) {
    const arts = await db.getAllAsync<{ artwork_uri: string | null }>(
      `SELECT artwork_uri FROM tracks WHERE artist = ? AND is_hidden = 0 AND is_deleted = 0 ORDER BY creation_time DESC LIMIT 4`,
      [r.artist]
    );
    result.push({ name: r.artist, trackCount: r.c, recentArtworks: arts.map((a) => a.artwork_uri) });
  }
  return result;
}

// Álbumes con las 4 portadas más recientes
export async function getAlbumsSummary(): Promise<
  { name: string; trackCount: number; recentArtworks: (string | null)[] }[]
> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ album: string; c: number }>(
    `SELECT album, COUNT(*) as c FROM tracks WHERE is_hidden = 0 AND is_deleted = 0 GROUP BY album ORDER BY album COLLATE NOCASE ASC`
  );
  const result = [];
  for (const r of rows) {
    const arts = await db.getAllAsync<{ artwork_uri: string | null }>(
      `SELECT artwork_uri FROM tracks WHERE album = ? AND is_hidden = 0 AND is_deleted = 0 ORDER BY creation_time DESC LIMIT 4`,
      [r.album]
    );
    result.push({ name: r.album, trackCount: r.c, recentArtworks: arts.map((a) => a.artwork_uri) });
  }
  return result;
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