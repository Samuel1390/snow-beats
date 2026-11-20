import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Keyboard,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    View,
    ViewStyle,
} from 'react-native';

interface AnimatedBottomSheetProps {
    visible: boolean;
    onClose: () => void;
    children: React.ReactNode;
    sheetStyle?: ViewStyle;
    avoidKeyboard?: boolean;
}

// Bottom Sheet reutilizable con animación slide-in / slide-out y elevación automática con teclado
export const AnimatedBottomSheet: React.FC<AnimatedBottomSheetProps> = ({
    visible,
    onClose,
    children,
    sheetStyle,
    avoidKeyboard = false,
}) => {
    const [mounted, setMounted] = useState(visible);
    const backdropOpacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(360)).current;
    const keyboardOffset = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            setMounted(true);
            backdropOpacity.setValue(0);
            translateY.setValue(360);
            Animated.parallel([
                Animated.timing(backdropOpacity, {
                    toValue: 1,
                    duration: 210,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.spring(translateY, {
                    toValue: 0,
                    damping: 24,
                    stiffness: 240,
                    mass: 0.9,
                    useNativeDriver: true,
                }),
            ]).start();
        } else if (mounted) {
            Animated.parallel([
                Animated.timing(backdropOpacity, {
                    toValue: 0,
                    duration: 180,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(translateY, {
                    toValue: 380,
                    duration: 200,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
            ]).start(({ finished }) => {
                if (finished) setMounted(false);
            });
        }
    }, [visible, mounted, backdropOpacity, translateY]);

    // Sube la lámina automáticamente sobre el teclado virtual en Android e iOS
    useEffect(() => {
        if (!avoidKeyboard || !mounted) return;

        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const showSub = Keyboard.addListener(showEvent, (e) => {
            const height = e.endCoordinates?.height ?? 0;
            Animated.timing(keyboardOffset, {
                toValue: height,
                duration: Platform.OS === 'ios' ? (e.duration || 220) : 180,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false,
            }).start();
        });

        const hideSub = Keyboard.addListener(hideEvent, (e) => {
            Animated.timing(keyboardOffset, {
                toValue: 0,
                duration: Platform.OS === 'ios' ? (e.duration || 200) : 160,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false,
            }).start();
        });

        return () => {
            showSub.remove();
            hideSub.remove();
            keyboardOffset.setValue(0);
        };
    }, [avoidKeyboard, mounted, keyboardOffset]);

    if (!mounted) return null;

    return (
        <Modal
            visible={mounted}
            transparent
            animationType="none"
            statusBarTranslucent
            onRequestClose={onClose}
        >
            <View style={styles.root}>
                <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
                    <Pressable style={styles.backdropPress} onPress={onClose} />
                </Animated.View>

                <Animated.View style={{ paddingBottom: avoidKeyboard ? keyboardOffset : 0 }}>
                    <Animated.View
                        style={[
                            styles.sheet,
                            sheetStyle,
                            { transform: [{ translateY }] },
                        ]}
                    >
                        <View style={styles.handle} />
                        {children}
                    </Animated.View>
                </Animated.View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    root: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: 'rgba(0,0,0,0.68)',
    },
    backdropPress: {
        flex: 1,
    },
    sheet: {
        backgroundColor: '#111827',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 18,
        paddingTop: 10,
        paddingBottom: 22,
    },
    handle: {
        alignSelf: 'center',
        width: 38,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.22)',
        marginBottom: 12,
    },
});
