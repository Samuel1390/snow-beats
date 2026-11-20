import React, { useState } from 'react';
import {
    Modal,
    View,
    Text,
    Image,
    TouchableOpacity,
    StyleSheet,
    Alert,
    Switch,
} from 'react-native';
import Slider from '@react-native-community/slider';
import * as Sharing from 'expo-sharing';
import {
    ChevronDown,
    Heart,
    MoreVertical,
    SkipBack,
    SkipForward,
    Play,
    Pause,
    Sliders,
    FileText,
    Repeat,
    Repeat1,
    Shuffle,
    Music,
    Plus,
    Forward,
    Gauge,
    BellRing,
    AlarmClock,
    EyeOff,
    Trash2,
} from 'lucide-react-native';
import { SPEED_STEPS, usePlayer } from '../../audio-engine/PlayerContext';
import { getDynamicPlayerPalette } from '../../theme/colorContrast';

function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

interface FullPlayerModalProps {
    visible: boolean;
    onClose: () => void;
}

export const FullPlayerModal: React.FC<FullPlayerModalProps> = ({ visible, onClose }) => {
    const {
        currentTrack,
        isPlaying,
        position,
        duration,
        repeatMode,
        playbackRate,
        pitch,
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
    } = usePlayer();

    const [menuOpen, setMenuOpen] = useState(false);
    const [speedOpen, setSpeedOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [askDeleteAgain, setAskDeleteAgain] = useState(true);
    const [draggingPos, setDraggingPos] = useState<number | null>(null);

    if (!currentTrack) return null;

    const palette = getDynamicPlayerPalette(currentTrack.dominantColor);
    const RepeatIcon =
        repeatMode === 'repeat_one' ? Repeat1 : repeatMode === 'shuffle' ? Shuffle : Repeat;

    const handleShare = async () => {
        setMenuOpen(false);
        if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(currentTrack.uri);
        } else {
            Alert.alert('Compartir', 'No disponible en este dispositivo.');
        }
    };

    const handleDeletePress = () => {
        setMenuOpen(false);
        if (!askDeleteAgain) {
            deleteCurrentTrack();
        } else {
            setDeleteOpen(true);
        }
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Barra superior */}
                <TouchableOpacity onPress={onClose} style={styles.topBtn}>
                    <ChevronDown size={28} color={palette.foreground} />
                </TouchableOpacity>

                {/* Carátula grande centrada */}
                <View style={styles.artWrapper}>
                    {currentTrack.artworkUri ? (
                        <Image source={{ uri: currentTrack.artworkUri }} style={styles.art} />
                    ) : (
                        <Music size={90} color="#52525B" />
                    )}
                </View>

                {/* Información + Favorito + Menú 3 puntos */}
                <View style={styles.infoRow}>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.title, { color: palette.foreground }]} numberOfLines={1}>
                            {currentTrack.title}
                        </Text>
                        <Text style={[styles.artist, { color: palette.muted }]} numberOfLines={1}>
                            {currentTrack.artist}
                        </Text>
                    </View>
                    <TouchableOpacity style={styles.actionBtn} onPress={toggleFavorite}>
                        <Heart
                            size={24}
                            color={currentTrack.isFavorite ? '#EF4444' : palette.foreground}
                            fill={currentTrack.isFavorite ? '#EF4444' : 'transparent'}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => setMenuOpen(true)}>
                        <MoreVertical size={24} color={palette.foreground} />
                    </TouchableOpacity>
                </View>

                {/* Seekbar */}
                <View style={styles.seekBox}>
                    <Slider
                        minimumValue={0}
                        maximumValue={Math.max(1, duration)}
                        value={draggingPos ?? position}
                        onValueChange={(val) => setDraggingPos(val)}
                        onSlidingComplete={(val) => {
                            seekTo(val);
                            setDraggingPos(null);
                        }}
                        minimumTrackTintColor={palette.foreground}
                        maximumTrackTintColor="rgba(255,255,255,0.25)"
                        thumbTintColor={palette.foreground}
                    />
                    <View style={styles.timeRow}>
                        <Text style={[styles.timeText, { color: palette.muted }]}>
                            {formatTime(draggingPos ?? position)}
                        </Text>
                        <Text style={[styles.timeText, { color: palette.muted }]}>{formatTime(duration)}</Text>
                    </View>
                </View>
                {/* Controles centrales */}
                <View style={styles.controlsRow}>
                    <TouchableOpacity onPress={playPrevious} style={styles.ctrlBtn}>
                        <SkipBack size={32} color={palette.foreground} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={togglePlayPause} style={styles.playBtn}>
                        {isPlaying ? <Pause size={34} color="#000000" /> : <Play size={34} color="#000000" />}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={playNext} style={styles.ctrlBtn}>
                        <SkipForward size={32} color={palette.foreground} />
                    </TouchableOpacity>
                </View>

                {/* Footer inferior */}
                <View style={styles.footerRow}>
                    <TouchableOpacity
                        style={styles.footerBtn}
                        onPress={() => Alert.alert('Ecualizador', 'Módulo nativo listo para la siguiente fase.')}
                    >
                        <Sliders size={22} color={palette.foreground} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.footerBtn}
                        onPress={() =>
                            Alert.alert(
                                'Letras',
                                currentTrack.hasLyrics ? 'Mostrando letra...' : 'Esta canción no tiene letra asociada.'
                            )
                        }
                    >
                        <FileText size={22} color={palette.foreground} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.footerBtn} onPress={cycleRepeatMode}>
                        <RepeatIcon size={22} color={palette.foreground} />
                    </TouchableOpacity>
                </View>

                {/* Bottom Sheet de 7 opciones */}
                <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
                    <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setMenuOpen(false)}>
                        <View style={styles.sheet}>
                            <TouchableOpacity style={styles.sheetItem} onPress={() => { setMenuOpen(false); Alert.alert('Playlists', 'Selector de playlist en progreso.'); }}>
                                <Plus size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Agregar a playlist</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.sheetItem} onPress={handleShare}>
                                <Forward size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Compartir archivo</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.sheetItem} onPress={() => { setMenuOpen(false); setSpeedOpen(true); }}>
                                <Gauge size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Velocidad ({playbackRate}x) y Tono ({pitch}x)</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.sheetItem} onPress={() => { setMenuOpen(false); Alert.alert('Tono de llamada', 'Requiere módulo nativo WRITE_SETTINGS.'); }}>
                                <BellRing size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Establecer como tono de llamada</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.sheetItem} onPress={() => { setMenuOpen(false); Alert.alert('Alarma', 'Requiere módulo nativo de alarma.'); }}>
                                <AlarmClock size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Configurar como alarma / Temporizador</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.sheetItem} onPress={() => { setMenuOpen(false); hideCurrentTrack(); }}>
                                <EyeOff size={20} color="#FFFFFF" />
                                <Text style={styles.sheetText}>Ocultar canción</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.sheetItem} onPress={handleDeletePress}>
                                <Trash2 size={20} color="#F87171" />
                                <Text style={[styles.sheetText, { color: '#F87171' }]}>Eliminar del dispositivo</Text>
                            </TouchableOpacity>
                        </View>
                    </TouchableOpacity>
                </Modal>

                {/* Modal de Velocidad y Tono */}
                <Modal visible={speedOpen} transparent animationType="fade" onRequestClose={() => setSpeedOpen(false)}>
                    <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSpeedOpen(false)}>
                        <View style={styles.sheet}>
                            <Text style={styles.sheetTitle}>
                                Velocidad: {playbackRate.toFixed(1)}x (tono preservado)
                            </Text>
                            <Slider
                                minimumValue={0.5}
                                maximumValue={2.0}
                                step={0.1}
                                value={playbackRate}
                                onValueChange={(v) => setSpeed(Math.round(v * 10) / 10)}
                                minimumTrackTintColor="#FFFFFF"
                                maximumTrackTintColor="#374151"
                                thumbTintColor="#FFFFFF"
                            />

                            <Text style={[styles.sheetTitle, { marginTop: 16 }]}>
                                Tono (Pitch): {pitch.toFixed(1)}x
                            </Text>
                            <Slider
                                minimumValue={0.5}
                                maximumValue={2.0}
                                step={0.1}
                                value={pitch}
                                onValueChange={(v) => setPitchValue(Math.round(v * 10) / 10)}
                                minimumTrackTintColor="#FFFFFF"
                                maximumTrackTintColor="#374151"
                                thumbTintColor="#FFFFFF"
                            />

                            <TouchableOpacity
                                style={{ alignSelf: 'flex-end', marginTop: 12, padding: 8 }}
                                onPress={() => { setSpeed(1); setPitchValue(1); }}
                            >
                                <Text style={{ color: '#38BDF8', fontWeight: '700' }}>Restablecer (1.0x)</Text>
                            </TouchableOpacity>
                        </View>
                    </TouchableOpacity>
                </Modal>

                {/* Modal de confirmación de borrado con checkbox */}
                <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => setDeleteOpen(false)}>
                    <View style={styles.centerBackdrop}>
                        <View style={styles.confirmCard}>
                            <Text style={styles.sheetTitle}>¿Mover a Eliminados recientemente?</Text>
                            <View style={styles.checkRow}>
                                <Switch value={askDeleteAgain} onValueChange={setAskDeleteAgain} />
                                <Text style={{ color: '#D1D5DB', marginLeft: 10 }}>Volver a mostrar este aviso</Text>
                            </View>
                            <View style={styles.confirmActions}>
                                <TouchableOpacity onPress={() => setDeleteOpen(false)}>
                                    <Text style={{ color: '#9CA3AF', padding: 10 }}>Cancelar</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={() => {
                                        setDeleteOpen(false);
                                        deleteCurrentTrack();
                                    }}
                                >
                                    <Text style={{ color: '#F87171', fontWeight: '700', padding: 10 }}>Mover a papelera</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Modal>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, paddingHorizontal: 24, paddingTop: 48, paddingBottom: 28, justifyContent: 'space-between' },
    topBtn: { alignSelf: 'flex-start', padding: 6 },
    artWrapper: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: 16,
        backgroundColor: '#27272A',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    art: { width: '100%', height: '100%' },
    infoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
    title: { fontSize: 20, fontWeight: '700' },
    artist: { fontSize: 15, marginTop: 4 },
    actionBtn: { padding: 8, marginLeft: 6 },
    seekBox: { marginTop: 10 },
    timeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
    timeText: { fontSize: 12 },
    controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 36 },
    ctrlBtn: { padding: 10 },
    playBtn: {
        width: 68,
        height: 68,
        borderRadius: 34,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18 },
    footerBtn: { padding: 10 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: '#111827', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
    sheetTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginBottom: 10 },
    sheetItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
    sheetText: { color: '#E5E7EB', fontSize: 15, marginLeft: 14 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1F2937' },
    chipActive: { backgroundColor: '#2563EB' },
    chipText: { color: '#FFFFFF', fontSize: 13 },
    centerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
    confirmCard: { backgroundColor: '#111827', borderRadius: 14, padding: 20 },
    checkRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
    confirmActions: { flexDirection: 'row', justifyContent: 'flex-end' },
});