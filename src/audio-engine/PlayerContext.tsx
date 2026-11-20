import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { readTrackTags } from '../../modules/snow-metadata';
import {
    hideTrack,
    markTrackPlayed,
    softDeleteTrack,
    toggleTrackFavorite,
    updateTrackMetadata,
} from '../storage/database/db';
import { Track } from '../types/music';

export type RepeatMode = 'repeat_all' | 'repeat_one' | 'shuffle';
export const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

// Contexto principal SIN position/duration para evitar re-renders cada 400ms en toda la app
interface PlayerContextValue {
    currentTrack: Track | null;
    isPlaying: boolean;
    repeatMode: RepeatMode;
    playbackRate: number;
    pitch: number;
    playTrack: (track: Track, newQueue?: Track[]) => Promise<void>;
    togglePlayPause: () => void;
    pausePlayback: () => void;
    playNext: () => Promise<void>;
    playPrevious: () => Promise<void>;
    seekTo: (seconds: number) => void;
    cycleRepeatMode: () => void;
    setSpeed: (rate: number) => void;
    setPitchValue: (val: number) => void;
    toggleFavorite: () => Promise<void>;
    hideCurrentTrack: () => Promise<void>;
    deleteCurrentTrack: () => Promise<void>;
    addToQueue: (tracks: Track[]) => void;
}

interface ProgressValue {
    position: number;
    duration: number;
}

const PlayerProgressContext = createContext<ProgressValue>({ position: 0, duration: 0 });
export const usePlayerProgress = () => useContext(PlayerProgressContext);

