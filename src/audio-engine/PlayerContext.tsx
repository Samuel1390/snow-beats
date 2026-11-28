import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Platform } from 'react-native';
import {
    createAudioPlayer,
    setAudioModeAsync,
    setIsAudioActiveAsync,
    AudioPlayer,
} from 'expo-audio';
import {
    addMediaActionListener,
    dismissMediaNotification,
    readTrackTags,
    requestNotificationPermission,
    updateMediaNotification,
} from '../../modules/snow-metadata';
import {
    addListeningSeconds,
    getMusicAlarms,
    getVisibleTracks,
    hideTrack,
    markTrackPlayed,
    MusicAlarm,
    saveMusicAlarms,
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
    updateCurrentTrack: (patch: Partial<Track>) => void;
    // Temporizador de apagado
    sleepMinutes: number;
    sleepEndsAt: number | null;
    setSleepTimerMinutes: (minutes: number) => void;
    // Alarma musical local
    alarms: MusicAlarm[];
    saveAlarmsList: (next: MusicAlarm[]) => Promise<void>;
    createQuickAlarmForTrack: (track: Track) => Promise<MusicAlarm>;
    ringingAlarm: MusicAlarm | null;
    snoozeRingingAlarm: (minutes?: number) => void;
    dismissRingingAlarm: () => void;
}

interface ProgressValue {
    position: number;
    duration: number;
}

const PlayerProgressContext = createContext<ProgressValue>({ position: 0, duration: 0 });
export const usePlayerProgress = () => useContext(PlayerProgressContext);

const PlayerContext = createContext<PlayerContextValue | null>(null);

interface SnowBeatsAudioSingleton {
    activePlayer: AudioPlayer | null;
    allPlayers: Set<AudioPlayer>;
    currentTrack: Track | null;
    queue: Track[];
    currentIndex: number;
    hasCleanedColdOrphans: boolean;
}

const GLOBAL_AUDIO_KEY = '__snowBeatsAudioEngineSingleton';

function getAudioSingleton(): SnowBeatsAudioSingleton {
    const g = globalThis as unknown as Record<string, SnowBeatsAudioSingleton | undefined>;
    if (!g[GLOBAL_AUDIO_KEY]) {
        g[GLOBAL_AUDIO_KEY] = {
            activePlayer: null,
            allPlayers: new Set<AudioPlayer>(),
            currentTrack: null,
            queue: [],
            currentIndex: -1,
            hasCleanedColdOrphans: false,
        };
    }
    return g[GLOBAL_AUDIO_KEY]!;
}

function destroyAllTrackedPlayers(): void {
    const singleton = getAudioSingleton();
    const toDestroy = new Set<AudioPlayer>(singleton.allPlayers);
    if (singleton.activePlayer) {
        toDestroy.add(singleton.activePlayer);
    }
    toDestroy.forEach((p) => {
        try {
            p.pause();
        } catch { }
        try {
            p.volume = 0;
        } catch { }
        try {
            p.remove();
        } catch { }
    });
    singleton.allPlayers.clear();
    singleton.activePlayer = null;
}

