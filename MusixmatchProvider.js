// ============================================
// MusixmatchProvider.js
// Musixmatch provider for ivLyrics
// Adapted from spicetify/cli lyrics-plus ProviderMusixmatch.js
// For personal use only — not for distribution
// ============================================

const MusixmatchProvider = (() => {
    const headers = {
        authority: "apic-desktop.musixmatch.com",
        cookie: "x-mxm-token-guid=",
    };

    // ---- Token management ----

    function getToken() {
        return Spicetify.LocalStorage.get("ivLyrics:musixmatch-token") || "";
    }

    function saveToken(token) {
        Spicetify.LocalStorage.set("ivLyrics:musixmatch-token", token);
    }

    async function fetchNewToken() {
        const url = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0";
        try {
            const result = await Spicetify.CosmosAsync.get(url, null, headers);
            const token = result?.message?.body?.user_token;
            if (token) {
                saveToken(token);
                return token;
            }
        } catch (e) {
            console.warn("[MusixmatchProvider] Failed to fetch new token:", e);
        }
        return null;
    }

    async function getOrRefreshToken(forceRefresh = false) {
        if (!forceRefresh) {
            const existing = getToken();
            if (existing) return existing;
        }
        return await fetchNewToken();
    }

    // ---- Translation status helper ----

    function findTranslationStatus(body) {
        if (!body || typeof body !== "object") return null;
        if (Array.isArray(body)) {
            for (const item of body) {
                const result = findTranslationStatus(item);
                if (result) return result;
            }
            return null;
        }
        if (Array.isArray(body.track_lyrics_translation_status)) {
            return body.track_lyrics_translation_status;
        }
        for (const value of Object.values(body)) {
            const result = findTranslationStatus(value);
            if (result) return result;
        }
        return null;
    }

    // ---- Performer tagging ----

    function parsePerformerData(meta) {
        if (!meta?.track?.performer_tagging) return [];

        const tagging = meta.track.performer_tagging;
        const miscTags = meta.track.performer_tagging_misc_tags || {};
        let performerMap = [];

        if (tagging?.content?.length > 0) {
            const resources = tagging.resources?.artists || [];
            const resourcesList = Array.isArray(resources) ? resources : Object.values(resources);

            performerMap = tagging.content.map((c) => {
                if (!c.performers?.length) return null;
                const resolvedPerformers = c.performers.map((p) => {
                    let name = "Unknown";
                    if (p.type === "artist") {
                        const fqid = p.fqid;
                        const idFromFqid = fqid ? parseInt(fqid.split(":")[2]) : null;
                        const artist = resourcesList.find((r) => r.artist_id === idFromFqid);
                        if (artist) name = artist.artist_name;
                    } else if (miscTags[p.type]) {
                        name = miscTags[p.type];
                    }
                    return { fqid: p.fqid, artist_id: p.fqid ? parseInt(p.fqid.split(":")[2]) : null, name };
                }).filter((p) => p.name !== "Unknown");

                const names = resolvedPerformers.map((p) => p.name);
                if (!names.length) return null;
                return { name: names.join(", "), snippet: c.snippet, performers: resolvedPerformers };
            }).filter(Boolean);
        }

        const normalize = (text) => text.replace(/\s+/g, "").toLowerCase();
        const snippetQueue = [];

        for (const tag of performerMap) {
            if (!tag.snippet) continue;
            const snippetLines = tag.snippet.split(/\n+/).map((s) => s.trim()).filter(Boolean);
            for (const sLine of snippetLines) {
                if (sLine.length < 2 && !/^[\u3131-\uD79D]/.test(sLine)) continue;
                snippetQueue.push({ text: normalize(sLine), raw: sLine, performers: tag.performers });
            }
        }
        return snippetQueue;
    }

    function matchSequential(lyricsLines, snippetQueue, getTextCallback = (l) => l.text) {
        if (!snippetQueue?.length) return lyricsLines;
        const normalize = (text) => text.replace(/\s+/g, "").toLowerCase();
        let queueCursor = 0;
        const LOOKAHEAD = 5;

        return lyricsLines.map((line) => {
            const lineText = getTextCallback(line) || "♪";
            let normalizedLine = normalize(lineText);
            let matchedPerformers = [];

            while (queueCursor < snippetQueue.length) {
                let matchFoundAtOffset = -1;
                for (let i = 0; i < LOOKAHEAD && queueCursor + i < snippetQueue.length; i++) {
                    const snippet = snippetQueue[queueCursor + i];
                    if (normalizedLine.includes(snippet.text) && snippet.text.length > 0) {
                        matchFoundAtOffset = i;
                        break;
                    }
                }
                if (matchFoundAtOffset !== -1) {
                    queueCursor += matchFoundAtOffset;
                    const matchedSnippet = snippetQueue[queueCursor];
                    matchedPerformers.push(...matchedSnippet.performers);
                    normalizedLine = normalizedLine.replace(matchedSnippet.text, "");
                    queueCursor++;
                } else {
                    break;
                }
            }

            const uniquePerformers = [];
            const sawMap = new Set();
            for (const p of matchedPerformers) {
                const key = p.fqid || p.name;
                if (!sawMap.has(key)) { sawMap.add(key); uniquePerformers.push(p); }
            }
            return { ...line, performers: uniquePerformers };
        });
    }

    function normalizeLineKey(text) {
        if (!text || typeof text !== "string") return "";
        return text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    // ---- Core API request with auto token refresh ----

    async function apiGet(url, retried = false) {
        try {
            const result = await Spicetify.CosmosAsync.get(url, null, headers);
            return result;
        } catch (e) {
            // Status 401 or 429 — refresh token and retry once
            if (!retried) {
                console.warn("[MusixmatchProvider] API error, refreshing token...", e);
                const newToken = await fetchNewToken();
                if (newToken) {
                    // Replace token in url
                    const refreshedUrl = url.replace(/usertoken=[^&]+/, `usertoken=${encodeURIComponent(newToken)}`);
                    return await apiGet(refreshedUrl, true);
                }
            }
            throw e;
        }
    }

    // ---- findLyrics — main entry point ----

    async function findLyrics(info) {
        const token = await getOrRefreshToken();
        if (!token) {
            return { error: "No Musixmatch token available", uri: info.uri };
        }

        const baseURL =
            "https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&namespace=lyrics_richsynched&subtitle_format=mxm&app_id=web-desktop-app-v1.0&";

        const durr = info.duration / 1000;

        const params = {
            q_album: info.album,
            q_artist: info.artist,
            q_artists: info.artist,
            q_track: info.title,
            track_spotify_id: info.uri,
            q_duration: durr,
            f_subtitle_length: Math.floor(durr),
            usertoken: token,
            part: "track_lyrics_translation_status,track_structure,track_performer_tagging",
        };

        const finalURL = baseURL + Object.keys(params).map((key) => `${key}=${encodeURIComponent(params[key])}`).join("&");

        let body;
        try {
            body = await apiGet(finalURL);
        } catch (e) {
            return { error: `Request failed: ${e.message}`, uri: info.uri };
        }

        const topStatus = body?.message?.header?.status_code;
        console.log("[MusixmatchProvider] findLyrics status", topStatus);
        if (topStatus !== 200) {
            return { error: `Musixmatch API status ${topStatus}`, uri: info.uri };
        }

        body = body.message.body.macro_calls;

        if (body["matcher.track.get"].message.header.status_code !== 200) {
            return { error: `Matcher error: ${body["matcher.track.get"].message.header.mode}`, uri: info.uri };
        }
        if (body["track.lyrics.get"]?.message?.body?.lyrics?.restricted) {
            return { error: "Unfortunately we're not authorized to show these lyrics.", uri: info.uri };
        }

        const translationStatus = findTranslationStatus(body);
        const meta = body?.["matcher.track.get"]?.message?.body;
        const availableTranslations = Array.isArray(translationStatus)
            ? [...new Set(translationStatus.map((s) => s?.to).filter(Boolean))]
            : [];

        Object.defineProperties(body, {
            __musixmatchTranslationStatus: { value: availableTranslations },
            __musixmatchTrackId: { value: meta?.track?.track_id ?? null },
        });

        const hasLyrics = !!body["track.lyrics.get"]?.message?.body?.lyrics?.lyrics_body;
        const hasSubtitles = !!body["track.subtitles.get"]?.message?.body?.subtitle_list?.length;
        const hasRichsync = !!meta?.track?.has_richsync;
        console.log("[MusixmatchProvider] findLyrics availability", {
            hasLyrics,
            hasSubtitles,
            hasRichsync,
            availableTranslations
        });

        return body;
    }

    // ---- getKaraoke ----

    async function getKaraoke(body) {
        const meta = body?.["matcher.track.get"]?.message?.body;
        if (!meta) return null;
        if (!meta.track.has_richsync || meta.track.instrumental) return null;

        const token = getToken();
        const baseURL = "https://apic-desktop.musixmatch.com/ws/1.1/track.richsync.get?format=json&subtitle_format=mxm&app_id=web-desktop-app-v1.0&";
        const params = {
            f_subtitle_length: meta.track.track_length,
            q_duration: meta.track.track_length,
            commontrack_id: meta.track.commontrack_id,
            usertoken: token,
        };
        const finalURL = baseURL + Object.keys(params).map((k) => `${k}=${encodeURIComponent(params[k])}`).join("&");

        let result;
        try {
            result = await apiGet(finalURL);
        } catch (e) {
            console.warn("[MusixmatchProvider] getKaraoke failed:", e);
            return null;
        }

        if (result.message.header.status_code !== 200) return null;
        result = result.message.body;

        const snippetQueue = parsePerformerData(meta);

        const parsedKaraoke = JSON.parse(result.richsync.richsync_body).map((line) => {
            const lineStartTime = Math.round((line.ts || 0) * 1000);
            const lineEndTime = Math.round((line.te || 0) * 1000);
            const words = Array.isArray(line.l) ? line.l : [];

            let text = "";
            const syllables = words.map((word, index) => {
                const chunkText = word?.c ?? "";
                text += chunkText;

                const offset = Number(word?.o);
                const nextOffset = Number(words[index + 1]?.o);

                const startTime = Number.isFinite(offset)
                    ? lineStartTime + Math.round(offset * 1000)
                    : lineStartTime;
                const endTime = Number.isFinite(nextOffset)
                    ? lineStartTime + Math.round(nextOffset * 1000)
                    : lineEndTime;

                return {
                    text: chunkText,
                    startTime,
                    endTime: Math.max(startTime, endTime),
                };
            });

            if (!text) text = "♪";

            return {
                startTime: lineStartTime,
                endTime: Math.max(lineStartTime, lineEndTime),
                text,
                originalText: text,
                syllables,
            };
        });

        return matchSequential(parsedKaraoke, snippetQueue, (line) => line.text).map((line) => ({
            ...line,
            performer: (line.performers || []).map((p) => p.name).filter(Boolean).join(", ") || null,
        }));
    }

    // ---- getSynced ----

    function getSynced(body) {
        const meta = body?.["matcher.track.get"]?.message?.body;
        if (!meta) return null;
        if (meta.track.instrumental) return [{ text: "♪ Instrumental ♪", startTime: 0 }];
        if (!meta.track.has_subtitles) return null;

        const subtitle = body["track.subtitles.get"]?.message?.body?.subtitle_list?.[0]?.subtitle;
        if (!subtitle) return null;

        const snippetQueue = parsePerformerData(meta);
        const rawLines = JSON.parse(subtitle.subtitle_body);

        return matchSequential(rawLines, snippetQueue, (l) => l.text).map((line) => ({
            text: line.text || "♪",
            originalText: line.text || "♪",
            startTime: line.time.total * 1000,
            performer: (line.performers || []).map((p) => p.name).filter(Boolean).join(", ") || null,
        }));
    }

    // ---- getUnsynced ----

    function getUnsynced(body) {
        const meta = body?.["matcher.track.get"]?.message?.body;
        if (!meta) return null;
        if (meta.track.instrumental) return [{ text: "♪ Instrumental ♪" }];
        if (!meta.track.has_lyrics && !meta.track.has_lyrics_crowd) return null;

        const lyrics = body["track.lyrics.get"]?.message?.body?.lyrics?.lyrics_body;
        if (!lyrics) return null;

        const snippetQueue = parsePerformerData(meta);
        const rawLines = lyrics.split("\n").map((text) => ({ text }));

        return matchSequential(rawLines, snippetQueue, (l) => l.text).map((line) => ({
            ...line,
            originalText: line.text || "",
            performer: (line.performers || []).map((p) => p.name).filter(Boolean).join(", ") || null,
        }));
    }

    // ---- getTranslation ----

    async function getTranslation(trackId, availableTranslations = null) {
        if (!trackId) return null;

        // Read preferred language from ivLyrics settings
        const storedLanguage =
            Spicetify.LocalStorage.get("ivLyrics:musixmatch-translation-language") || "none";
        const userSelected =
            Spicetify.LocalStorage.get("ivLyrics:musixmatch-translation-language-user") === "true";
        let selectedLanguage = storedLanguage;
        let isAutoSelected = false;

        // Auto-pick UI language if translation source expects provider translations
        if (selectedLanguage === "none") {
            const translateSource =
                Spicetify.LocalStorage.get("ivLyrics:visual:translate:translated-lyrics-source") || "auto";
            if (!userSelected && (translateSource === "musixmatch" || translateSource === "auto")) {
                const uiLang = Spicetify.Locale?.getLocale()?.split("-")[0] || "en";
                selectedLanguage = uiLang || "en";
                isAutoSelected = true;
                console.log("[MusixmatchProvider] auto-selected translation language", {
                    trackId,
                    translateSource,
                    selectedLanguage,
                });
            }
        }

        // If availableTranslations are provided and selected language not available
        if (Array.isArray(availableTranslations) && availableTranslations.length > 0) {
            const isExplicit = storedLanguage !== "none" && userSelected && !isAutoSelected;

            // Try match by iso-3 as well
            let compareLang = selectedLanguage;
            if (compareLang && compareLang.length === 2) {
                const staticIso2ToIso3 = {
                    ru: "rus",
                    en: "eng",
                    es: "spa",
                    fr: "fra",
                    de: "deu",
                    tr: "tur",
                    id: "ind",
                    tl: "tgl",
                    zh: "zho",
                    ja: "jpn",
                    ko: "kor",
                    vi: "vie",
                    pt: "por",
                    pl: "pol",
                    ar: "ara",
                    hi: "hin",
                    th: "tha",
                };
                compareLang = (languageCodeMap && languageCodeMap[compareLang]) || staticIso2ToIso3[compareLang] || compareLang;
            }

            const inList = availableTranslations.includes(selectedLanguage) ||
                (compareLang && availableTranslations.includes(compareLang));

            if (!inList) {
                if (isExplicit) {
                    console.log("[MusixmatchProvider] selected language not in list, will still try", {
                        selectedLanguage,
                        availableTranslations,
                    });
                }
                const fallbackLang = availableTranslations[0];
                console.log("[MusixmatchProvider] selected language not available, fallback", {
                    selectedLanguage,
                    fallbackLang,
                    availableTranslations,
                });
                if (!isExplicit) {
                    selectedLanguage = fallbackLang;
                }
            }
        }

        // Convert iso-2 to iso-3 if needed
        if (selectedLanguage && selectedLanguage.length === 2) {
            const staticIso2ToIso3 = {
                ru: "rus",
                en: "eng",
                es: "spa",
                fr: "fra",
                de: "deu",
                tr: "tur",
                id: "ind",
                tl: "tgl",
                zh: "zho",
                ja: "jpn",
                ko: "kor",
                vi: "vie",
                pt: "por",
                pl: "pol",
                ar: "ara",
                hi: "hin",
                th: "tha",
            };
            const mapped = (languageCodeMap && languageCodeMap[selectedLanguage]) || staticIso2ToIso3[selectedLanguage];
            if (mapped) {
                console.log("[MusixmatchProvider] mapped language code", {
                    from: selectedLanguage,
                    to: mapped,
                });
                selectedLanguage = mapped;
            }
        }

        console.log("[MusixmatchProvider] getTranslation", { trackId, selectedLanguage, availableTranslations });
        if (selectedLanguage === "none") return null;

        const token = getToken();
        console.log("[MusixmatchProvider] getTranslation token present", !!token);
        const baseURL =
            "https://apic-desktop.musixmatch.com/ws/1.1/crowd.track.translations.get?translation_fields_set=minimal&comment_format=text&format=json&app_id=web-desktop-app-v1.0&";

        const fetchTranslations = async (langCode) => {
            const params = {
                track_id: trackId,
                selected_language: langCode,
                usertoken: token,
            };
            const finalURL = baseURL + Object.keys(params).map((k) => `${k}=${encodeURIComponent(params[k])}`).join("&");
            try {
                const result = await apiGet(finalURL);
                const statusCode = result?.message?.header?.status_code;
                console.log("[MusixmatchProvider] getTranslation status", statusCode, "lang", langCode);
                if (statusCode !== 200) return null;
                const body = result.message.body;
                console.log("[MusixmatchProvider] getTranslation list size", body?.translations_list?.length || 0, "lang", langCode);
                if (!body.translations_list?.length) return null;
                const lines = body.translations_list.map(({ translation }) => ({
                    translation: translation.description,
                    matchedLine: translation.matched_line,
                }));
                return { lines, language: langCode };
            } catch (e) {
                console.warn("[MusixmatchProvider] getTranslation failed:", e);
                return null;
            }
        };

        let translations = await fetchTranslations(selectedLanguage);
        if (!translations && userSelected && storedLanguage !== selectedLanguage && storedLanguage !== "none") {
            // If user explicitly chose a language, retry with original iso-2 code
            console.log("[MusixmatchProvider] retrying translation with original language", {
                storedLanguage,
                selectedLanguage,
            });
            translations = await fetchTranslations(storedLanguage);
        }

        return translations;
    }

    // ---- getLanguages ----

    let languageMap = null;
    let languageCodeMap = null;

    async function getLanguages() {
        if (languageMap) return languageMap;

        try {
            const cached = localStorage.getItem("ivLyrics:musixmatch-languages");
            if (cached) {
                const tempMap = JSON.parse(cached);
                if (tempMap.__version === 1) {
                    if (tempMap.__codeMap && typeof tempMap.__codeMap === "object") {
                        languageCodeMap = tempMap.__codeMap;
                    }
                    delete tempMap.__version;
                    delete tempMap.__codeMap;
                    languageMap = tempMap;
                    return languageMap;
                }
            }
        } catch (e) {
            console.warn("[MusixmatchProvider] Failed to parse cached languages", e);
        }

        const token = await getOrRefreshToken();
        if (!token) return {};

        const url = `https://apic-desktop.musixmatch.com/ws/1.1/languages.get?app_id=web-desktop-app-v1.0&get_romanized_info=1&usertoken=${encodeURIComponent(token)}`;

        try {
            const body = await apiGet(url);
            if (body?.message?.body?.language_list) {
                languageMap = {};
                languageCodeMap = {};
                body.message.body.language_list.forEach((item) => {
                    const lang = item.language;
                    if (lang.language_name) {
                        const name = lang.language_name.charAt(0).toUpperCase() + lang.language_name.slice(1);
                        if (lang.language_iso_code_1) languageMap[lang.language_iso_code_1] = name;
                        if (lang.language_iso_code_3) languageMap[lang.language_iso_code_3] = name;
                        if (lang.language_iso_code_1 && lang.language_iso_code_3) {
                            languageCodeMap[lang.language_iso_code_1] = lang.language_iso_code_3;
                        }
                    }
                });
                localStorage.setItem("ivLyrics:musixmatch-languages", JSON.stringify({
                    ...languageMap,
                    __version: 1,
                    __codeMap: languageCodeMap,
                }));
                return languageMap;
            }
        } catch (e) {
            console.error("[MusixmatchProvider] Failed to fetch languages", e);
        }
        return {};
    }

    // ---- Main getLyrics entry point (ivLyrics LyricsAddonManager compatible) ----

    async function getLyrics(info) {
        try {
            console.log("[MusixmatchProvider] getLyrics start", {
                title: info.title,
                artist: info.artist,
                album: info.album,
                uri: info.uri,
            });
            const body = await findLyrics(info);
            if (body.error) return body;

            const trackId = body.__musixmatchTrackId;
            const availableTranslations = body.__musixmatchTranslationStatus || [];

            // Fetch in parallel
            const [karaoke, synced, translationResult] = await Promise.all([
                getKaraoke(body),
                Promise.resolve(getSynced(body)),
                getTranslation(trackId, availableTranslations),
            ]);
            const unsynced = getUnsynced(body);
            const translation = translationResult?.lines || null;
            const translationLangResolved = translationResult?.language || null;

            console.log("[MusixmatchProvider] raw results", {
                trackId,
                hasKaraoke: Array.isArray(karaoke) && karaoke.length,
                hasSynced: Array.isArray(synced) && synced.length,
                hasUnsynced: Array.isArray(unsynced) && unsynced.length,
                translationLines: Array.isArray(translation) ? translation.length : 0,
                availableTranslations,
            });

            let syncedSafe = synced;
            if (!syncedSafe && karaoke && Array.isArray(karaoke)) {
                syncedSafe = karaoke.map((line) => ({
                    text: line.text || "♪",
                    startTime: line.startTime || 0,
                    performer: line.performer || null,
                }));
            }

            // Build translation map: matchedLine -> translation text
            let translationMap = null;
            let translationMapNormalized = null;
            if (translation?.length) {
                translationMap = {};
                translationMapNormalized = {};
                for (const t of translation) {
                    if (t.matchedLine) {
                        const rawKey = t.matchedLine.trim();
                        translationMap[rawKey] = t.translation;
                        const normalizedKey = normalizeLineKey(rawKey);
                        if (normalizedKey) {
                            translationMapNormalized[normalizedKey] = t.translation;
                        }
                    }
                }
            }

            if (translationMap) {
                const sampleKeys = Object.keys(translationMap).slice(0, 3);
                console.log("[MusixmatchProvider] translation map sample", {
                    sampleKeys,
                    sampleValues: sampleKeys.map((k) => translationMap[k]),
                });
            }

            // Auto-select Musixmatch as translation source when its translation is available
            if (translationMap && Object.keys(translationMap).length > 0) {
                const currentSource = Spicetify.LocalStorage.get("ivLyrics:visual:translate:translated-lyrics-source") || "auto";
                if (currentSource === "auto" || currentSource === "none") {
                    Spicetify.LocalStorage.set("ivLyrics:visual:translate:translated-lyrics-source", "musixmatch");
                    if (window.CONFIG?.visual) {
                        window.CONFIG.visual["translate:translated-lyrics-source"] = "musixmatch";
                    }
                }
            }

            // Helper: attach translation text2 to a lines array
            function attachTranslation(lines) {
                if (!lines || !translationMap) return lines;
                let matchCount = 0;
                const out = lines.map((line, idx) => {
                    const original = line.originalText || line.text || "";
                    const key = original.trim();
                    let trans = translationMap[key];
                    if (!trans && translationMapNormalized) {
                        const normalized = normalizeLineKey(original);
                        trans = translationMapNormalized[normalized];
                    }
                    if (!trans && translation?.[idx]?.translation) {
                        trans = translation[idx].translation;
                    }
                    if (!trans && original) {
                        console.log("[MusixmatchProvider] no translation match", {
                            original,
                            normalized: normalizeLineKey(original),
                        });
                    }
                    if (trans) matchCount++;
                    return trans ? { ...line, text2: trans } : line;
                });
                console.log("[MusixmatchProvider] translation attached", {
                    totalLines: lines.length,
                    matched: matchCount,
                });
                return out;
            }

            // Attach translations to all modes (text2)
            const syncedWithTrans = attachTranslation(syncedSafe);
            const unsyncedWithTrans = attachTranslation(unsynced);

            // For karaoke: attach translation as text2 per line
            let karaokeWithTrans = karaoke;
            if (karaoke && translationMap) {
                let karaokeMatchCount = 0;
                karaokeWithTrans = karaoke.map((line, idx) => {
                    const lineText = line.originalText || line.text || "";
                    let trans = translationMap[lineText.trim()];
                    if (!trans && translationMapNormalized) {
                        const normalized = normalizeLineKey(lineText);
                        trans = translationMapNormalized[normalized];
                    }
                    if (!trans && translation?.[idx]?.translation) {
                        trans = translation[idx].translation;
                    }
                    if (!trans && lineText) {
                        console.log("[MusixmatchProvider] no karaoke translation match", {
                            lineText,
                            normalized: normalizeLineKey(lineText),
                        });
                    }
                    if (trans) karaokeMatchCount++;
                    return trans ? { ...line, text2: trans } : line;
                });
                console.log("[MusixmatchProvider] karaoke translation attached", {
                    totalLines: karaoke.length,
                    matched: karaokeMatchCount,
                });
            }

            const translateSource = Spicetify.LocalStorage.get("ivLyrics:visual:translate:translated-lyrics-source") || "auto";
            console.log("[MusixmatchProvider] translate source", translateSource);
            console.log("[MusixmatchProvider] sample line", {
                syncedSample: syncedWithTrans?.[0],
                unsyncedSample: unsyncedWithTrans?.[0],
                karaokeSample: karaokeWithTrans?.[0],
            });

            return {
                uri: info.uri,
                provider: "musixmatch",
                karaoke: karaokeWithTrans,
                synced: syncedWithTrans,
                unsynced: unsyncedWithTrans,
                availableTranslations,
                translationLanguage: Spicetify.LocalStorage.get("ivLyrics:musixmatch-translation-language") || "none",
                translationLanguageResolved: translationLangResolved || null,
            };
        } catch (e) {
            console.error("[MusixmatchProvider] getLyrics failed:", e);
            return { error: e.message, uri: info.uri };
        }
    }

    return {
        getLyrics,
        findLyrics,
        getKaraoke,
        getSynced,
        getUnsynced,
        getTranslation,
        getLanguages,
        getOrRefreshToken,
        fetchNewToken,
        getToken,
        saveToken,
    };
})();

window.MusixmatchProvider = MusixmatchProvider;
