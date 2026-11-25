import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    AlarmClock,
    ArrowLeft,
    BarChart3,
    ChevronDown,
    ChevronUp,
    Clock,
    Disc3,
    FileText,
    Heart,
    Music,
    Play,
    Plus,
    RotateCcw,
    Search,
    Shuffle,
    Trash2,
    Volume2,
    X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    getListeningStats,
    getVisibleTracks,
    ListeningStats,
    MusicAlarm,
    resetListeningStats,
} from '../../storage/database/db';
import { Track } from '../../types/music';
import { usePlayer } from '../../audio-engine/PlayerContext';
import { useI18n } from '../../i18n/LanguageContext';

interface StatsAndAlarmViewProps {
    onBack: () => void;
    onPlayTrackAndClose?: (track: Track, queue: Track[]) => void;
}

const ORDERED_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

function formatDurationHuman(totalSec: number): string {
    const safe = Math.max(0, Math.floor(totalSec));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
}

function formatAlarmTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function computeNextAlarm(alarms: MusicAlarm[]): MusicAlarm | null {
    const enabled = alarms.filter((a) => a.enabled);
    if (enabled.length === 0) return null;

    const now = new Date();
    const currentDay = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    let bestAlarm: MusicAlarm | null = null;
    let bestDelta = Infinity;

    for (const alarm of enabled) {
        const alarmMinutes = alarm.hour * 60 + alarm.minute;
        if (alarm.days.length === 0) {
            const delta =
                alarmMinutes > currentMinutes
                    ? alarmMinutes - currentMinutes
                    : 24 * 60 - currentMinutes + alarmMinutes;
            if (delta < bestDelta) {
                bestDelta = delta;
                bestAlarm = alarm;
            }
        } else {
            for (const day of alarm.days) {
                let dayDiff = (day - currentDay + 7) % 7;
                if (dayDiff === 0 && alarmMinutes <= currentMinutes) {
                    dayDiff = 7;
                }
                const delta = dayDiff * 24 * 60 + (alarmMinutes - currentMinutes);
                if (delta < bestDelta) {
                    bestDelta = delta;
                    bestAlarm = alarm;
                }
            }
        }
    }
    return bestAlarm;
}

