// ============================================
// MusixmatchAddon.js
// Registers MusixmatchProvider into ivLyrics LyricsAddonManager
// Load this file AFTER MusixmatchProvider.js
// For personal use only — not for distribution
// ============================================

(function registerMusixmatchAddon() {
    "use strict";

    function tryRegister() {
        if (!window.LyricsAddonManager || !window.MusixmatchProvider) {
            setTimeout(tryRegister, 300);
            return;
        }

        // Settings UI is rendered directly inside Settings.js for stability.

        // ---- Adapter: convert MusixmatchProvider result to ivLyrics format ----

        async function musixmatchGetLyrics(info) {
            const result = await window.MusixmatchProvider.getLyrics(info);
            if (result.error) return result;

            // ivLyrics expects: { uri, provider, karaoke, synced, unsynced, error }
            // karaoke lines: { startTime, endTime, text: [{word, time}], text2? }
            // synced lines:  { text, startTime, text2? }
            // unsynced lines:{ text, text2? }
            return result;
        }

        // ---- Register with LyricsAddonManager ----

        window.LyricsAddonManager.register({
            id: "musixmatch",
            name: "Musixmatch",
            version: "1.0.0",
            author: "Personal",
            description: {
                en: "Fetches lyrics, synced lyrics, karaoke, and human-verified translations from Musixmatch.",
                ko: "Musixmatch에서 가사, 싱크 가사, 카라오케 및 번역을 가져옵니다.",
            },
            supports: {
                karaoke: true,
                synced: true,
                unsynced: true,
                translation: true,
            },
            getLyrics: musixmatchGetLyrics,
            getSettingsUI: () => null,
        });

        // Auto-fetch token on first run if none stored
        if (!window.MusixmatchProvider.getToken()) {
            window.MusixmatchProvider.fetchNewToken().then((token) => {
                if (token) {
                    console.log("[MusixmatchAddon] Initial token fetched successfully");
                }
            });
        }

        console.log("[MusixmatchAddon] Musixmatch provider registered in LyricsAddonManager");
    }

    tryRegister();
})();
