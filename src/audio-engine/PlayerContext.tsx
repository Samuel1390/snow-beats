import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { readTrackTags } from '../../modules/snow-metadata';
import { updateTrackMetadata } from '../storage/database/db';
import { Track } from '../types/music';
import {
    hideTrack,
    markTrackPlayed,
    softDeleteTrack,
    toggleTrackFavorite,
} from '../storage/database/db';

export type RepeatMode = 'repeat_all' | 'repeat_one' | 'shuffle';
export const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface PlayerContextValue {
    currentTrack: Track | null;
    isPlaying: boolean;
    position: number;
    duration: number;
    repeatMode: RepeatMode;
    playbackRate: number;
    pitch: number;
    playTrack: (track: Track, newQueue?: Track[]) => Promise<void>;
    togglePlayPause: () => void;
    playNext: () => Promise<void>;
    playPrevious: () => Promise<void>;
    seekTo: (seconds: number) => void;
    cycleRepeatMode: () => void;
    setSpeed: (rate: number) => void;
    setPitchValue: (val: number) => void;
    toggleFavorite: () => Promise<void>;
    hideCurrentTrack: () => Promise<void>;
    deleteCurrentTrack: () => Promise<void>;
    addToQueue: (tracks: Track[]) => void

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

    const [queue, setQueue] = useState<Track[]>([]);
    const [currentIndex, setCurrentIndex] = useState<number>(-1);
    const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [repeatMode, setRepeatMode] = useState<RepeatMode>('repeat_all');
    const [playbackRate, setPlaybackRate] = useState<number>(1);
    const [pitch, setPitch] = useState<number>(1);
    const addToQueue = (items: Track[]) => setQueue((prev) => [...prev, ...items]);

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

    useEffect(() => {
        const interval = setInterval(() => {
            const p = playerRef.current;
            if (!p) return;
            setPosition(p.currentTime ?? 0);
            setDuration(p.duration || currentTrack?.duration || 0);
            setIsPlaying(Boolean(p.playing));

            if (p.duration > 0 && p.currentTime >= p.duration - 0.3 && !p.playing && !hasEndedRef.current) {
                hasEndedRef.current = true;
                if (repeatMode === 'repeat_one') {
                    hasEndedRef.current = false;
                    p.seekTo(0);
                    p.play();
                } else {
                    playNext();
                }
            }
        }, 400);
        return () => clearInterval(interval);
    }, [currentTrack, repeatMode, queue, currentIndex]);

    const playTrack = async (track: Track, newQueue?: Track[]) => {
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
            setQueue(newQueue);
            setCurrentIndex(newQueue.findIndex((t) => t.id === track.id));
        }

        const player = createAudioPlayer({ uri: track.uri });
        try {
            player.shouldCorrectPitch = pitch === 1;
            player.setPlaybackRate(playbackRate);
        } catch { }

        // Si mientras se creaba entró otro clic, descartamos este reproductor
        if (requestId !== playRequestIdRef.current) {
            player.pause();
            player.remove();
            return;
        }

        playerRef.current = player;
        player.play();

        setCurrentTrack(track);
        setPosition(0);
        setDuration(track.duration);
        setIsPlaying(true);

        await markTrackPlayed(track.id);

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
                    setCurrentTrack((curr) => (curr?.id === track.id ? updated : curr));
                })
                .catch(() => { });
        }
    };
    const togglePlayPause = () => {
        const p = playerRef.current;
        if (!p) return;
        if (p.playing) {
            p.pause();
            setIsPlaying(false);
        } else {
            p.play();
            setIsPlaying(true);
        }
    };

    const playNext = async () => {
        if (queue.length === 0) return;
        const nextIdx =
            repeatMode === 'shuffle'
                ? Math.floor(Math.random() * queue.length)
                : (currentIndex + 1) % queue.length;
        setCurrentIndex(nextIdx);
        await playTrack(queue[nextIdx]);
    };

    const playPrevious = async () => {
        if (queue.length === 0) return;
        if (position > 3 && playerRef.current) {
            playerRef.current.seekTo(0);
            return;
        }
        const prevIdx = (currentIndex - 1 + queue.length) % queue.length;
        setCurrentIndex(prevIdx);
        await playTrack(queue[prevIdx]);
    };

    const seekTo = (seconds: number) => {
        playerRef.current?.seekTo(seconds);
        setPosition(seconds);
    };

    const cycleRepeatMode = () => {
        setRepeatMode((prev) =>
            prev === 'repeat_all' ? 'repeat_one' : prev === 'repeat_one' ? 'shuffle' : 'repeat_all'
        );
    };

    const setSpeed = (rate: number) => {
        setPlaybackRate(rate);
        if (playerRef.current) {
            playerRef.current.shouldCorrectPitch = pitch === 1;
            playerRef.current.setPlaybackRate(rate);
        }
    };

    const setPitchValue = (val: number) => {
        setPitch(val);
        // Nota: el pitch independiente fino se conectará al módulo Kotlin de ExoPlayer en la fase nativa
        if (playerRef.current) {
            playerRef.current.shouldCorrectPitch = val === 1;
        }
    };

    const toggleFavorite = async () => {
        if (!currentTrack) return;
        const next = !currentTrack.isFavorite;
        await toggleTrackFavorite(currentTrack.id, next);
        setCurrentTrack({ ...currentTrack, isFavorite: next });
    };

    const hideCurrentTrack = async () => {
        if (!currentTrack) return;
        await hideTrack(currentTrack.id);
        await playNext();
    };

    const deleteCurrentTrack = async () => {
        if (!currentTrack) return;
        await softDeleteTrack(currentTrack.id);
        await playNext();
    };

    return (
        <PlayerContext.Provider
            value={{
                currentTrack,
                isPlaying,
                position,
                duration,
                repeatMode,
                playbackRate,
                pitch,
                playTrack,
                togglePlayPause,
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
            }}
        >
            <PlayerProgressContext.Provider value={{ position, duration }}>
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