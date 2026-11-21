const { withAndroidManifest, withAppBuildGradle } = require('@expo/config-plugins');

// Plugin de Expo para configurar extractNativeLibs, legacy packaging (yt-dlp/FFmpeg) y almacenamiento en Android
module.exports = function withSnowBeatsAndroid(config) {
    config = withAndroidManifest(config, (mod) => {
        const app = mod.modResults.manifest.application?.[0];
        if (app) {
            app.$['android:extractNativeLibs'] = 'true';
            app.$['android:requestLegacyExternalStorage'] = 'true';
        }
        return mod;
    });

    config = withAppBuildGradle(config, (mod) => {
        if (mod.modResults.language === 'groovy') {
            let contents = mod.modResults.contents;
            if (!contents.includes('useLegacyPackaging')) {
                contents = contents.replace(
                    /android\s*\{/,
                    `android {\n    packaging {\n        jniLibs {\n            useLegacyPackaging = true\n        }\n    }`
                );
                mod.modResults.contents = contents;
            }
        }
        return mod;
    });

    return config;
};