// Vista unificada de Estadísticas locales y Alarma musical dentro de Configuración
export const StatsAndAlarmView: React.FC<StatsAndAlarmViewProps> = ({
    onBack,
    onPlayTrackAndClose,
}) => {
    const { alarms, saveAlarmsList, playTrack } = usePlayer();
    const { t } = useI18n();
    const insets = useSafeAreaInsets();

    const [activeTab, setActiveTab] = useState<'stats' | 'alarms'>('stats');
    const [stats, setStats] = useState<ListeningStats | null>(null);
    const [loadingStats, setLoadingStats] = useState(true);

    // Estado del editor de alarma
    const [editorVisible, setEditorVisible] = useState(false);
    const [editingAlarmId, setEditingAlarmId] = useState<string | null>(null);
    const [draftHour, setDraftHour] = useState(7);
    const [draftMinute, setDraftMinute] = useState(0);
    const [draftDays, setDraftDays] = useState<number[]>([1, 2, 3, 4, 5]);
    const [draftLabel, setDraftLabel] = useState('');
    const [draftTrackId, setDraftTrackId] = useState<string | null>(null);
    const [draftTrackTitle, setDraftTrackTitle] = useState<string | null>(null);
    const [draftTrackArtist, setDraftTrackArtist] = useState<string | null>(null);
    const [draftFadeIn, setDraftFadeIn] = useState(true);

    // Selector de canción local para la alarma
    const [songPickerVisible, setSongPickerVisible] = useState(false);
    const [libraryTracks, setLibraryTracks] = useState<Track[]>([]);
    const [songQuery, setSongQuery] = useState('');

    const loadStats = useCallback(async () => {
        setLoadingStats(true);
        try {
            const data = await getListeningStats();
            setStats(data);
        } finally {
            setLoadingStats(false);
        }
    }, []);

    useEffect(() => {
        loadStats();
    }, [loadStats]);

    const dayLabel = useCallback(
        (day: number): string => {
            const map: Record<number, string> = {
                0: t('alarm.daySun'),
                1: t('alarm.dayMon'),
                2: t('alarm.dayTue'),
                3: t('alarm.dayWed'),
                4: t('alarm.dayThu'),
                5: t('alarm.dayFri'),
                6: t('alarm.daySat'),
            };
            return map[day] ?? '';
        },
        [t]
    );

    const summarizeDays = useCallback(
        (days: number[]): string => {
            if (days.length === 0) return t('alarm.onceLabel');
            if (days.length === 7) return t('alarm.everyDay');
            const sorted = [...days].sort((a, b) => a - b);
            const joined = sorted.join(',');
            if (joined === '1,2,3,4,5') return t('alarm.weekdays');
            if (joined === '0,6') return t('alarm.weekends');
            return ORDERED_WEEKDAYS.filter((d) => days.includes(d))
                .map(dayLabel)
                .join(' · ');
        },
        [t, dayLabel]
    );

    const openNewAlarmEditor = useCallback(() => {
        const now = new Date();
        const nextHour = (now.getHours() + 1) % 24;
        setEditingAlarmId(null);
        setDraftHour(nextHour);
        setDraftMinute(0);
        setDraftDays([1, 2, 3, 4, 5]);
        setDraftLabel('');
        setDraftTrackId(null);
        setDraftTrackTitle(null);
        setDraftTrackArtist(null);
        setDraftFadeIn(true);
        setEditorVisible(true);
    }, []);

    const openEditAlarmEditor = useCallback((alarm: MusicAlarm) => {
        setEditingAlarmId(alarm.id);
        setDraftHour(alarm.hour);
        setDraftMinute(alarm.minute);
        setDraftDays([...alarm.days]);
        setDraftLabel(alarm.label);
        setDraftTrackId(alarm.trackId);
        setDraftTrackTitle(alarm.trackTitle);
        setDraftTrackArtist(alarm.trackArtist);
        setDraftFadeIn(alarm.fadeIn);
        setEditorVisible(true);
    }, []);

    const openSongPicker = useCallback(async () => {
        setSongQuery('');
        const all = await getVisibleTracks('title_asc');
        setLibraryTracks(all);
        setSongPickerVisible(true);
    }, []);

    const filteredSongs = useMemo(() => {
        const q = songQuery.trim().toLowerCase();
        if (!q) return libraryTracks;
        return libraryTracks.filter(
            (item) =>
                item.title.toLowerCase().includes(q) || item.artist.toLowerCase().includes(q)
        );
    }, [libraryTracks, songQuery]);

    const toggleDraftDay = useCallback((day: number) => {
        setDraftDays((prev) =>
            prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
        );
    }, []);

    const handleSaveAlarm = useCallback(async () => {
        const item: MusicAlarm = {
            id: editingAlarmId ?? `alarm_${Date.now()}`,
            hour: draftHour,
            minute: draftMinute,
            enabled: true,
            days: [...draftDays],
            label: draftLabel.trim(),
            trackId: draftTrackId,
            trackTitle: draftTrackTitle,
            trackArtist: draftTrackArtist,
            fadeIn: draftFadeIn,
        };

        const nextList = editingAlarmId
            ? alarms.map((a) => (a.id === editingAlarmId ? item : a))
            : [...alarms, item];

        nextList.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
        await saveAlarmsList(nextList);
        setEditorVisible(false);
    }, [
        editingAlarmId,
        draftHour,
        draftMinute,
        draftDays,
        draftLabel,
        draftTrackId,
        draftTrackTitle,
        draftTrackArtist,
        draftFadeIn,
        alarms,
        saveAlarmsList,
    ]);

    const handleToggleAlarm = useCallback(
        async (alarmId: string, enabled: boolean) => {
            const next = alarms.map((a) => (a.id === alarmId ? { ...a, enabled } : a));
            await saveAlarmsList(next);
        },
        [alarms, saveAlarmsList]
    );

    const handleDeleteAlarm = useCallback(
        (alarm: MusicAlarm) => {
            Alert.alert(t('alarm.deleteAlarmTitle'), t('alarm.deleteAlarmBody'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: async () => {
                        const next = alarms.filter((a) => a.id !== alarm.id);
                        await saveAlarmsList(next);
                    },
                },
            ]);
        },
        [alarms, saveAlarmsList, t]
    );

    const handleResetStats = useCallback(() => {
        Alert.alert(t('stats.resetConfirmTitle'), t('stats.resetConfirmBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('stats.resetConfirmAction'),
                style: 'destructive',
                onPress: async () => {
                    await resetListeningStats();
                    await loadStats();
                },
            },
        ]);
    }, [t, loadStats]);

    const handlePlayTopTrack = useCallback(
        (track: Track) => {
            const queue = stats?.topTracks ?? [track];
            if (onPlayTrackAndClose) {
                onPlayTrackAndClose(track, queue);
            } else {
                playTrack(track, queue);
            }
        },
        [stats, onPlayTrackAndClose, playTrack]
    );

    const nextAlarm = useMemo(() => computeNextAlarm(alarms), [alarms]);
    const maxArtistPlays = useMemo(
        () => Math.max(1, ...(stats?.topArtists.map((a) => a.totalPlays) ?? [1])),
        [stats]
    );

    return (
        <View style={styles.root}>
            {/* Cabecera */}
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack} style={styles.iconBtn}>
                    <ArrowLeft size={22} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('settings.stats.title')}</Text>
            </View>

            {/* Pestañas segmentadas Estadísticas | Alarma musical */}
            <View style={styles.segmented}>
                <TouchableOpacity
                    style={[styles.segmentBtn, activeTab === 'stats' && styles.segmentBtnActive]}
                    onPress={() => setActiveTab('stats')}
                >
                    <BarChart3 size={15} color={activeTab === 'stats' ? '#FFFFFF' : '#A1A1AA'} />
                    <Text
                        style={[
                            styles.segmentText,
                            activeTab === 'stats' && styles.segmentTextActive,
                        ]}
                    >
                        {t('stats.tabStats')}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.segmentBtn, activeTab === 'alarms' && styles.segmentBtnActive]}
                    onPress={() => setActiveTab('alarms')}
                >
                    <AlarmClock size={15} color={activeTab === 'alarms' ? '#FFFFFF' : '#A1A1AA'} />
                    <Text
                        style={[
                            styles.segmentText,
                            activeTab === 'alarms' && styles.segmentTextActive,
                        ]}
                    >
                        {t('stats.tabAlarms')}
                    </Text>
                </TouchableOpacity>
            </View>

            {activeTab === 'stats' ? (
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {loadingStats || !stats ? (
                        <View style={styles.loaderBox}>
                            <ActivityIndicator size="large" color="#38BDF8" />
                        </View>
                    ) : (
                        <>
                            {/* Tarjeta hero de tiempo total escuchado */}
                            <View style={styles.heroCard}>
                                <View style={styles.heroTopRow}>
                                    <View style={styles.heroIconWrap}>
                                        <Clock size={20} color="#60A5FA" />
                                    </View>
                                    <View style={styles.todayChip}>
                                        <Text style={styles.todayChipText}>
                                            {t('stats.todayBadge', {
                                                time: formatDurationHuman(stats.todaySeconds),
                                            })}
                                        </Text>
                                    </View>
                                </View>
                                <Text style={styles.heroValue}>
                                    {formatDurationHuman(stats.totalSeconds)}
                                </Text>
                                <Text style={styles.heroLabel}>
                                    {t('stats.totalListeningTitle')}
                                </Text>
                            </View>

                            {/* Cuadrícula de 4 KPIs */}
                            <View style={styles.kpiGrid}>
                                <View style={styles.kpiCard}>
                                    <Play size={18} color="#38BDF8" />
                                    <Text style={styles.kpiValue}>{stats.totalPlays}</Text>
                                    <Text style={styles.kpiLabel}>{t('stats.totalPlays')}</Text>
                                </View>
                                <View style={styles.kpiCard}>
                                    <Disc3 size={18} color="#60A5FA" />
                                    <Text style={styles.kpiValue}>{stats.totalTracks}</Text>
                                    <Text style={styles.kpiLabel}>{t('stats.libraryTracks')}</Text>
                                </View>
                                <View style={styles.kpiCard}>
                                    <Heart size={18} color="#F472B6" />
                                    <Text style={styles.kpiValue}>{stats.favoritesCount}</Text>
                                    <Text style={styles.kpiLabel}>{t('stats.favoritesCount')}</Text>
                                </View>
                                <View style={styles.kpiCard}>
                                    <FileText size={18} color="#34D399" />
                                    <Text style={styles.kpiValue}>{stats.withLyricsCount}</Text>
                                    <Text style={styles.kpiLabel}>{t('stats.withLyricsCount')}</Text>
                                </View>
                            </View>

                            {/* Top 5 canciones más escuchadas */}
                            <View style={styles.sectionHeaderRow}>
                                <Text style={styles.sectionTitle}>{t('stats.topSongsTitle')}</Text>
                            </View>

                            {stats.topTracks.length === 0 ? (
                                <View style={styles.emptyCard}>
                                    <BarChart3 size={28} color="#52525B" />
                                    <Text style={styles.emptyCardText}>
                                        {t('stats.emptyHistory')}
                                    </Text>
                                </View>
                            ) : (
                                <View style={styles.listCard}>
                                    {stats.topTracks.map((track, idx) => (
                                        <TouchableOpacity
                                            key={track.id}
                                            style={[
                                                styles.rankRow,
                                                idx > 0 && styles.rankRowBorder,
                                            ]}
                                            activeOpacity={0.78}
                                            onPress={() => handlePlayTopTrack(track)}
                                        >
                                            <Text
                                                style={[
                                                    styles.rankNumber,
                                                    idx === 0 && styles.rankNumberFirst,
                                                ]}
                                            >
                                                {idx + 1}
                                            </Text>
                                            {track.artworkUri ? (
                                                <Image
                                                    source={{ uri: track.artworkUri }}
                                                    style={styles.trackThumb}
                                                />
                                            ) : (
                                                <View style={styles.trackThumbFallback}>
                                                    <Music size={18} color="#60A5FA" />
                                                </View>
                                            )}
                                            <View style={styles.rankInfo}>
                                                <Text style={styles.rankTitle} numberOfLines={1}>
                                                    {track.title}
                                                </Text>
                                                <Text style={styles.rankSub} numberOfLines={1}>
                                                    {track.artist}
                                                </Text>
                                            </View>
                                            <View style={styles.playPill}>
                                                <Text style={styles.playPillText}>
                                                    {t('stats.playsCount', {
                                                        count: track.playCount,
                                                    })}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            )}

                            {/* Top 5 artistas favoritos */}
                            {stats.topArtists.length > 0 && (
                                <>
                                    <View style={styles.sectionHeaderRow}>
                                        <Text style={styles.sectionTitle}>
                                            {t('stats.topArtistsTitle')}
                                        </Text>
                                    </View>
                                    <View style={styles.listCard}>
                                        {stats.topArtists.map((item, idx) => {
                                            const pct = Math.max(
                                                12,
                                                Math.round((item.totalPlays / maxArtistPlays) * 100)
                                            );
                                            return (
                                                <View
                                                    key={item.artist}
                                                    style={[
                                                        styles.artistRow,
                                                        idx > 0 && styles.rankRowBorder,
                                                    ]}
                                                >
                                                    <View style={styles.artistTopLine}>
                                                        <Text
                                                            style={styles.artistName}
                                                            numberOfLines={1}
                                                        >
                                                            {idx + 1}. {item.artist}
                                                        </Text>
                                                        <Text style={styles.artistPlays}>
                                                            {t('stats.playsCount', {
                                                                count: item.totalPlays,
                                                            })}
                                                        </Text>
                                                    </View>
                                                    <View style={styles.barTrack}>
                                                        <View
                                                            style={[
                                                                styles.barFill,
                                                                { width: `${pct}%` },
                                                            ]}
                                                        />
                                                    </View>
                                                </View>
                                            );
                                        })}
                                    </View>
                                </>
                            )}

                            {/* Botón de restablecer estadísticas */}
                            <TouchableOpacity
                                style={styles.resetStatsBtn}
                                activeOpacity={0.82}
                                onPress={handleResetStats}
                            >
                                <RotateCcw size={16} color="#F87171" />
                                <Text style={styles.resetStatsText}>{t('stats.resetBtn')}</Text>
                            </TouchableOpacity>
                        </>
                    )}
                </ScrollView>
            ) : (
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Banner de próxima alarma */}
                    <View style={styles.nextAlarmBanner}>
                        <View style={styles.heroIconWrap}>
                            <AlarmClock size={20} color="#60A5FA" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.nextAlarmTitle}>
                                {nextAlarm
                                    ? t('alarm.nextAlarm', {
                                          time: formatAlarmTime(nextAlarm.hour, nextAlarm.minute),
                                      })
                                    : t('alarm.noActiveAlarms')}
                            </Text>
                            {nextAlarm ? (
                                <Text style={styles.nextAlarmSub} numberOfLines={1}>
                                    {(nextAlarm.label.trim() || t('alarm.defaultLabel')) +
                                        ' · ' +
                                        summarizeDays(nextAlarm.days)}
                                </Text>
                            ) : null}
                        </View>
                    </View>

                    {/* Botón crear nueva alarma */}
                    <TouchableOpacity
                        style={styles.newAlarmBtn}
                        activeOpacity={0.88}
                        onPress={openNewAlarmEditor}
                    >
                        <Plus size={19} color="#FFFFFF" />
                        <Text style={styles.newAlarmBtnText}>{t('alarm.newAlarm')}</Text>
                    </TouchableOpacity>

                    {/* Lista de alarmas musicales */}
                    {alarms.length === 0 ? (
                        <View style={styles.emptyCard}>
                            <AlarmClock size={34} color="#60A5FA" />
                            <Text style={styles.emptyAlarmTitle}>{t('alarm.emptyTitle')}</Text>
                            <Text style={styles.emptyCardText}>{t('alarm.emptySub')}</Text>
                        </View>
                    ) : (
                        alarms.map((alarm) => (
                            <TouchableOpacity
                                key={alarm.id}
                                style={[
                                    styles.alarmCard,
                                    !alarm.enabled && styles.alarmCardDisabled,
                                ]}
                                activeOpacity={0.85}
                                onPress={() => openEditAlarmEditor(alarm)}
                            >
                                <View style={styles.alarmTopRow}>
                                    <View style={{ flex: 1 }}>
                                        <Text
                                            style={[
                                                styles.alarmTime,
                                                !alarm.enabled && styles.alarmTextMuted,
                                            ]}
                                        >
                                            {formatAlarmTime(alarm.hour, alarm.minute)}
                                        </Text>
                                        <Text style={styles.alarmLabel} numberOfLines={1}>
                                            {alarm.label.trim() || t('alarm.defaultLabel')} ·{' '}
                                            {summarizeDays(alarm.days)}
                                        </Text>
                                    </View>
                                    <Switch
                                        value={alarm.enabled}
                                        onValueChange={(val) => handleToggleAlarm(alarm.id, val)}
                                        trackColor={{ false: '#27272A', true: '#2563EB' }}
                                        thumbColor="#FFFFFF"
                                    />
                                </View>

                                <View style={styles.alarmFooterRow}>
                                    <View style={styles.alarmTrackBadge}>
                                        {alarm.trackId ? (
                                            <Music size={13} color="#60A5FA" />
                                        ) : (
                                            <Shuffle size={13} color="#60A5FA" />
                                        )}
                                        <Text style={styles.alarmTrackText} numberOfLines={1}>
                                            {alarm.trackTitle || t('alarm.randomSong')}
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        style={styles.deleteAlarmBtn}
                                        onPress={() => handleDeleteAlarm(alarm)}
                                    >
                                        <Trash2 size={16} color="#F87171" />
                                    </TouchableOpacity>
                                </View>
                            </TouchableOpacity>
                        ))
                    )}
                </ScrollView>
            )}

            {/* Modal editor de alarma musical */}
            <Modal
                visible={editorVisible}
                animationType="slide"
                statusBarTranslucent
                onRequestClose={() => setEditorVisible(false)}
            >
                <View
                    style={[
                        styles.modalRoot,
                        {
                            paddingTop: Math.max(insets.top, 24) + 8,
                            paddingBottom: Math.max(insets.bottom, 16) + 12,
                        },
                    ]}
                >
                    <View style={styles.header}>
                        <TouchableOpacity
                            style={styles.iconBtn}
                            onPress={() => setEditorVisible(false)}
                        >
                            <X size={22} color="#FFFFFF" />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>
                            {editingAlarmId ? t('alarm.editAlarm') : t('alarm.newAlarm')}
                        </Text>
                        <TouchableOpacity style={styles.saveChipBtn} onPress={handleSaveAlarm}>
                            <Text style={styles.saveChipText}>{t('common.save')}</Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView
                        contentContainerStyle={styles.editorContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Selector interactivo de Hora y Minuto */}
                        <View style={styles.timePickerCard}>
                            <View style={styles.timeColumn}>
                                <TouchableOpacity
                                    style={styles.stepBtn}
                                    onPress={() => setDraftHour((h) => (h + 1) % 24)}
                                >
                                    <ChevronUp size={24} color="#FFFFFF" />
                                </TouchableOpacity>
                                <Text style={styles.pickerDigits}>
                                    {String(draftHour).padStart(2, '0')}
                                </Text>
                                <TouchableOpacity
                                    style={styles.stepBtn}
                                    onPress={() => setDraftHour((h) => (h + 23) % 24)}
                                >
                                    <ChevronDown size={24} color="#FFFFFF" />
                                </TouchableOpacity>
                            </View>

                            <Text style={styles.pickerColon}>:</Text>

                            <View style={styles.timeColumn}>
                                <TouchableOpacity
                                    style={styles.stepBtn}
                                    onPress={() => setDraftMinute((m) => (m + 1) % 60)}
                                >
                                    <ChevronUp size={24} color="#FFFFFF" />
                                </TouchableOpacity>
                                <Text style={styles.pickerDigits}>
                                    {String(draftMinute).padStart(2, '0')}
                                </Text>
                                <TouchableOpacity
                                    style={styles.stepBtn}
                                    onPress={() => setDraftMinute((m) => (m + 59) % 60)}
                                >
                                    <ChevronDown size={24} color="#FFFFFF" />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Días de repetición */}
                        <View style={styles.editorCard}>
                            <View style={styles.editorRowHeader}>
                                <Text style={styles.editorLabel}>{t('alarm.repeatLabel')}</Text>
                                <Text style={styles.editorHint}>{summarizeDays(draftDays)}</Text>
                            </View>
                            <View style={styles.daysRow}>
                                {ORDERED_WEEKDAYS.map((day) => {
                                    const active = draftDays.includes(day);
                                    return (
                                        <TouchableOpacity
                                            key={day}
                                            style={[
                                                styles.dayCircle,
                                                active && styles.dayCircleActive,
                                            ]}
                                            onPress={() => toggleDraftDay(day)}
                                        >
                                            <Text
                                                style={[
                                                    styles.dayText,
                                                    active && styles.dayTextActive,
                                                ]}
                                            >
                                                {dayLabel(day)}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>

                        {/* Etiqueta */}
                        <View style={styles.editorCard}>
                            <TextInput
                                style={styles.labelInput}
                                value={draftLabel}
                                onChangeText={setDraftLabel}
                                placeholder={t('alarm.labelPlaceholder')}
                                placeholderTextColor="#71717A"
                                maxLength={40}
                            />
                        </View>

                        {/* Canción despertador */}
                        <TouchableOpacity
                            style={styles.editorCard}
                            activeOpacity={0.82}
                            onPress={openSongPicker}
                        >
                            <View style={styles.soundRow}>
                                <View style={styles.heroIconWrap}>
                                    {draftTrackId ? (
                                        <Music size={18} color="#60A5FA" />
                                    ) : (
                                        <Shuffle size={18} color="#60A5FA" />
                                    )}
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.editorLabel}>{t('alarm.soundLabel')}</Text>
                                    <Text style={styles.soundValue} numberOfLines={1}>
                                        {draftTrackTitle || t('alarm.randomSong')}
                                    </Text>
                                </View>
                                <Text style={styles.changeLink}>{t('alarm.chooseSong')}</Text>
                            </View>
                        </TouchableOpacity>

                        {/* Volumen progresivo */}
                        <View style={styles.editorCard}>
                            <View style={styles.soundRow}>
                                <View style={styles.heroIconWrap}>
                                    <Volume2 size={18} color="#60A5FA" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.editorLabel}>{t('alarm.fadeInTitle')}</Text>
                                    <Text style={styles.fadeSub}>{t('alarm.fadeInSub')}</Text>
                                </View>
                                <Switch
                                    value={draftFadeIn}
                                    onValueChange={setDraftFadeIn}
                                    trackColor={{ false: '#27272A', true: '#2563EB' }}
                                    thumbColor="#FFFFFF"
                                />
                            </View>
                        </View>
                    </ScrollView>
                </View>

                {/* Modal selector de canción local */}
                <Modal
                    visible={songPickerVisible}
                    animationType="slide"
                    statusBarTranslucent
                    onRequestClose={() => setSongPickerVisible(false)}
                >
                    <View
                        style={[
                            styles.modalRoot,
                            {
                                paddingTop: Math.max(insets.top, 24) + 8,
                                paddingBottom: Math.max(insets.bottom, 12),
                            },
                        ]}
                    >
                        <View style={styles.header}>
                            <TouchableOpacity
                                style={styles.iconBtn}
                                onPress={() => setSongPickerVisible(false)}
                            >
                                <ArrowLeft size={22} color="#FFFFFF" />
                            </TouchableOpacity>
                            <Text style={styles.headerTitle}>{t('alarm.chooseSong')}</Text>
                        </View>

                        <View style={styles.searchBar}>
                            <Search size={17} color="#71717A" />
                            <TextInput
                                style={styles.searchInput}
                                value={songQuery}
                                onChangeText={setSongQuery}
                                placeholder={t('alarm.searchSongPlaceholder')}
                                placeholderTextColor="#71717A"
                            />
                            {songQuery.length > 0 && (
                                <TouchableOpacity onPress={() => setSongQuery('')}>
                                    <X size={16} color="#A1A1AA" />
                                </TouchableOpacity>
                            )}
                        </View>

                        <FlatList
                            data={filteredSongs}
                            keyExtractor={(item) => item.id}
                            contentContainerStyle={styles.songPickerList}
                            ListHeaderComponent={
                                <TouchableOpacity
                                    style={[
                                        styles.songOptionRow,
                                        draftTrackId === null && styles.songOptionRowActive,
                                    ]}
                                    onPress={() => {
                                        setDraftTrackId(null);
                                        setDraftTrackTitle(null);
                                        setDraftTrackArtist(null);
                                        setSongPickerVisible(false);
                                    }}
                                >
                                    <View style={styles.trackThumbFallback}>
                                        <Shuffle size={18} color="#38BDF8" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.rankTitle}>
                                            {t('alarm.randomSong')}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            }
                            ListEmptyComponent={
                                <Text style={styles.emptySongsText}>
                                    {t('alarm.noSongsLibrary')}
                                </Text>
                            }
                            renderItem={({ item }) => {
                                const selected = draftTrackId === item.id;
                                return (
                                    <TouchableOpacity
                                        style={[
                                            styles.songOptionRow,
                                            selected && styles.songOptionRowActive,
                                        ]}
                                        onPress={() => {
                                            setDraftTrackId(item.id);
                                            setDraftTrackTitle(item.title);
                                            setDraftTrackArtist(item.artist);
                                            setSongPickerVisible(false);
                                        }}
                                    >
                                        {item.artworkUri ? (
                                            <Image
                                                source={{ uri: item.artworkUri }}
                                                style={styles.trackThumb}
                                            />
                                        ) : (
                                            <View style={styles.trackThumbFallback}>
                                                <Music size={18} color="#60A5FA" />
                                            </View>
                                        )}
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.rankTitle} numberOfLines={1}>
                                                {item.title}
                                            </Text>
                                            <Text style={styles.rankSub} numberOfLines={1}>
                                                {item.artist}
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                );
                            }}
                        />
                    </View>
                </Modal>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#0C0E14',
    },
    modalRoot: {
        flex: 1,
        backgroundColor: '#0C0E14',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    iconBtn: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
        marginLeft: 6,
    },
    saveChipBtn: {
        backgroundColor: '#2563EB',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 999,
    },
    saveChipText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '700',
    },
    segmented: {
        flexDirection: 'row',
        marginHorizontal: 18,
        marginTop: 14,
        marginBottom: 8,
        backgroundColor: '#171C28',
        borderRadius: 999,
        padding: 4,
    },
    segmentBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        borderRadius: 999,
    },
    segmentBtnActive: {
        backgroundColor: '#2563EB',
    },
    segmentText: {
        color: '#A1A1AA',
        fontSize: 13,
        fontWeight: '700',
    },
    segmentTextActive: {
        color: '#FFFFFF',
    },
    scrollContent: {
        padding: 18,
        paddingBottom: 40,
        gap: 14,
    },
    loaderBox: {
        paddingVertical: 60,
        alignItems: 'center',
    },
    heroCard: {
        backgroundColor: '#151822',
        borderRadius: 20,
        padding: 18,
        borderWidth: 1,
        borderColor: 'rgba(96, 165, 250, 0.22)',
    },
    heroTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    heroIconWrap: {
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: 'rgba(37, 99, 235, 0.16)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    todayChip: {
        backgroundColor: 'rgba(56, 189, 248, 0.14)',
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.32)',
        paddingHorizontal: 11,
        paddingVertical: 5,
        borderRadius: 999,
    },
    todayChipText: {
        color: '#7DD3FC',
        fontSize: 12,
        fontWeight: '700',
    },
    heroValue: {
        color: '#FFFFFF',
        fontSize: 36,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
    heroLabel: {
        color: '#A1A1AA',
        fontSize: 13,
        marginTop: 4,
    },
    kpiGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    kpiCard: {
        width: '48%',
        flexGrow: 1,
        backgroundColor: '#151822',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
        gap: 6,
    },
    kpiValue: {
        color: '#FFFFFF',
        fontSize: 22,
        fontWeight: '800',
    },
    kpiLabel: {
        color: '#A1A1AA',
        fontSize: 12,
        fontWeight: '600',
    },
    sectionHeaderRow: {
        marginTop: 4,
    },
    sectionTitle: {
        color: '#E4E4E7',
        fontSize: 14,
        fontWeight: '700',
    },
    listCard: {
        backgroundColor: '#151822',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
        overflow: 'hidden',
    },
    rankRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 11,
        gap: 10,
    },
    rankRowBorder: {
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.06)',
    },
    rankNumber: {
        width: 20,
        color: '#71717A',
        fontSize: 14,
        fontWeight: '800',
        textAlign: 'center',
    },
    rankNumberFirst: {
        color: '#38BDF8',
    },
    trackThumb: {
        width: 42,
        height: 42,
        borderRadius: 10,
    },
    trackThumbFallback: {
        width: 42,
        height: 42,
        borderRadius: 10,
        backgroundColor: '#1E2433',
        justifyContent: 'center',
        alignItems: 'center',
    },
    rankInfo: {
        flex: 1,
    },
    rankTitle: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '700',
    },
    rankSub: {
        color: '#A1A1AA',
        fontSize: 12,
        marginTop: 2,
    },
    playPill: {
        backgroundColor: 'rgba(37, 99, 235, 0.18)',
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 999,
    },
    playPillText: {
        color: '#93C5FD',
        fontSize: 11,
        fontWeight: '700',
    },
    artistRow: {
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 7,
    },
    artistTopLine: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
    },
    artistName: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '700',
    },
    artistPlays: {
        color: '#93C5FD',
        fontSize: 12,
        fontWeight: '700',
    },
    barTrack: {
        height: 6,
        borderRadius: 999,
        backgroundColor: '#232838',
        overflow: 'hidden',
    },
    barFill: {
        height: '100%',
        borderRadius: 999,
        backgroundColor: '#2563EB',
    },
    emptyCard: {
        backgroundColor: '#151822',
        borderRadius: 18,
        padding: 24,
        alignItems: 'center',
        gap: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
    },
    emptyAlarmTitle: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
    emptyCardText: {
        color: '#A1A1AA',
        fontSize: 13,
        textAlign: 'center',
        lineHeight: 19,
    },
    resetStatsBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 13,
        borderRadius: 14,
        backgroundColor: 'rgba(248, 113, 113, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(248, 113, 113, 0.25)',
        marginTop: 4,
    },
    resetStatsText: {
        color: '#F87171',
        fontSize: 14,
        fontWeight: '700',
    },
    nextAlarmBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#151822',
        borderRadius: 18,
        padding: 15,
        borderWidth: 1,
        borderColor: 'rgba(96, 165, 250, 0.22)',
    },
    nextAlarmTitle: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },
    nextAlarmSub: {
        color: '#A1A1AA',
        fontSize: 12,
        marginTop: 2,
    },
    newAlarmBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#2563EB',
        borderRadius: 14,
        paddingVertical: 14,
    },
    newAlarmBtnText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },
    alarmCard: {
        backgroundColor: '#151822',
        borderRadius: 18,
        padding: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        gap: 12,
    },
    alarmCardDisabled: {
        opacity: 0.65,
    },
    alarmTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    alarmTime: {
        color: '#FFFFFF',
        fontSize: 32,
        fontWeight: '800',
        letterSpacing: 0.8,
    },
    alarmTextMuted: {
        color: '#A1A1AA',
    },
    alarmLabel: {
        color: '#A1A1AA',
        fontSize: 13,
        marginTop: 2,
    },
    alarmFooterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.06)',
    },
    alarmTrackBadge: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#1B2030',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
    },
    alarmTrackText: {
        flex: 1,
        color: '#E4E4E7',
        fontSize: 12,
        fontWeight: '600',
    },
    deleteAlarmBtn: {
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: 'rgba(248, 113, 113, 0.12)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    editorContent: {
        padding: 18,
        gap: 14,
        paddingBottom: 32,
    },
    timePickerCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#151822',
        borderRadius: 22,
        paddingVertical: 18,
        gap: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    timeColumn: {
        alignItems: 'center',
        gap: 8,
    },
    stepBtn: {
        width: 56,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#1E2433',
        justifyContent: 'center',
        alignItems: 'center',
    },
    pickerDigits: {
        color: '#FFFFFF',
        fontSize: 48,
        fontWeight: '800',
        minWidth: 74,
        textAlign: 'center',
    },
    pickerColon: {
        color: '#60A5FA',
        fontSize: 44,
        fontWeight: '800',
        marginBottom: 4,
    },
    editorCard: {
        backgroundColor: '#151822',
        borderRadius: 16,
        padding: 15,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    editorRowHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    editorLabel: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '700',
    },
    editorHint: {
        color: '#93C5FD',
        fontSize: 12,
        fontWeight: '600',
    },
    daysRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 6,
    },
    dayCircle: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: '#1E2433',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    dayCircleActive: {
        backgroundColor: '#2563EB',
        borderColor: '#60A5FA',
    },
    dayText: {
        color: '#A1A1AA',
        fontSize: 13,
        fontWeight: '700',
    },
    dayTextActive: {
        color: '#FFFFFF',
    },
    labelInput: {
        color: '#FFFFFF',
        fontSize: 15,
        paddingVertical: 4,
    },
    soundRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    soundValue: {
        color: '#93C5FD',
        fontSize: 13,
        marginTop: 2,
    },
    fadeSub: {
        color: '#A1A1AA',
        fontSize: 12,
        marginTop: 2,
    },
    changeLink: {
        color: '#60A5FA',
        fontSize: 12,
        fontWeight: '700',
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginHorizontal: 16,
        marginVertical: 12,
        backgroundColor: '#151822',
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    searchInput: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 14,
    },
    songPickerList: {
        paddingHorizontal: 16,
        paddingBottom: 24,
        gap: 8,
    },
    songOptionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#151822',
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
    },
    songOptionRowActive: {
        borderColor: '#2563EB',
        backgroundColor: 'rgba(37, 99, 235, 0.16)',
    },
    emptySongsText: {
        color: '#A1A1AA',
        textAlign: 'center',
        marginTop: 32,
        fontSize: 14,
    },
});