const PlayerContext = createContext<PlayerContextValue | null>(null);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const playerRef = useRef<AudioPlayer | null>(null);
    const playRequestIdRef = useRef<number>(0); // Cancela cargas viejas si el usuario spamea
    const hasEndedRef = useRef<boolean>(false); // Evita disparar playNext() dos veces al terminar

    const queueRef = useRef<Track[]>([]);
    const currentIndexRef = useRef<number>(-1);
    const currentTrackRef = useRef<Track | null>(null);
    const repeatModeRef = useRef<RepeatMode>('repeat_all');
    const playbackRateRef = useRef<number>(1);
    const pitchRef = useRef<number>(1);

    const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [repeatMode, setRepeatMode] = useState<RepeatMode>('repeat_all');
    const [playbackRate, setPlaybackRate] = useState<number>(1);
    const [pitch, setPitch] = useState<number>(1);

    const addToQueue = useCallback((items: Track[]) => {
        queueRef.current = [...queueRef.current, ...items];
    }, []);

    // Configura audio en segundo plano al iniciar
    useEffect(() => {
        setAudioModeAsync({
            playsInSilentMode: true,
            shouldPlayInBackground: true,
        }).catch(() => { });

        return () => {
            playerRef.current?.remove();
        };
    }, []);

    const playTrack = useCallback(async (track: Track, newQueue?: Track[]) => {
        const requestId = ++playRequestIdRef.current;
        hasEndedRef.current = false;

        // Detiene y destruye SIEMPRE la instancia anterior antes de crear la nueva
        if (playerRef.current) {
            try {
                playerRef.current.pause();
                playerRef.current.remove();
            } catch { }
            playerRef.current = null;
        }

        if (newQueue) {
            queueRef.current = newQueue;
            currentIndexRef.current = newQueue.findIndex((t) => t.id === track.id);
        }

        const player = createAudioPlayer({ uri: track.uri });
        try {
            player.shouldCorrectPitch = pitchRef.current === 1;
            player.setPlaybackRate(playbackRateRef.current);
        } catch { }

        // Si mientras se creaba entró otro clic, descartamos este reproductor
        if (requestId !== playRequestIdRef.current) {
            player.pause();
            player.remove();
            return;
        }

        playerRef.current = player;
        player.play();

        currentTrackRef.current = track;
        setCurrentTrack(track);
        setPosition(0);
        setDuration(track.duration);
        setIsPlaying(true);

        markTrackPlayed(track.id).catch(() => { });

        // Lee etiquetas ID3 en segundo plano si aún no tiene carátula
        if (!track.artworkUri) {
            readTrackTags(track.uri, track.id)
                .then(async (tags) => {
                    if (!tags) return;
                    const updated: Track = {
                        ...track,
                        title: tags.title || track.title,
                        artist: tags.artist || track.artist,
                        album: tags.album || track.album,
                        artworkUri: tags.artworkUri ?? null,
                        dominantColor: tags.dominantColor ?? null,
                    };
                    await updateTrackMetadata(track.id, updated);
                    if (currentTrackRef.current?.id === track.id) {
                        currentTrackRef.current = updated;
                        setCurrentTrack(updated);
                    }
                })
                .catch(() => { });
        }
    }, []);

    const playNext = useCallback(async () => {
        const list = queueRef.current;
        if (list.length === 0) return;
        const nextIdx =
            repeatModeRef.current === 'shuffle'
                ? Math.floor(Math.random() * list.length)
                : (currentIndexRef.current + 1) % list.length;
        currentIndexRef.current = nextIdx;
        await playTrack(list[nextIdx]);
    }, [playTrack]);

    const playPrevious = useCallback(async () => {
        const list = queueRef.current;
        if (list.length === 0) return;
        const currentPos = playerRef.current?.currentTime ?? 0;
        if (currentPos > 3 && playerRef.current) {
            playerRef.current.seekTo(0);
            setPosition(0);
            return;
        }
        const prevIdx = (currentIndexRef.current - 1 + list.length) % list.length;
        currentIndexRef.current = prevIdx;
        await playTrack(list[prevIdx]);
    }, [playTrack]);

    // Intervalo aislado: solo actualiza PlayerProgressContext (y isPlaying únicamente si cambió)
    useEffect(() => {
        const interval = setInterval(() => {
            const p = playerRef.current;
            if (!p) return;

            const nextPos = p.currentTime ?? 0;
            const nextDur = p.duration || currentTrackRef.current?.duration || 0;
            const nextPlaying = Boolean(p.playing);

            setPosition((prev) => (Math.abs(prev - nextPos) > 0.05 ? nextPos : prev));
            setDuration((prev) => (Math.abs(prev - nextDur) > 0.1 ? nextDur : prev));
            setIsPlaying((prev) => (prev === nextPlaying ? prev : nextPlaying));

            if (p.duration > 0 && nextPos >= p.duration - 0.3 && !nextPlaying && !hasEndedRef.current) {
                hasEndedRef.current = true;
                if (repeatModeRef.current === 'repeat_one') {
                    hasEndedRef.current = false;
                    p.seekTo(0);
                    p.play();
                } else {
                    playNext();
                }
            }
        }, 400);
        return () => clearInterval(interval);
    }, [playNext]);

    const togglePlayPause = useCallback(() => {
        const p = playerRef.current;
        if (!p) return;
        if (p.playing) {
            p.pause();
            setIsPlaying(false);
        } else {
            p.play();
            setIsPlaying(true);
        }
    }, []);

    const pausePlayback = useCallback(() => {
        const p = playerRef.current;
        if (!p || !p.playing) return;
        p.pause();
        setIsPlaying(false);
    }, []);

    const seekTo = useCallback((seconds: number) => {
        playerRef.current?.seekTo(seconds);
        setPosition(seconds);
    }, []);

    const cycleRepeatMode = useCallback(() => {
        setRepeatMode((prev) => {
            const next =
                prev === 'repeat_all' ? 'repeat_one' : prev === 'repeat_one' ? 'shuffle' : 'repeat_all';
            repeatModeRef.current = next;
            return next;
        });
    }, []);

    const setSpeed = useCallback((rate: number) => {
        playbackRateRef.current = rate;
        setPlaybackRate(rate);
        if (playerRef.current) {
            try {
                playerRef.current.shouldCorrectPitch = pitchRef.current === 1;
                playerRef.current.setPlaybackRate(rate);
            } catch { }
        }
    }, []);

    const setPitchValue = useCallback((val: number) => {
        pitchRef.current = val;
        setPitch(val);
        // Nota: el pitch independiente fino se conectará al módulo Kotlin de ExoPlayer en la fase nativa
        if (playerRef.current) {
            try {
                playerRef.current.shouldCorrectPitch = val === 1;
            } catch { }
        }
    }, []);

    const toggleFavorite = useCallback(async () => {
        const curr = currentTrackRef.current;
        if (!curr) return;
        const next = !curr.isFavorite;
        const updated = { ...curr, isFavorite: next };
        currentTrackRef.current = updated;
        setCurrentTrack(updated);
        await toggleTrackFavorite(curr.id, next);
    }, []);

    const hideCurrentTrack = useCallback(async () => {
        const curr = currentTrackRef.current;
        if (!curr) return;
        await hideTrack(curr.id);
        await playNext();
    }, [playNext]);

    const deleteCurrentTrack = useCallback(async () => {
        const curr = currentTrackRef.current;
        if (!curr) return;
        await softDeleteTrack(curr.id);
        await playNext();
    }, [playNext]);

    const playerValue = useMemo<PlayerContextValue>(
        () => ({
            currentTrack,
            isPlaying,
            repeatMode,
            playbackRate,
            pitch,
            playTrack,
            togglePlayPause,
            pausePlayback,
            playNext,
            playPrevious,
            seekTo,
            cycleRepeatMode,
            setSpeed,
            setPitchValue,
            toggleFavorite,
            hideCurrentTrack,
            deleteCurrentTrack,
            addToQueue,
        }),
        [
            currentTrack,
            isPlaying,
            repeatMode,
            playbackRate,
            pitch,
            playTrack,
            togglePlayPause,
            pausePlayback,
            playNext,
            playPrevious,
            seekTo,
            cycleRepeatMode,
            setSpeed,
            setPitchValue,
            toggleFavorite,
            hideCurrentTrack,
            deleteCurrentTrack,
            addToQueue,
        ]
    );

    const progressValue = useMemo<ProgressValue>(
        () => ({ position, duration }),
        [position, duration]
    );

    return (
        <PlayerContext.Provider value={playerValue}>
            <PlayerProgressContext.Provider value={progressValue}>
                {children}
            </PlayerProgressContext.Provider>
        </PlayerContext.Provider>
    );
};

export function usePlayer(): PlayerContextValue {
    const ctx = useContext(PlayerContext);
    if (!ctx) throw new Error('usePlayer debe usarse dentro de PlayerProvider');
    return ctx;
}