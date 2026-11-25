import React, { useEffect, useRef } from 'react';
import {
    Animated,
    Easing,
    Image,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { AlarmClock, BellOff, Clock, Music2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../audio-engine/PlayerContext';
import { useI18n } from '../../i18n/LanguageContext';

// Pantalla modal de alarma musical activa con botones de Posponer (5 min) y Detener
export const AlarmRingingModal: React.FC = () => {
    const { ringingAlarm, currentTrack, snoozeRingingAlarm, dismissRingingAlarm } = usePlayer();
    const { t } = useI18n();
    const insets = useSafeAreaInsets();

    const pulseAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!ringingAlarm) {
            pulseAnim.stopAnimation();
            pulseAnim.setValue(0);
            return;
        }
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 1100,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 0,
                    duration: 0,
                    useNativeDriver: true,
                }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, [ringingAlarm, pulseAnim]);

    if (!ringingAlarm) return null;

    const timeText = `${String(ringingAlarm.hour).padStart(2, '0')}:${String(
        ringingAlarm.minute
    ).padStart(2, '0')}`;
    const displayLabel = ringingAlarm.label.trim() || t('alarm.defaultLabel');
    const displayTitle = currentTrack?.title || ringingAlarm.trackTitle || t('alarm.randomSong');
    const displayArtist = currentTrack?.artist || ringingAlarm.trackArtist || '';

    const ringScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.48] });
    const ringOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

    return (
        <Modal
            visible
            animationType="fade"
            statusBarTranslucent
            onRequestClose={dismissRingingAlarm}
        >
            <View
                style={[
                    styles.container,
                    {
                        paddingTop: Math.max(insets.top, 28) + 20,
                        paddingBottom: Math.max(insets.bottom, 20) + 24,
                    },
                ]}
            >
                {/* Encabezado de alarma */}
                <View style={styles.topBadge}>
                    <AlarmClock size={18} color="#60A5FA" />
                    <Text style={styles.topBadgeText}>{t('alarm.ringingTitle')}</Text>
                </View>

                {/* Hora y etiqueta */}
                <View style={styles.clockBlock}>
                    <Text style={styles.timeText}>{timeText}</Text>
                    <Text style={styles.labelText} numberOfLines={2}>
                        {displayLabel}
                    </Text>
                </View>

                {/* Carátula pulsante */}
                <View style={styles.artStage}>
                    <Animated.View
                        pointerEvents="none"
                        style={[
                            styles.pulseRing,
                            {
                                transform: [{ scale: ringScale }],
                                opacity: ringOpacity,
                            },
                        ]}
                    />
                    <View style={styles.artBox}>
                        {currentTrack?.artworkUri ? (
                            <Image
                                source={{ uri: currentTrack.artworkUri }}
                                style={styles.artImage}
                                resizeMode="cover"
                            />
                        ) : (
                            <View style={styles.artFallback}>
                                <Music2 size={56} color="#60A5FA" />
                            </View>
                        )}
                    </View>
                </View>

                {/* Canción sonando */}
                <View style={styles.trackMeta}>
                    <Text style={styles.trackTitle} numberOfLines={1}>
                        {displayTitle}
                    </Text>
                    {displayArtist ? (
                        <Text style={styles.trackArtist} numberOfLines={1}>
                            {displayArtist}
                        </Text>
                    ) : null}
                </View>

                {/* Controles: Posponer 5 min / Detener alarma */}
                <View style={styles.actions}>
                    <TouchableOpacity
                        style={styles.snoozeBtn}
                        activeOpacity={0.85}
                        onPress={() => snoozeRingingAlarm(5)}
                    >
                        <Clock size={19} color="#E4E4E7" />
                        <Text style={styles.snoozeText}>{t('alarm.snoozeBtn')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.dismissBtn}
                        activeOpacity={0.88}
                        onPress={dismissRingingAlarm}
                    >
                        <BellOff size={20} color="#FFFFFF" />
                        <Text style={styles.dismissText}>{t('alarm.dismissBtn')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0C0E14',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
    },
    topBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'rgba(37, 99, 235, 0.16)',
        borderWidth: 1,
        borderColor: 'rgba(96, 165, 250, 0.35)',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
    },
    topBadgeText: {
        color: '#93C5FD',
        fontSize: 13,
        fontWeight: '700',
    },
    clockBlock: {
        alignItems: 'center',
        marginTop: 6,
    },
    timeText: {
        color: '#FFFFFF',
        fontSize: 64,
        fontWeight: '800',
        letterSpacing: 1.5,
    },
    labelText: {
        color: '#D4D4D8',
        fontSize: 17,
        fontWeight: '600',
        marginTop: 4,
        textAlign: 'center',
    },
    artStage: {
        width: 220,
        height: 220,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pulseRing: {
        position: 'absolute',
        width: 184,
        height: 184,
        borderRadius: 92,
        borderWidth: 3,
        borderColor: '#38BDF8',
    },
    artBox: {
        width: 176,
        height: 176,
        borderRadius: 88,
        overflow: 'hidden',
        borderWidth: 3,
        borderColor: 'rgba(96, 165, 250, 0.55)',
        backgroundColor: '#151822',
    },
    artImage: {
        width: '100%',
        height: '100%',
    },
    artFallback: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#151822',
    },
    trackMeta: {
        alignItems: 'center',
        paddingHorizontal: 12,
    },
    trackTitle: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
        textAlign: 'center',
    },
    trackArtist: {
        color: '#A1A1AA',
        fontSize: 14,
        marginTop: 4,
        textAlign: 'center',
    },
    actions: {
        width: '100%',
        gap: 12,
    },
    snoozeBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#151822',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
        borderRadius: 16,
        paddingVertical: 15,
    },
    snoozeText: {
        color: '#F4F4F5',
        fontSize: 15,
        fontWeight: '700',
    },
    dismissBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#2563EB',
        borderRadius: 16,
        paddingVertical: 16,
    },
    dismissText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '800',
    },
});