// Limpia reproductores nativos huérfanos SOLO tras un arranque en frío (cuando la ventana previa fue deslizada/cerrada)
// o al pulsar Cerrar (X) en la notificación. No se invoca en cambios normales de canción para evitar cortes de AudioFocus.
async function silenceAllNativeAudioPlayers(): Promise<void> {
    destroyAllTrackedPlayers();
    const withTimeout = (p: Promise<unknown>, ms = 350) =>
        Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, ms))]);
    try {
        await withTimeout(setIsAudioActiveAsync(false));
    } catch { }
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    try {
        await withTimeout(setIsAudioActiveAsync(true));
    } catch { }
}

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const singleton = getAudioSingleton();
    const playerRef = useRef<AudioPlayer | null>(singleton.activePlayer);
    const playRequestIdRef = useRef<number>(0); // Cancela cargas viejas si el usuario spamea
    const hasEndedRef = useRef<boolean>(false); // Evita disparar playNext() dos veces al terminar
    const playTransitionUntilRef = useRef<number>(0); // Evita falso parpadeo a pausa durante el buffering inicial (~900ms)

    const queueRef = useRef<Track[]>(singleton.queue);
    const currentIndexRef = useRef<number>(singleton.currentIndex);
    const currentTrackRef = useRef<Track | null>(singleton.currentTrack);
    const repeatModeRef = useRef<RepeatMode>('repeat_all');
    const playbackRateRef = useRef<number>(1);
    const pitchRef = useRef<number>(1);

    const [currentTrack, setCurrentTrack] = useState<Track | null>(singleton.currentTrack);
    const [isPlaying, setIsPlaying] = useState(Boolean(singleton.activePlayer?.playing));
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [repeatMode, setRepeatMode] = useState<RepeatMode>('repeat_all');
    const [playbackRate, setPlaybackRate] = useState<number>(1);
    const [pitch, setPitch] = useState<number>(1);

    // Estado del temporizador de apagado y alarmas musicales
    const [sleepMinutes, setSleepMinutes] = useState<number>(0);
    const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null);
    const [alarms, setAlarms] = useState<MusicAlarm[]>([]);
    const [ringingAlarm, setRingingAlarm] = useState<MusicAlarm | null>(null);

    const alarmsRef = useRef<MusicAlarm[]>([]);
    const sleepEndsAtRef = useRef<number | null>(null);
    const lastTriggeredAlarmKeyRef = useRef<Map<string, string>>(new Map());
    const snoozedAlarmRef = useRef<{ alarm: MusicAlarm; triggerAt: number } | null>(null);
    const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const listenStartMsRef = useRef<number | null>(null);
    const pendingListenSecRef = useRef<number>(0);

    const flushListeningTime = useCallback(() => {
        if (listenStartMsRef.current !== null) {
            const elapsedSec = (Date.now() - listenStartMsRef.current) / 1000;
            if (elapsedSec > 0 && elapsedSec < 3600) {
                pendingListenSecRef.current += elapsedSec;
            }
            listenStartMsRef.current = Date.now();
        }
        const wholeSec = Math.floor(pendingListenSecRef.current);
        if (wholeSec >= 1) {
            pendingListenSecRef.current -= wholeSec;
            addListeningSeconds(wholeSec).catch(() => { });
        }
    }, []);

    const stopFadeInTimer = useCallback(() => {
        if (fadeTimerRef.current) {
            clearInterval(fadeTimerRef.current);
            fadeTimerRef.current = null;
        }
    }, []);

    const addToQueue = useCallback((items: Track[]) => {
        queueRef.current = [...queueRef.current, ...items];
    }, []);

    const notifPermRequestedRef = useRef<boolean>(false);

    // Sincroniza estado actual con el control multimedia flotante de Android
    const syncNotification = useCallback(
        (
            track: Track | null,
            playing: boolean,
            posSec?: number,
            durSec?: number
        ) => {
            if (Platform.OS !== 'android') return;
            if (!track) {
                dismissMediaNotification().catch(() => { });
                return;
            }
            const currentPos = posSec ?? playerRef.current?.currentTime ?? 0;
            const totalDur = durSec ?? (playerRef.current?.duration || track.duration || 0);
            updateMediaNotification({
                title: track.title,
                artist: track.artist,
                album: track.album,
                artworkUri: track.artworkUri,
                isPlaying: playing,
                isFavorite: track.isFavorite,
                positionMs: Math.max(0, Math.round(currentPos * 1000)),
                durationMs: Math.max(0, Math.round(totalDur * 1000)),
                speed: playbackRateRef.current,
            }).catch(() => { });
        },
        []
    );

    // Configura audio en segundo plano, re-hidrata si había una pista viva y carga alarmas.
    // IMPORTANTE: Nunca detiene la música ni cierra la notificación al desmontar/cerrar ventana;
    // la canción en segundo plano sigue sonando hasta que el usuario elija otra canción o pulse Cerrar en la notificación.
    useEffect(() => {
        setAudioModeAsync({
            playsInSilentMode: true,
            shouldPlayInBackground: true,
            interruptionMode: 'doNotMix',
        }).catch(() => { });

        const audioSingleton = getAudioSingleton();
        if (audioSingleton.activePlayer && audioSingleton.currentTrack) {
            // Re-engancha la UI si el runtime JS sobrevivió con una canción sonando o pausada
            playerRef.current = audioSingleton.activePlayer;
            currentTrackRef.current = audioSingleton.currentTrack;
            queueRef.current = audioSingleton.queue;
            currentIndexRef.current = audioSingleton.currentIndex;
            setCurrentTrack(audioSingleton.currentTrack);
            setIsPlaying(Boolean(audioSingleton.activePlayer.playing));
            setPosition(audioSingleton.activePlayer.currentTime ?? 0);
            setDuration(audioSingleton.activePlayer.duration || audioSingleton.currentTrack.duration || 0);
        }

        getMusicAlarms()
            .then((list) => {
                alarmsRef.current = list;
                setAlarms(list);
            })
            .catch(() => { });

        return () => {
            flushListeningTime();
            stopFadeInTimer();
        };
    }, [flushListeningTime, stopFadeInTimer]);

    // Registra segundos reales de reproducción mientras isPlaying es true
    useEffect(() => {
        if (isPlaying) {
            listenStartMsRef.current = Date.now();
            const timer = setInterval(() => {
                flushListeningTime();
            }, 10000);
            return () => {
                clearInterval(timer);
                flushListeningTime();
                listenStartMsRef.current = null;
            };
        }
        flushListeningTime();
        listenStartMsRef.current = null;
    }, [isPlaying, flushListeningTime]);

    const playTrack = useCallback(async (track: Track, newQueue?: Track[]) => {
        const requestId = ++playRequestIdRef.current;
        hasEndedRef.current = false;

        const audioSingleton = getAudioSingleton();
        if (newQueue) {
            queueRef.current = newQueue;
            currentIndexRef.current = newQueue.findIndex((t) => t.id === track.id);
            audioSingleton.queue = newQueue;
            audioSingleton.currentIndex = currentIndexRef.current;
        }

        // Actualiza estado visual de forma síncrona ANTES de cualquier operación para que FullPlayerModal abra al instante
        audioSingleton.currentTrack = track;
        currentTrackRef.current = track;
        setCurrentTrack(track);
        setPosition(0);
        setDuration(track.duration);
        setIsPlaying(true);
        playTransitionUntilRef.current = Date.now() + 900;

        const existingPlayer = audioSingleton.activePlayer;
        let activePlayer: AudioPlayer | null = null;

        // 1. Cambio rápido sin solapamiento ni cortes de AudioFocus:
        //    reutiliza el ExoPlayer activo mediante replace() en la misma instancia nativa.
        if (existingPlayer) {
            // Limpia cualquier reproductor secundario sobrante, conservando solo el activo
            audioSingleton.allPlayers.forEach((p) => {
                if (p !== existingPlayer) {
                    try { p.pause(); } catch { }
                    try { p.volume = 0; } catch { }
                    try { p.remove(); } catch { }
                    audioSingleton.allPlayers.delete(p);
                }
            });

            try {
                existingPlayer.replace({ uri: track.uri });
                try {
                    existingPlayer.volume = 1;
                    existingPlayer.shouldCorrectPitch = pitchRef.current === 1;
                    existingPlayer.setPlaybackRate(playbackRateRef.current);
                } catch { }
                existingPlayer.play();
                activePlayer = existingPlayer;
            } catch {
                destroyAllTrackedPlayers();
                activePlayer = null;
            }
        } else if (!audioSingleton.hasCleanedColdOrphans) {
            // 2. Arranque en frío (por ejemplo, tras deslizar/cerrar la ventana de la app):
            //    corta cualquier pista huérfana nativa UNA sola vez antes de iniciar la nueva.
            playerRef.current = null;
            await silenceAllNativeAudioPlayers();
            audioSingleton.hasCleanedColdOrphans = true;

            if (requestId !== playRequestIdRef.current) {
                return;
            }
        }

        if (!activePlayer) {
            const created = createAudioPlayer({ uri: track.uri });
            audioSingleton.allPlayers.add(created);

            try {
                created.volume = 1;
                created.shouldCorrectPitch = pitchRef.current === 1;
                created.setPlaybackRate(playbackRateRef.current);
            } catch { }

            if (requestId !== playRequestIdRef.current) {
                try {
                    created.pause();
                    created.volume = 0;
                    created.remove();
                } catch { }
                audioSingleton.allPlayers.delete(created);
                return;
            }

            audioSingleton.activePlayer = created;
            activePlayer = created;
            created.play();
        }

        audioSingleton.hasCleanedColdOrphans = true;
        audioSingleton.activePlayer = activePlayer;
        playerRef.current = activePlayer;

        if (Platform.OS === 'android' && !notifPermRequestedRef.current) {
            notifPermRequestedRef.current = true;
            requestNotificationPermission().catch(() => { });
        }

        syncNotification(track, true, 0, track.duration);
        markTrackPlayed(track.id).catch(() => { });

        // Lee etiquetas ID3 y color dominante en segundo plano si aún faltan
        if (!track.artworkUri || !track.dominantColor) {
            readTrackTags(track.uri, track.id)
                .then(async (tags) => {
                    if (!tags) return;
                    const updated: Track = {
                        ...track,
                        title: tags.title || track.title,
                        artist: tags.artist || track.artist,
                        album: tags.album || track.album,
                        artworkUri: track.artworkUri ?? tags.artworkUri ?? null,
                        dominantColor: track.dominantColor ?? tags.dominantColor ?? null,
                    };
                    await updateTrackMetadata(track.id, updated);
                    if (currentTrackRef.current?.id === track.id) {
                        currentTrackRef.current = updated;
                        audioSingleton.currentTrack = updated;
                        setCurrentTrack(updated);
                        syncNotification(updated, Boolean(playerRef.current?.playing));
                    }
                })
                .catch(() => { });
        }
    }, [syncNotification]);

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
            const inStartTransition = Date.now() < playTransitionUntilRef.current;

            if (nextPlaying && inStartTransition) {
                playTransitionUntilRef.current = 0;
            }

            setPosition((prev) => (Math.abs(prev - nextPos) > 0.05 ? nextPos : prev));
            setDuration((prev) => (Math.abs(prev - nextDur) > 0.1 ? nextDur : prev));
            if (nextPlaying || !inStartTransition) {
                setIsPlaying((prev) => (prev === nextPlaying ? prev : nextPlaying));
            }

            if (
                !inStartTransition &&
                p.duration > 0 &&
                nextPos >= p.duration - 0.3 &&
                !nextPlaying &&
                !hasEndedRef.current
            ) {
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
        playTransitionUntilRef.current = 0;
        if (p.playing) {
            p.pause();
            setIsPlaying(false);
            syncNotification(currentTrackRef.current, false);
        } else {
            p.play();
            setIsPlaying(true);
            syncNotification(currentTrackRef.current, true);
        }
    }, [syncNotification]);

    const pausePlayback = useCallback(() => {
        const p = playerRef.current;
        playTransitionUntilRef.current = 0;
        if (!p || !p.playing) return;
        p.pause();
        setIsPlaying(false);
        syncNotification(currentTrackRef.current, false);
    }, [syncNotification]);

    const seekTo = useCallback(
        (seconds: number) => {
            playerRef.current?.seekTo(seconds);
            setPosition(seconds);
            syncNotification(currentTrackRef.current, Boolean(playerRef.current?.playing), seconds);
        },
        [syncNotification]
    );

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
        syncNotification(updated, Boolean(playerRef.current?.playing));
        await toggleTrackFavorite(curr.id, next);
    }, [syncNotification]);

    // Actualiza en vivo los datos editados de la canción actual (cola, estado y notificación)
    const updateCurrentTrack = useCallback(
        (patch: Partial<Track>) => {
            const curr = currentTrackRef.current;
            if (!curr) return;
            const updated: Track = { ...curr, ...patch };
            currentTrackRef.current = updated;
            setCurrentTrack(updated);
            queueRef.current = queueRef.current.map((item) =>
                item.id === updated.id ? { ...item, ...patch } : item
            );
            syncNotification(updated, Boolean(playerRef.current?.playing));
        },
        [syncNotification]
    );

    // Escucha los botones del control multimedia flotante de la barra de notificaciones
    useEffect(() => {
        if (Platform.OS !== 'android') return;
        const sub = addMediaActionListener((evt) => {
            switch (evt.action) {
                case 'play':
                    if (playerRef.current && !playerRef.current.playing) {
                        playerRef.current.play();
                        setIsPlaying(true);
                        syncNotification(currentTrackRef.current, true);
                    }
                    break;
                case 'pause':
                    pausePlayback();
                    break;
                case 'toggle':
                    togglePlayPause();
                    break;
                case 'next':
                    playNext();
                    break;
                case 'previous':
                    playPrevious();
                    break;
                case 'favorite':
                    toggleFavorite();
                    break;
                case 'seek':
                    if (typeof evt.positionSec === 'number' && evt.positionSec >= 0) {
                        seekTo(evt.positionSec);
                    }
                    break;
                case 'close':
                    playRequestIdRef.current += 1;
                    playerRef.current = null;
                    currentTrackRef.current = null;
                    getAudioSingleton().currentTrack = null;
                    setIsPlaying(false);
                    silenceAllNativeAudioPlayers().catch(() => { });
                    dismissMediaNotification().catch(() => { });
                    break;
            }
        });
        return () => sub?.remove();
    }, [pausePlayback, togglePlayPause, playNext, playPrevious, toggleFavorite, seekTo, syncNotification]);

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

    // Configura el temporizador de apagado automático
    const setSleepTimerMinutes = useCallback((minutes: number) => {
        const clean = Math.max(0, Math.floor(minutes));
        setSleepMinutes(clean);
        const endsAt = clean > 0 ? Date.now() + clean * 60 * 1000 : null;
        sleepEndsAtRef.current = endsAt;
        setSleepEndsAt(endsAt);
    }, []);

    // Guarda la lista completa de alarmas en estado y SQLite
    const saveAlarmsList = useCallback(async (next: MusicAlarm[]) => {
        alarmsRef.current = next;
        setAlarms(next);
        await saveMusicAlarms(next);
    }, []);

    // Crea una alarma rápida (dentro de 8 horas por defecto) usando una canción específica
    const createQuickAlarmForTrack = useCallback(
        async (track: Track): Promise<MusicAlarm> => {
            const target = new Date(Date.now() + 8 * 60 * 60 * 1000);
            const created: MusicAlarm = {
                id: `alarm_${Date.now()}`,
                hour: target.getHours(),
                minute: target.getMinutes(),
                enabled: true,
                days: [],
                label: track.title,
                trackId: track.id,
                trackTitle: track.title,
                trackArtist: track.artist,
                fadeIn: true,
            };
            const nextList = [...alarmsRef.current, created].sort(
                (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute)
            );
            await saveAlarmsList(nextList);
            return created;
        },
        [saveAlarmsList]
    );

    // Dispara una alarma musical reproduciendo su canción (o aleatoria) con fade-in opcional
    const triggerAlarmPlayback = useCallback(
        async (alarm: MusicAlarm) => {
            stopFadeInTimer();
            const library = await getVisibleTracks('date_desc');
            let chosen: Track | undefined = alarm.trackId
                ? library.find((item) => item.id === alarm.trackId)
                : undefined;
            if (!chosen && library.length > 0) {
                chosen = library[Math.floor(Math.random() * library.length)];
            }

            if (chosen) {
                await playTrack(chosen, library);
                if (alarm.fadeIn && playerRef.current) {
                    try {
                        let vol = 0.15;
                        playerRef.current.volume = vol;
                        fadeTimerRef.current = setInterval(() => {
                            vol = Math.min(1, vol + 0.06);
                            if (playerRef.current) {
                                try {
                                    playerRef.current.volume = vol;
                                } catch { }
                            }
                            if (vol >= 1) {
                                stopFadeInTimer();
                            }
                        }, 1000);
                    } catch { }
                }
            }

            setRingingAlarm(alarm);
        },
        [playTrack, stopFadeInTimer]
    );

    const snoozeRingingAlarm = useCallback(
        (minutes = 5) => {
            stopFadeInTimer();
            if (ringingAlarm) {
                snoozedAlarmRef.current = {
                    alarm: ringingAlarm,
                    triggerAt: Date.now() + minutes * 60 * 1000,
                };
            }
            setRingingAlarm(null);
            pausePlayback();
        },
        [ringingAlarm, pausePlayback, stopFadeInTimer]
    );

    const dismissRingingAlarm = useCallback(() => {
        stopFadeInTimer();
        snoozedAlarmRef.current = null;
        if (playerRef.current) {
            try {
                playerRef.current.volume = 1;
            } catch { }
        }
        setRingingAlarm(null);
        pausePlayback();
    }, [pausePlayback, stopFadeInTimer]);

    // Programador en segundo plano: verifica temporizador de apagado y alarmas cada 10s
    useEffect(() => {
        const tick = () => {
            const nowMs = Date.now();

            // 1. Temporizador de apagado
            if (sleepEndsAtRef.current !== null && nowMs >= sleepEndsAtRef.current) {
                sleepEndsAtRef.current = null;
                setSleepEndsAt(null);
                setSleepMinutes(0);
                pausePlayback();
            }

            // 2. Alarma pospuesta (Snooze)
            if (snoozedAlarmRef.current && nowMs >= snoozedAlarmRef.current.triggerAt) {
                const pending = snoozedAlarmRef.current.alarm;
                snoozedAlarmRef.current = null;
                triggerAlarmPlayback(pending).catch(() => { });
                return;
            }

            // 3. Alarmas programadas
            const now = new Date(nowMs);
            const h = now.getHours();
            const m = now.getMinutes();
            const day = now.getDay();
            const minuteKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${h}:${m}`;

            for (const alarm of alarmsRef.current) {
                if (!alarm.enabled) continue;
                if (alarm.hour !== h || alarm.minute !== m) continue;
                if (alarm.days.length > 0 && !alarm.days.includes(day)) continue;
                if (lastTriggeredAlarmKeyRef.current.get(alarm.id) === minuteKey) continue;

                lastTriggeredAlarmKeyRef.current.set(alarm.id, minuteKey);

                // Si es alarma de una sola vez, se desactiva automáticamente tras sonar
                if (alarm.days.length === 0) {
                    const updated = alarmsRef.current.map((a) =>
                        a.id === alarm.id ? { ...a, enabled: false } : a
                    );
                    alarmsRef.current = updated;
                    setAlarms(updated);
                    saveMusicAlarms(updated).catch(() => { });
                }

                triggerAlarmPlayback(alarm).catch(() => { });
                break;
            }
        };

        const interval = setInterval(tick, 10000);
        return () => clearInterval(interval);
    }, [pausePlayback, triggerAlarmPlayback]);

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
            updateCurrentTrack,
            sleepMinutes,
            sleepEndsAt,
            setSleepTimerMinutes,
            alarms,
            saveAlarmsList,
            createQuickAlarmForTrack,
            ringingAlarm,
            snoozeRingingAlarm,
            dismissRingingAlarm,
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
            updateCurrentTrack,
            sleepMinutes,
            sleepEndsAt,
            setSleepTimerMinutes,
            alarms,
            saveAlarmsList,
            createQuickAlarmForTrack,
            ringingAlarm,
            snoozeRingingAlarm,
            dismissRingingAlarm,
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