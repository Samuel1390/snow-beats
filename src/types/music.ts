// Tipos principales para canciones, ordenamiento y pestañas
export type SortOption =
    | 'date_desc'
    | 'most_played'
    | 'title_asc'
    | 'title_desc'
    | 'artist_asc'
    | 'artist_desc'
    | 'duration_asc'
    | 'duration_desc';

export type MainTab =
    | 'downloads'
    | 'songs'
    | 'playlists'
    | 'folders'
    | 'artists'
    | 'albums'
    | 'videos';

export interface Track {
    id: string;
    uri: string;
    filename: string;
    title: string;
    artist: string;
    album: string;
    duration: number; // Duración en segundos
    artworkUri: string | null;
    hasLyrics: boolean;
    folderPath: string;
    creationTime: number;
    playCount: number;
    isFavorite: boolean;
    isHidden: boolean;
    isDeleted: boolean;
    dominantColor?: string | null;
}