(function youtubeAdBlockerEntry() {
    const MODULE_KEY = "__ivLyricsVideoBackgroundDepend";
    const moduleState = window[MODULE_KEY] || (window[MODULE_KEY] = {
        initialized: false,
        waitTimer: null,
        playerPatchTimer: null,
        iframeObserver: null,
        restoreCallbacks: new Map()
    });

    if (moduleState.initialized) {
        return;
    }

    const registerRestore = (key, restore) => {
        if (!moduleState.restoreCallbacks.has(key)) {
            moduleState.restoreCallbacks.set(key, restore);
        }
    };

    const restoreAll = () => {
        if (moduleState.waitTimer) {
            clearTimeout(moduleState.waitTimer);
            moduleState.waitTimer = null;
        }
        if (moduleState.playerPatchTimer) {
            clearTimeout(moduleState.playerPatchTimer);
            moduleState.playerPatchTimer = null;
        }
        if (moduleState.iframeObserver) {
            moduleState.iframeObserver.disconnect();
            moduleState.iframeObserver = null;
        }

        [...moduleState.restoreCallbacks.values()].reverse().forEach((restore) => {
            try {
                restore();
            } catch (err) {
                // Ignore restore failures
            }
        });

        moduleState.restoreCallbacks.clear();
        moduleState.initialized = false;
        delete window[MODULE_KEY];
    };

    window.VideoBackgroundDepend = {
        restore: restoreAll
    };

    // Blocks YouTube iframe ads loaded inside Spicetify by sanitizing requests and patching the player API.
    const waitForSpicetify = () => {
        if (!window.Spicetify || !Spicetify.Player || !document.body) {
            if (!moduleState.waitTimer) {
                moduleState.waitTimer = setTimeout(() => {
                    moduleState.waitTimer = null;
                    waitForSpicetify();
                }, 250);
            }
            return;
        }
        moduleState.waitTimer = null;
        initialize();
    };

    const logPrefix = "[ivLyrics VBD]";

    const blockedPatterns = [
        /doubleclick\.net/i,
        /googlesyndication\.com/i,
        /googleads\.g\.doubleclick\.net/i,
        /pagead(?!.*youtube\.com\/iframe)/i,
        /pagead2\.googlesyndication\.com/i,
        /tpc\.googlesyndication\.com/i,
        /pubads\.g\.doubleclick\.net/i,
        /securepubads\.g\.doubleclick\.net/i,
        /gvt\d+\.com\/ads/i,
        /manifest\.googlevideo\.com\/api\/manifest\/ads/i,
        /googlevideo\.com\/videoplayback.*[&?](ctier|oad|adformat)=/i,
        /googlevideo\.com\/initplayback.*[&?](ctier|oad|adformat)=/i,
        /youtube\.com\/pagead/i,
        /youtube(?:-nocookie)?\.com\/(?:pagead\/)?(?:adview|activeview|interaction)\?/i,
        /youtube(?:-nocookie)?\.com\/pcs\/activeview/i,
        /youtube(?:-nocookie)?\.com\/generate_204/i,
        /youtube\.com\/ptracking/i,
        /youtube\.com\/api\/stats\/(ads|qoe|watchtime|playback)/i,
        /youtube\.com\/api\/stats\/atr/i,
        /youtube\.com\/get_midroll_info/i,
        /youtubei\/v1\/(get_midroll_info|ad_break|player\/ad_break)/i,
        /youtubei\/v1\/next.*[&?](adformat|ad_|afv_|ctier|oad)=/i,
        /youtubei\/v1\/att\/log/i,
        /youtubei\/v1\/log_event/i,
        /youtubei\/v1\/player.*adformat/i,
        /youtube\.com\/get_video_info.*adformat/i,
        /youtube\.com\/yva_/i,
        /yt\d?\.ggpht\.com\/ad/i,
        /ytimg\.com\/.*ad/i,
        /yt3\.ggpht\.com\/ytc\/.*ad/i,
        /s0\.2mdn\.net/i,
        /gstaticadssl\.googleapis\.com/i
    ];

    const adQueryParamPatterns = [
        /^ad($|_|format|s$)/i,
        /^afv_/i,
        /^adunit$/i,
        /^adslot$/i,
        /^ad_cpn$/i,
        /^ad_type$/i,
        /^ad_flags$/i,
        /^break_type$/i,
        /^ctier$/i,
        /^oad$/i,
        /^pltype$/i,
        /^prerolls?$/i,
        /^instream$/i
    ];

    const adFeatureFlagPatterns = [
        /^html5_player_enable_ads_client=true$/i,
        /^player_ads_enable_gcf=true$/i,
        /^kevlar_allow_multistep_video_ads=true$/i,
        /^enable_desktop_ad_controls=true$/i,
        /^disable_persistent_ads=false$/i,
        /^html5_disable_ads=false$/i
    ];

    const youtubePlayerResponsePatterns = [
        /youtube(?:-nocookie)?\.com\/(?:watch|playlist|embed\/|youtubei\/v1\/(?:player|get_watch|browse|search|next|guide|reel_watch_sequence|get_survey)|get_video_info)/i,
        /youtubei\.googleapis\.com\/youtubei\/v1\/(?:player|get_watch|browse|search|next|guide|reel_watch_sequence|get_survey)/i
    ];

    const adPayloadArrayKeys = new Set([
        "adPlacements",
        "playerAds",
        "adSlots",
        "adBreaks",
        "playerAdParams",
        "adSlotMetadata"
    ]);

    const adPayloadObjectKeys = new Set([
        "adBreakHeartbeatParams",
        "adSafetyReason",
        "adSignalsInfo",
        "adTagParameters",
        "adTrackingParams",
        "frameworkUpdates",
        "promotedSparklesWebRenderer",
        "promotedVideoRenderer",
        "compactPromotedVideoRenderer",
        "compactPromotedItemRenderer",
        "backgroundPromoRenderer",
        "statementBannerRenderer",
        "brandVideoShelfRenderer",
        "brandVideoSingletonRenderer",
        "inlineAdLayoutRenderer",
        "adSlotRenderer",
        "linkedInstreamAdRenderer",
        "shoppingCarouselRenderer",
        "merchandiseShelfRenderer",
        "playerLegacyDesktopWatchAdsRenderer"
    ]);

    const adPayloadDottedPaths = [
        "playerResponse.adPlacements",
        "playerResponse.adSlots",
        "playerResponse.playerAds",
        "playerResponse.adBreakHeartbeatParams",
        "playerResponse.auxiliaryUi.messageRenderers.upsellDialogRenderer",
        "auxiliaryUi.messageRenderers.upsellDialogRenderer",
        "responseContext.adSignalsInfo",
        "ytInitialPlayerResponse.playerAds",
        "ytInitialPlayerResponse.adPlacements",
        "ytInitialPlayerResponse.adSlots",
        "ytInitialPlayerResponse.adBreakHeartbeatParams",
        "ytInitialPlayerResponse.auxiliaryUi.messageRenderers.upsellDialogRenderer",
        "ytInitialData.frameworkUpdates"
    ];

    const adKeyReplacementPairs = [
        [/"adPlacements"/g, "\"no_ads\""],
        [/"adSlots"/g, "\"no_ads\""],
        [/"playerAds"/g, "\"no_ads\""]
    ];

    const normalizeUrlString = (candidate) => {
        if (!candidate) return "";
        if (typeof candidate === "string") return candidate;
        if (candidate?.url) return candidate.url;
        if (candidate?.href) return candidate.href;
        return String(candidate);
    };

    const isYouTubeRequestHost = (hostname) => {
        return /(^|\.)youtube(?:-nocookie)?\.com$/i.test(hostname) ||
            /(^|\.)youtu\.be$/i.test(hostname) ||
            /(^|\.)youtubei\.googleapis\.com$/i.test(hostname) ||
            /(^|\.)googlevideo\.com$/i.test(hostname);
    };

    const isYouTubeAdTelemetryUrl = (url) => {
        if (!isYouTubeRequestHost(url.hostname)) {
            return false;
        }

        const path = url.pathname.replace(/^\/pagead\//i, "/");
        if (!/^\/(?:adview|activeview|interaction)$/i.test(path)) {
            return false;
        }

        return url.searchParams.has("ad_cpn") ||
            url.searchParams.has("ai") ||
            url.searchParams.has("adformat") ||
            url.searchParams.has("afv_ad_tag");
    };

    const stripAdQueryParams = (url) => {
        let changed = false;
        [...url.searchParams.keys()].forEach((key) => {
            if (adQueryParamPatterns.some((pattern) => pattern.test(key))) {
                url.searchParams.delete(key);
                changed = true;
            }
        });

        const fflags = url.searchParams.get("fflags");
        if (fflags) {
            const keptFlags = fflags
                .split("&")
                .map((flag) => flag.trim())
                .filter((flag) => flag && !adFeatureFlagPatterns.some((pattern) => pattern.test(flag)));
            const nextFlags = keptFlags.join("&");
            if (nextFlags !== fflags) {
                if (nextFlags) {
                    url.searchParams.set("fflags", nextFlags);
                } else {
                    url.searchParams.delete("fflags");
                }
                changed = true;
            }
        }

        return changed;
    };

    const addAdSuppressionParams = (url) => {
        if (!/\/(embed\/|youtubei\/v1\/player|get_video_info)/i.test(url.pathname)) {
            return false;
        }

        let changed = false;
        const setParam = (key, value) => {
            if (url.searchParams.get(key) !== value) {
                url.searchParams.set(key, value);
                changed = true;
            }
        };

        setParam("iv_load_policy", "3");
        setParam("modestbranding", "1");
        setParam("suppress_ads", "1");
        setParam("ads", "0");
        return changed;
    };

    const sanitizeAdParamsFromUrl = (candidate) => {
        const ref = normalizeUrlString(candidate);
        if (!ref) return null;
        try {
            const url = new URL(ref, window.location.origin);
            if (!isYouTubeRequestHost(url.hostname)) {
                return null;
            }

            const stripped = stripAdQueryParams(url);
            const suppressed = addAdSuppressionParams(url);
            const changed = stripped || suppressed;
            return changed ? url.toString() : null;
        } catch (err) {
            return null;
        }
    };

    const makeFetchResourceWithUrl = (resource, url) => {
        if (!url) return resource;
        if (typeof resource === "string") return url;
        if (typeof URL !== "undefined" && resource instanceof URL) return new URL(url);
        if (typeof Request !== "undefined" && resource instanceof Request) return new Request(url, resource);
        return resource;
    };

    const matchesAdUrl = (candidate) => {
        if (!candidate) return false;
        try {
            const ref = normalizeUrlString(candidate);
            if (!ref) return false;
            if (blockedPatterns.some((pattern) => pattern.test(ref))) {
                return true;
            }
            const url = new URL(ref, window.location.origin);
            return isYouTubeAdTelemetryUrl(url);
        } catch (err) {
            return false;
        }
    };

    const shouldPruneYouTubeResponse = (candidate) => {
        const ref = normalizeUrlString(candidate);
        if (!ref) return false;
        return youtubePlayerResponsePatterns.some((pattern) => pattern.test(ref));
    };

    const deleteNestedAdPath = (payload, dottedPath) => {
        if (!payload || typeof payload !== "object" || !dottedPath) return false;
        const parts = dottedPath.split(".");
        let current = payload;
        for (let index = 0; index < parts.length - 1; index++) {
            current = current?.[parts[index]];
            if (!current || typeof current !== "object") {
                return false;
            }
        }
        const leaf = parts[parts.length - 1];
        if (Object.prototype.hasOwnProperty.call(current, leaf)) {
            delete current[leaf];
            return true;
        }
        return false;
    };

    const pruneYouTubeAdPayload = (payload, seen = new WeakSet()) => {
        if (!payload || typeof payload !== "object") {
            return payload;
        }
        if (seen.has(payload)) {
            return payload;
        }
        seen.add(payload);

        if (Array.isArray(payload)) {
            payload.forEach((item) => pruneYouTubeAdPayload(item, seen));
            return payload;
        }

        adPayloadDottedPaths.forEach((path) => deleteNestedAdPath(payload, path));

        for (const key of Object.keys(payload)) {
            if (adPayloadArrayKeys.has(key)) {
                payload[key] = [];
                continue;
            }
            if (adPayloadObjectKeys.has(key)) {
                delete payload[key];
                continue;
            }
            pruneYouTubeAdPayload(payload[key], seen);
        }

        return payload;
    };

    const replaceAdKeysInText = (text) => {
        if (typeof text !== "string" || !text) return text;
        return adKeyReplacementPairs.reduce((nextText, [pattern, replacement]) => {
            return nextText.replace(pattern, replacement);
        }, text);
    };

    const responseTextMightContainAds = (text) => {
        if (typeof text !== "string" || !text) return false;
        const hints = [
            "\"adPlacements\"",
            "\"adSlots\"",
            "\"playerAds\"",
            "\"adBreakHeartbeatParams\"",
            "\"adSignalsInfo\"",
            "\"frameworkUpdates\"",
            "\"promotedVideoRenderer\"",
            "\"adSlotRenderer\"",
            "\"isAd\""
        ];
        return hints.some((hint) => text.includes(hint));
    };

    const pruneYouTubeAdText = (text) => {
        if (!responseTextMightContainAds(text)) return text;
        const replacedText = replaceAdKeysInText(text);
        try {
            const parsed = JSON.parse(replacedText);
            return JSON.stringify(pruneYouTubeAdPayload(parsed));
        } catch (err) {
            return replacedText;
        }
    };

    const hasYouTubeAdPayload = (payload, seen = new WeakSet()) => {
        if (!payload || typeof payload !== "object") {
            return false;
        }
        if (seen.has(payload)) {
            return false;
        }
        seen.add(payload);

        if (Array.isArray(payload)) {
            return payload.some((item) => hasYouTubeAdPayload(item, seen));
        }

        return Object.keys(payload).some((key) => (
            adPayloadArrayKeys.has(key) ||
            adPayloadObjectKeys.has(key) ||
            adPayloadDottedPaths.some((path) => path.endsWith(`.${key}`) || path === key) ||
            hasYouTubeAdPayload(payload[key], seen)
        ));
    };

    const patchResponseForAdPruning = (response, requestUrl) => {
        if (!response || response.__ytAdBlockResponsePruned || !shouldPruneYouTubeResponse(response.url || requestUrl)) {
            return response;
        }

        const originalJson = typeof response.json === "function" ? response.json.bind(response) : null;
        const originalText = typeof response.text === "function" ? response.text.bind(response) : null;

        if (originalJson) {
            response.json = async () => pruneYouTubeAdPayload(await originalJson());
        }
        if (originalText) {
            response.text = async () => {
                const text = await originalText();
                return pruneYouTubeAdText(text);
            };
        }

        response.__ytAdBlockResponsePruned = true;
        return response;
    };

    const patchJsonParse = () => {
        if (!JSON?.parse || JSON.parse.__ytAdBlockWrapped) return;
        const originalParse = JSON.parse;
        const wrappedParse = function patchedJsonParse(text, reviver) {
            const parsed = originalParse.apply(this, arguments);
            return hasYouTubeAdPayload(parsed) ? pruneYouTubeAdPayload(parsed) : parsed;
        };
        wrappedParse.__ytAdBlockWrapped = true;
        JSON.parse = wrappedParse;
        registerRestore("json-parse", () => {
            if (JSON.parse === wrappedParse) {
                JSON.parse = originalParse;
            }
        });
    };

    const patchResponsePrototypeJson = () => {
        if (!window.Response?.prototype?.json || Response.prototype.json.__ytAdBlockWrapped) return;
        const originalJson = Response.prototype.json;
        const wrappedJson = async function patchedResponseJson(...args) {
            const data = await originalJson.apply(this, args);
            return hasYouTubeAdPayload(data) ? pruneYouTubeAdPayload(data) : data;
        };
        wrappedJson.__ytAdBlockWrapped = true;
        Response.prototype.json = wrappedJson;
        registerRestore("response-json", () => {
            if (Response.prototype.json === wrappedJson) {
                Response.prototype.json = originalJson;
            }
        });
    };

    const patchYouTubePlayerResponseGlobals = () => {
        if (window.__ytAdBlockPlayerResponseGlobalsWrapped) return;
        const originalDescriptors = new Map();

        ["ytInitialPlayerResponse", "ytInitialData"].forEach((key) => {
            let value = pruneYouTubeAdPayload(window[key]);
            const descriptor = Object.getOwnPropertyDescriptor(window, key);
            if (descriptor && descriptor.configurable === false) {
                return;
            }

            originalDescriptors.set(key, descriptor);
            Object.defineProperty(window, key, {
                configurable: true,
                enumerable: descriptor?.enumerable ?? true,
                get() {
                    return value;
                },
                set(nextValue) {
                    value = pruneYouTubeAdPayload(nextValue);
                }
            });
        });

        window.__ytAdBlockPlayerResponseGlobalsWrapped = true;
        registerRestore("youtube-player-response-globals", () => {
            originalDescriptors.forEach((descriptor, key) => {
                if (descriptor) {
                    Object.defineProperty(window, key, descriptor);
                } else {
                    delete window[key];
                }
            });
            delete window.__ytAdBlockPlayerResponseGlobalsWrapped;
        });
    };

    const blockRequest = (label, url) => {
        console.info(`${logPrefix} blocked ${label}: ${url}`);
    };

    const mergeFeatureFlags = (existing = "", forcedFlags = []) => {
        const map = new Map();
        const pushFlag = (flag) => {
            if (!flag) return;
            const [key, value = "true"] = flag.split("=");
            if (!key) return;
            map.set(key.trim(), value.trim());
        };
        existing.split("&").forEach(pushFlag);
        forcedFlags.forEach(pushFlag);
        return [...map.entries()].map(([key, value]) => `${key}=${value}`).join("&");
    };

    const patchFetch = () => {
        if (window.fetch.__ytAdBlockWrapped) return;
        const originalFetch = window.fetch;
        const wrappedFetch = async function patchedFetch(resource, init) {
            const target = normalizeUrlString(resource);
            const sanitizedTarget = sanitizeAdParamsFromUrl(target);
            const requestTarget = sanitizedTarget || target;
            if (matchesAdUrl(requestTarget)) {
                blockRequest("fetch", requestTarget);
                return Promise.resolve(new Response(null, { status: 204, statusText: "No Content" }));
            }
            const response = await originalFetch.call(this, makeFetchResourceWithUrl(resource, sanitizedTarget), init);
            return patchResponseForAdPruning(response, requestTarget);
        };
        wrappedFetch.__ytAdBlockWrapped = true;
        window.fetch = wrappedFetch;
        registerRestore("fetch", () => {
            if (window.fetch === wrappedFetch) {
                window.fetch = originalFetch;
            }
        });
    };

    const patchXHR = () => {
        if (XMLHttpRequest.prototype.__ytAdBlockWrapped) return;
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
            const sanitizedUrl = sanitizeAdParamsFromUrl(url);
            const requestUrl = sanitizedUrl || url;
            this.__ytAdBlockUrl = requestUrl;
            const args = Array.from(arguments);
            args[1] = requestUrl;
            return originalOpen.apply(this, args);
        };

        XMLHttpRequest.prototype.send = function patchedSend(body) {
            if (matchesAdUrl(this.__ytAdBlockUrl)) {
                blockRequest("xhr", this.__ytAdBlockUrl);
                setTimeout(() => {
                    const errorEvent = new Event("error");
                    this.dispatchEvent(errorEvent);
                    if (typeof this.onerror === "function") {
                        this.onerror(errorEvent);
                    }
                }, 0);
                return undefined;
            }
            if (shouldPruneYouTubeResponse(this.__ytAdBlockUrl)) {
                const xhr = this;
                const interceptResponse = () => {
                    if (xhr.readyState !== 4) return;
                    try {
                        xhr.removeEventListener("readystatechange", interceptResponse, true);
                    } catch (err) {
                        // Ignore cleanup failures
                    }

                    const responseType = xhr.responseType;
                    let sourceText = "";
                    try {
                        if (responseType === "" || responseType === "text") {
                            sourceText = xhr.responseText || "";
                        } else if (responseType === "json" && xhr.response && typeof xhr.response === "object") {
                            sourceText = JSON.stringify(xhr.response);
                        } else {
                            return;
                        }
                    } catch (err) {
                        return;
                    }

                    const nextText = pruneYouTubeAdText(sourceText);
                    if (nextText === sourceText) return;

                    try {
                        if (responseType === "" || responseType === "text") {
                            Object.defineProperty(xhr, "responseText", { value: nextText, configurable: true });
                            Object.defineProperty(xhr, "response", { value: nextText, configurable: true });
                        } else if (responseType === "json") {
                            Object.defineProperty(xhr, "response", { value: JSON.parse(nextText), configurable: true });
                        }
                    } catch (err) {
                        // Browser may expose readonly XHR slots; leave original response in that case.
                    }
                };
                xhr.addEventListener("readystatechange", interceptResponse, { capture: true });
            }
            return originalSend.apply(this, arguments);
        };

        XMLHttpRequest.prototype.__ytAdBlockWrapped = true;
        registerRestore("xhr", () => {
            XMLHttpRequest.prototype.open = originalOpen;
            XMLHttpRequest.prototype.send = originalSend;
            delete XMLHttpRequest.prototype.__ytAdBlockWrapped;
        });
    };

    const patchSendBeacon = () => {
        if (!navigator.sendBeacon || navigator.sendBeacon.__ytAdBlockWrapped) return;
        const originalSendBeacon = navigator.sendBeacon.bind(navigator);
        const wrappedBeacon = (url, data) => {
            const sanitizedUrl = sanitizeAdParamsFromUrl(url);
            const requestUrl = sanitizedUrl || url;
            if (matchesAdUrl(requestUrl)) {
                blockRequest("beacon", requestUrl);
                return true;
            }
            return originalSendBeacon(requestUrl, data);
        };
        wrappedBeacon.__ytAdBlockWrapped = true;
        navigator.sendBeacon = wrappedBeacon;
        registerRestore("sendBeacon", () => {
            if (navigator.sendBeacon === wrappedBeacon) {
                navigator.sendBeacon = originalSendBeacon;
            }
        });
    };

    const patchScriptElements = () => {
        if (!window.HTMLScriptElement || HTMLScriptElement.prototype.__ytAdBlockWrapped) return;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
        const originalSetAttribute = HTMLScriptElement.prototype.setAttribute;
        if (descriptor?.set) {
            Object.defineProperty(HTMLScriptElement.prototype, "src", {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: descriptor.get,
                set(value) {
                    if (matchesAdUrl(value)) {
                        blockRequest("script", value);
                        descriptor.set.call(this, "");
                        return;
                    }
                    descriptor.set.call(this, value);
                }
            });
        }
        HTMLScriptElement.prototype.setAttribute = function patchedSetAttribute(name, value) {
            if (typeof name === "string" && name.toLowerCase() === "src" && matchesAdUrl(value)) {
                blockRequest("script", value);
                return undefined;
            }
            return originalSetAttribute.apply(this, arguments);
        };
        HTMLScriptElement.prototype.__ytAdBlockWrapped = true;
        registerRestore("script-elements", () => {
            if (descriptor) {
                Object.defineProperty(HTMLScriptElement.prototype, "src", descriptor);
            }
            HTMLScriptElement.prototype.setAttribute = originalSetAttribute;
            delete HTMLScriptElement.prototype.__ytAdBlockWrapped;
        });
    };

    const patchLinkElements = () => {
        if (!window.HTMLLinkElement || HTMLLinkElement.prototype.__ytAdBlockWrapped) return;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, "href");
        const originalSetAttribute = HTMLLinkElement.prototype.setAttribute;
        if (descriptor?.set) {
            Object.defineProperty(HTMLLinkElement.prototype, "href", {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: descriptor.get,
                set(value) {
                    if (matchesAdUrl(value)) {
                        blockRequest("link", value);
                        descriptor.set.call(this, "about:blank");
                        return;
                    }
                    descriptor.set.call(this, value);
                }
            });
        }
        HTMLLinkElement.prototype.setAttribute = function patchedSetAttribute(name, value) {
            if (typeof name === "string" && ["href", "data-href"].includes(name.toLowerCase()) && matchesAdUrl(value)) {
                blockRequest("link", value);
                return undefined;
            }
            return originalSetAttribute.apply(this, arguments);
        };
        HTMLLinkElement.prototype.__ytAdBlockWrapped = true;
        registerRestore("link-elements", () => {
            if (descriptor) {
                Object.defineProperty(HTMLLinkElement.prototype, "href", descriptor);
            }
            HTMLLinkElement.prototype.setAttribute = originalSetAttribute;
            delete HTMLLinkElement.prototype.__ytAdBlockWrapped;
        });
    };

    const patchDocumentCreateElement = () => {
        if (Document.prototype.__ytAdBlockWrappedCreateElement) return;
        const originalCreateElement = Document.prototype.createElement;
        Document.prototype.createElement = function patchedCreateElement(tagName, options) {
            const element = originalCreateElement.call(this, tagName, options);
            const upper = typeof tagName === "string" ? tagName.toUpperCase() : "";
            if (upper === "IFRAME") {
                setTimeout(() => sanitizeIframe(element), 0);
            }
            return element;
        };
        Document.prototype.__ytAdBlockWrappedCreateElement = true;
        registerRestore("document-create-element", () => {
            Document.prototype.createElement = originalCreateElement;
            delete Document.prototype.__ytAdBlockWrappedCreateElement;
        });
    };

    const patchServiceWorkers = () => {
        const scope = navigator.serviceWorker;
        if (!scope || scope.__ytAdBlockWrapped) return;
        const originalRegister = scope.register.bind(scope);
        scope.register = function patchedRegister(url, options) {
            if (matchesAdUrl(url)) {
                blockRequest("serviceworker", url);
                return Promise.reject(new DOMException("Blocked ad service worker", "SecurityError"));
            }
            return originalRegister(url, options);
        };
        scope.__ytAdBlockWrapped = true;
        registerRestore("service-workers", () => {
            scope.register = originalRegister;
            delete scope.__ytAdBlockWrapped;
        });
    };

    const patchWindowOpen = () => {
        if (!window.open || window.open.__ytAdBlockWrapped) return;
        const originalOpen = window.open;
        const wrappedOpen = function patchedOpen(url, target, features) {
            if (matchesAdUrl(url)) {
                blockRequest("window.open", url);
                return null;
            }
            return originalOpen.call(this, url, target, features);
        };
        wrappedOpen.__ytAdBlockWrapped = true;
        window.open = wrappedOpen;
        registerRestore("window-open", () => {
            if (window.open === wrappedOpen) {
                window.open = originalOpen;
            }
        });
    };

    const patchTimerNeutralization = () => {
        if (!window.setTimeout || window.setTimeout.__ytAdBlockWrapped) return;
        const originalSetTimeout = window.setTimeout;
        const timerKillCache = new WeakSet();
        const timerInspectedCache = new WeakSet();

        const wrappedSetTimeout = function patchedSetTimeout(handler, delay, ...args) {
            let nextDelay = delay;
            if (typeof handler === "function" && typeof delay === "number" && delay >= 16000 && delay <= 18000) {
                if (timerKillCache.has(handler)) {
                    nextDelay = 1;
                } else if (!timerInspectedCache.has(handler)) {
                    timerInspectedCache.add(handler);
                    try {
                        const source = Function.prototype.toString.call(handler);
                        const isNativeOrBound = source.includes("[native code]");
                        if (/onAbnormal|adBlock|adblock|abnormalityDetected/.test(source)) {
                            timerKillCache.add(handler);
                            nextDelay = 1;
                        } else if (isNativeOrBound && delay === 17000) {
                            timerKillCache.add(handler);
                            nextDelay = 8 + Math.floor(Math.random() * 38);
                        }
                    } catch (err) {
                        // Ignore inspection failures
                    }
                }
            }
            return originalSetTimeout.call(this, handler, nextDelay, ...args);
        };

        wrappedSetTimeout.__ytAdBlockWrapped = true;
        window.setTimeout = wrappedSetTimeout;
        registerRestore("timer-neutralization", () => {
            if (window.setTimeout === wrappedSetTimeout) {
                window.setTimeout = originalSetTimeout;
            }
        });
    };

    const patchImageElements = () => {
        if (!window.HTMLImageElement || HTMLImageElement.prototype.__ytAdBlockWrapped) return;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
        const originalSetAttribute = HTMLImageElement.prototype.setAttribute;
        if (descriptor && descriptor.set) {
            Object.defineProperty(HTMLImageElement.prototype, "src", {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: descriptor.get,
                set(value) {
                    if (matchesAdUrl(value)) {
                        blockRequest("image", value);
                        descriptor.set.call(this, "");
                        return;
                    }
                    descriptor.set.call(this, value);
                }
            });
        }
        HTMLImageElement.prototype.setAttribute = function patchedSetAttribute(name, value) {
            if (typeof name === "string" && name.toLowerCase() === "src" && matchesAdUrl(value)) {
                blockRequest("image", value);
                return undefined;
            }
            return originalSetAttribute.apply(this, arguments);
        };
        HTMLImageElement.prototype.__ytAdBlockWrapped = true;
        registerRestore("image-elements", () => {
            if (descriptor) {
                Object.defineProperty(HTMLImageElement.prototype, "src", descriptor);
            }
            HTMLImageElement.prototype.setAttribute = originalSetAttribute;
            delete HTMLImageElement.prototype.__ytAdBlockWrapped;
        });
    };

    const patchIframeSetter = () => {
        if (!window.HTMLIFrameElement || HTMLIFrameElement.prototype.__ytAdBlockWrapped) return;
        const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
        if (descriptor && descriptor.set) {
            Object.defineProperty(HTMLIFrameElement.prototype, "src", {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: descriptor.get,
                set(value) {
                    const sanitized = sanitizeYoutubeSrc(value);
                    if (sanitized && sanitized !== value) {
                        descriptor.set.call(this, sanitized);
                        return;
                    }
                    if (matchesAdUrl(value)) {
                        blockRequest("iframe", value);
                        descriptor.set.call(this, "about:blank");
                        return;
                    }
                    descriptor.set.call(this, value);
                }
            });
        }
        HTMLIFrameElement.prototype.__ytAdBlockWrapped = true;
        registerRestore("iframe-setter", () => {
            if (descriptor) {
                Object.defineProperty(HTMLIFrameElement.prototype, "src", descriptor);
            }
            delete HTMLIFrameElement.prototype.__ytAdBlockWrapped;
        });
    };

    const patchWebSocket = () => {
        if (!window.WebSocket || window.WebSocket.__ytAdBlockWrapped) return;
        const OriginalWebSocket = window.WebSocket;
        const createBlockedSocket = (url) => {
            blockRequest("websocket", url);
            const listeners = new Map();
            const socket = {
                readyState: OriginalWebSocket.CLOSED,
                bufferedAmount: 0,
                extensions: "",
                protocol: "",
                url: normalizeUrlString(url),
                binaryType: "blob",
                addEventListener(type, handler) {
                    if (!listeners.has(type)) listeners.set(type, new Set());
                    if (handler) listeners.get(type).add(handler);
                },
                removeEventListener(type, handler) {
                    listeners.get(type)?.delete(handler);
                },
                dispatchEvent(event) {
                    listeners.get(event.type)?.forEach((fn) => {
                        try {
                            fn.call(this, event);
                        } catch (err) {
                            console.error(err);
                        }
                    });
                    const handlerName = `on${event.type}`;
                    if (typeof this[handlerName] === "function") {
                        this[handlerName](event);
                    }
                    return true;
                },
                close() { },
                send() { }
            };
            setTimeout(() => {
                const errorEvent = new Event("error");
                socket.dispatchEvent(errorEvent);
            }, 0);
            return socket;
        };
        const PatchedWebSocket = function wrappedWebSocket(url, protocols) {
            if (matchesAdUrl(url)) {
                return createBlockedSocket(url);
            }
            return new OriginalWebSocket(url, protocols);
        };
        PatchedWebSocket.prototype = OriginalWebSocket.prototype;
        Object.setPrototypeOf(PatchedWebSocket, OriginalWebSocket);
        PatchedWebSocket.__ytAdBlockWrapped = true;
        window.WebSocket = PatchedWebSocket;
        registerRestore("websocket", () => {
            if (window.WebSocket === PatchedWebSocket) {
                window.WebSocket = OriginalWebSocket;
            }
        });
    };

    const patchEventSource = () => {
        if (!window.EventSource || window.EventSource.__ytAdBlockWrapped) return;
        const OriginalEventSource = window.EventSource;
        const PatchedEventSource = function wrappedEventSource(url, config) {
            if (matchesAdUrl(url)) {
                blockRequest("eventsource", url);
                const dummy = {
                    readyState: OriginalEventSource.CLOSED,
                    url: normalizeUrlString(url),
                    withCredentials: Boolean(config?.withCredentials),
                    close() { },
                    addEventListener() { },
                    removeEventListener() { }
                };
                setTimeout(() => {
                    const errorEvent = new Event("error");
                    dummy.onerror?.(errorEvent);
                }, 0);
                return dummy;
            }
            return new OriginalEventSource(url, config);
        };
        PatchedEventSource.prototype = OriginalEventSource.prototype;
        Object.setPrototypeOf(PatchedEventSource, OriginalEventSource);
        PatchedEventSource.__ytAdBlockWrapped = true;
        window.EventSource = PatchedEventSource;
        registerRestore("eventsource", () => {
            if (window.EventSource === PatchedEventSource) {
                window.EventSource = OriginalEventSource;
            }
        });
    };

    const patchWorkers = () => {
        const wrapConstructor = (Ctor, label) => {
            if (!Ctor || Ctor.__ytAdBlockWrapped) return;
            const Patched = function wrappedWorker(url, options) {
                if (matchesAdUrl(url)) {
                    blockRequest(label, url);
                    throw new DOMException("Blocked ad worker", "SecurityError");
                }
                return new Ctor(url, options);
            };
            Patched.prototype = Ctor.prototype;
            Object.setPrototypeOf(Patched, Ctor);
            Patched.__ytAdBlockWrapped = true;
            return Patched;
        };

        if (window.Worker) {
            const OriginalWorker = window.Worker;
            const patchedWorker = wrapConstructor(window.Worker, "worker");
            if (patchedWorker) {
                window.Worker = patchedWorker;
                registerRestore("worker", () => {
                    if (window.Worker === patchedWorker) {
                        window.Worker = OriginalWorker;
                    }
                });
            }
        }
        if (window.SharedWorker) {
            const OriginalSharedWorker = window.SharedWorker;
            const patchedSharedWorker = wrapConstructor(window.SharedWorker, "sharedworker");
            if (patchedSharedWorker) {
                window.SharedWorker = patchedSharedWorker;
                registerRestore("shared-worker", () => {
                    if (window.SharedWorker === patchedSharedWorker) {
                        window.SharedWorker = OriginalSharedWorker;
                    }
                });
            }
        }
    };

    const sanitizeYoutubeSrc = (src) => {
        if (!src || !/youtu(be\.com|\.be|be-nocookie\.com|be\.googleapis\.com)/i.test(src)) {
            return src;
        }
        try {
            const url = new URL(src, window.location.origin);
            if (/youtu\.be$/i.test(url.hostname)) {
                const videoIdFromPath = url.pathname.replace(/^\//, "");
                url.hostname = "www.youtube-nocookie.com";
                url.pathname = `/embed/${videoIdFromPath}`;
            } else if (/youtube\.com$/i.test(url.hostname) && url.pathname === "/watch") {
                const videoId = url.searchParams.get("v");
                if (videoId) {
                    url.pathname = `/embed/${videoId}`;
                    url.searchParams.delete("v");
                }
            }
            url.hostname = "www.youtube-nocookie.com";
            stripAdQueryParams(url);
            url.searchParams.set("rel", "0");
            url.searchParams.set("iv_load_policy", "3");
            url.searchParams.set("modestbranding", "1");
            url.searchParams.set("playsinline", "1");
            url.searchParams.set("enablejsapi", "1");
            url.searchParams.set("fs", "0");
            url.searchParams.set("disablekb", "1");
            url.searchParams.set("suppress_ads", "1");
            url.searchParams.set("ads", "0");
            url.searchParams.set("origin", window.location.origin);
            url.searchParams.set("widget_referrer", window.location.origin);
            return url.toString();
        } catch (err) {
            return src;
        }
    };

    const sanitizeIframe = (iframe) => {
        if (!iframe) return;
        const currentSrc = iframe.getAttribute("src");
        if (!currentSrc) return;
        if (iframe.__ytAdBlockSanitized && iframe.__ytAdBlockLastSrc === currentSrc) return;
        if (!/youtu(be\.com|\.be|be-nocookie\.com|be\.googleapis\.com)/i.test(currentSrc)) return;
        const sanitizedSrc = sanitizeYoutubeSrc(currentSrc);
        if (sanitizedSrc && sanitizedSrc !== currentSrc) {
            iframe.setAttribute("src", sanitizedSrc);
            iframe.__ytAdBlockLastSrc = sanitizedSrc;
        } else {
            iframe.__ytAdBlockLastSrc = currentSrc;
        }
        iframe.setAttribute("referrerpolicy", "origin");
        iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
        iframe.__ytAdBlockSanitized = true;
    };

    const observeIframes = () => {
        if (moduleState.iframeObserver) {
            return;
        }

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes?.forEach((node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    if (node.tagName === "IFRAME") {
                        sanitizeIframe(node);
                    }
                    node.querySelectorAll?.("iframe").forEach(sanitizeIframe);
                });
                if (mutation.type === "attributes" && mutation.target.tagName === "IFRAME") {
                    sanitizeIframe(mutation.target);
                }
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src"]
        });
        document.querySelectorAll("iframe").forEach(sanitizeIframe);
        moduleState.iframeObserver = observer;
        registerRestore("iframe-observer", () => {
            if (moduleState.iframeObserver === observer) {
                observer.disconnect();
                moduleState.iframeObserver = null;
            }
        });
    };

    const AD_STATE_CODES = new Set([105, 106, 107, 108, 109, 110, 111]);
    // Inspired by https://github.com/MartinBraquet/youtube-adblock: mute + fast-forward to neutralize stubborn ad slots.
    const MAX_AD_PLAYBACK_RATE = 16;
    const AD_SEEK_COOLDOWN_MS = 600;
    const AD_RELOAD_GRACE_MS = 1200;
    const RELOAD_COOLDOWN_MS = 900;

    const normalizeVideoDescriptor = (value, fallbackStartSeconds = 0) => {
        if (!value) return null;
        if (typeof value === "string") {
            return { videoId: value, startSeconds: fallbackStartSeconds };
        }
        if (typeof value === "object") {
            const videoId = value.videoId || value.video_id;
            if (!videoId) return null;
            const startSeconds = value.startSeconds ?? value.start ?? value.t ?? fallbackStartSeconds;
            return {
                videoId,
                startSeconds: typeof startSeconds === "number" ? startSeconds : fallbackStartSeconds,
                endSeconds: value.endSeconds ?? value.end,
                suggestedQuality: value.suggestedQuality || value.quality || "default"
            };
        }
        return null;
    };

    const setDesiredVideoDescriptor = (player, descriptor) => {
        if (!player || !descriptor || !descriptor.videoId) return;
        player.__ytDesiredVideo = {
            videoId: descriptor.videoId,
            startSeconds: typeof descriptor.startSeconds === "number" ? descriptor.startSeconds : 0,
            endSeconds: typeof descriptor.endSeconds === "number" ? descriptor.endSeconds : undefined,
            suggestedQuality: descriptor.suggestedQuality || "default"
        };
    };

    const getCurrentPlayerVideoId = (player) => {
        if (!player || typeof player.getVideoData !== "function") return null;
        try {
            const data = player.getVideoData();
            return data?.video_id || data?.videoId || null;
        } catch (err) {
            return null;
        }
    };

    const refreshDesiredVideoFromPlayer = (player) => {
        if (!player || typeof player.getVideoData !== "function") return;
        try {
            const data = player.getVideoData();
            const currentVideoId = data?.video_id || data?.videoId;
            const desiredVideoId = player.__ytDesiredVideo?.videoId;
            if (desiredVideoId && currentVideoId && currentVideoId !== desiredVideoId) {
                return;
            }
            if (currentVideoId && !isAdPlayback(player)) {
                setDesiredVideoDescriptor(player, {
                    videoId: currentVideoId,
                    startSeconds: typeof player.getCurrentTime === "function" ? player.getCurrentTime() : 0
                });
            }
        } catch (err) {
            // Ignore read errors
        }
    };

    const getPlayerControlState = (player) => {
        if (!player.__ytAdControlState) {
            player.__ytAdControlState = {
                previousRate: null,
                previousMuted: null,
                adStartedTimestamp: null,
                mismatchStartedTimestamp: null,
                lastSeekTimestamp: 0,
                restoreTimer: null
            };
        }
        return player.__ytAdControlState;
    };

    const isAdPlayback = (player) => {
        if (!player) return false;
        try {
            if (typeof player.getAdState === "function" && player.getAdState() === 1) {
                return true;
            }
        } catch (err) {
            // Ignore
        }
        try {
            const videoUrl = typeof player.getVideoUrl === "function" ? player.getVideoUrl() : "";
            if (matchesAdUrl(videoUrl)) {
                return true;
            }
        } catch (err) {
            // Ignore
        }
        try {
            const desiredVideoId = player.__ytDesiredVideo?.videoId;
            const currentVideoId = getCurrentPlayerVideoId(player);
            if (desiredVideoId && currentVideoId && currentVideoId !== desiredVideoId) {
                const controlState = getPlayerControlState(player);
                const now = performance.now();
                if (controlState.mismatchStartedTimestamp === null) {
                    controlState.mismatchStartedTimestamp = now;
                }
                return now - controlState.mismatchStartedTimestamp > AD_SEEK_COOLDOWN_MS;
            }
            const controlState = getPlayerControlState(player);
            controlState.mismatchStartedTimestamp = null;
        } catch (err) {
            // Ignore
        }
        try {
            const state = typeof player.getPlayerState === "function" ? player.getPlayerState() : null;
            return AD_STATE_CODES.has(state);
        } catch (err) {
            return false;
        }
    };

    const suppressAdPlayback = (player) => {
        const controlState = getPlayerControlState(player);
        if (controlState.previousRate === null && typeof player.getPlaybackRate === "function") {
            try {
                controlState.previousRate = player.getPlaybackRate();
            } catch (err) {
                controlState.previousRate = null;
            }
        }
        if (controlState.previousMuted === null && typeof player.isMuted === "function") {
            try {
                controlState.previousMuted = player.isMuted();
            } catch (err) {
                controlState.previousMuted = null;
            }
        }

        if (typeof player.setPlaybackRate === "function") {
            try {
                player.setPlaybackRate(MAX_AD_PLAYBACK_RATE);
            } catch (err) {
                // Ignore
            }
        }
        if (typeof player.mute === "function") {
            try {
                player.mute();
            } catch (err) {
                // Ignore
            }
        }
    };

    const restoreNormalPlayback = (player) => {
        const controlState = getPlayerControlState(player);
        if (controlState.restoreTimer) {
            clearTimeout(controlState.restoreTimer);
        }
        controlState.restoreTimer = setTimeout(() => {
            if (controlState.previousRate !== null && typeof player.setPlaybackRate === "function") {
                try {
                    player.setPlaybackRate(controlState.previousRate);
                } catch (err) {
                    // Ignore
                }
            }
            if (controlState.previousMuted === false) {
                if (typeof player.unMute === "function") {
                    try {
                        player.unMute();
                    } catch (err) {
                        // Ignore
                    }
                } else if (typeof player.setVolume === "function") {
                    try {
                        player.setVolume(100);
                    } catch (err) {
                        // Ignore
                    }
                }
            }
            controlState.previousRate = null;
            controlState.previousMuted = null;
            controlState.adStartedTimestamp = null;
            controlState.mismatchStartedTimestamp = null;
            controlState.restoreTimer = null;
        }, 250);
    };

    const tryReloadVideo = (player) => {
        if (!player || !player.__ytDesiredVideo) return false;
        const lastReload = player.__ytLastReloadTimestamp || 0;
        const now = performance.now();
        if (now - lastReload < RELOAD_COOLDOWN_MS) {
            return false;
        }

        const descriptor = player.__ytDesiredVideo;
        const payload = {
            videoId: descriptor.videoId,
            startSeconds: descriptor.startSeconds || 0,
            endSeconds: descriptor.endSeconds,
            suggestedQuality: descriptor.suggestedQuality || "default"
        };
        try {
            player.__ytLastReloadTimestamp = now;
            if (typeof player.loadVideoById === "function") {
                player.loadVideoById(payload);
                return true;
            }
        } catch (err) {
            // Continue to other fallbacks
        }
        return false;
    };

    const attemptAdSkip = (player) => {
        suppressAdPlayback(player);
        const controlState = getPlayerControlState(player);
        const now = performance.now();
        if (controlState.adStartedTimestamp === null) {
            controlState.adStartedTimestamp = now;
        }

        if (typeof player.skipAd === "function") {
            try {
                player.skipAd();
                if (now - controlState.adStartedTimestamp < AD_SEEK_COOLDOWN_MS) {
                    return;
                }
            } catch (err) {
                // Continue to fallback logic
            }
        }

        const duration = typeof player.getDuration === "function" ? player.getDuration() : null;
        const current = typeof player.getCurrentTime === "function" ? player.getCurrentTime() : null;

        if (duration && current !== null && duration > 0 && now - controlState.lastSeekTimestamp > AD_SEEK_COOLDOWN_MS) {
            controlState.lastSeekTimestamp = now;
            try {
                player.seekTo(Math.max(duration - 0.1, 0), true);
                return;
            } catch (err) {
                // Ignore and try next fallback
            }
        }

        if (now - controlState.adStartedTimestamp > AD_RELOAD_GRACE_MS && tryReloadVideo(player)) {
            return;
        }

        if (typeof player.nextVideo === "function") {
            try {
                player.nextVideo();
                return;
            } catch (err) {
                // Ignore
            }
        }

        tryReloadVideo(player);
    };

    const attachAdSkipper = (player) => {
        if (!player || player.__ytAdSkipperAttached) return;
        player.__ytAdSkipperAttached = true;

        const syncAdState = () => {
            if (!player) return;
            if (isAdPlayback(player)) {
                attemptAdSkip(player);
            } else {
                restoreNormalPlayback(player);
                refreshDesiredVideoFromPlayer(player);
            }
        };

        if (typeof player.addEventListener === "function") {
            player.addEventListener("onStateChange", syncAdState);
            player.addEventListener("onAdStart", () => attemptAdSkip(player));
            player.addEventListener("onAdEnd", () => {
                restoreNormalPlayback(player);
                refreshDesiredVideoFromPlayer(player);
            });
            player.addEventListener("onError", () => {
                if (!tryReloadVideo(player)) {
                    attemptAdSkip(player);
                }
            });
            player.addEventListener("onApiChange", () => refreshDesiredVideoFromPlayer(player));
            player.addEventListener("onPlaybackQualityChange", () => refreshDesiredVideoFromPlayer(player));
            player.addEventListener("onPlaybackRateChange", () => refreshDesiredVideoFromPlayer(player));
        }

        const pollTimer = setInterval(() => {
            const iframe = typeof player.getIframe === "function" ? player.getIframe() : null;
            if (!iframe || !document.body.contains(iframe)) {
                clearInterval(pollTimer);
                return;
            }
            syncAdState();
        }, 400);

        const originalDestroy = player.destroy;
        if (typeof originalDestroy === "function") {
            player.destroy = function patchedDestroy() {
                clearInterval(pollTimer);
                return originalDestroy.apply(this, arguments);
            };
        }
    };

    const trackVideoRequests = (player, config = {}) => {
        const initialDescriptor = normalizeVideoDescriptor(
            config.videoId ||
            config.video_id ||
            config.playerVars?.videoId ||
            config.playerVars?.video_id ||
            config.video
        );
        if (initialDescriptor) {
            setDesiredVideoDescriptor(player, initialDescriptor);
        }

        const wrap = (method) => {
            const original = player[method];
            if (typeof original !== "function") return;
            player[method] = function wrappedVideoCommand(...args) {
                const descriptor = normalizeVideoDescriptor(args[0], typeof args[1] === "number" ? args[1] : 0);
                if (descriptor) {
                    setDesiredVideoDescriptor(player, descriptor);
                }
                return original.apply(this, args);
            };
        };

        ["loadVideoById", "cueVideoById", "loadPlaylist", "cuePlaylist"].forEach(wrap);
    };

    const patchYouTubePlayer = () => {
        if (!window.YT || !window.YT.Player || window.YT.Player.__ytAdBlockWrapped) {
            if (!moduleState.playerPatchTimer) {
                moduleState.playerPatchTimer = setTimeout(() => {
                    moduleState.playerPatchTimer = null;
                    patchYouTubePlayer();
                }, 500);
            }
            return;
        }

        moduleState.playerPatchTimer = null;
        const OriginalPlayer = window.YT.Player;
        const PatchedPlayer = function patchedPlayer(element, config = {}) {
            const mergedConfig = { ...config };
            mergedConfig.host = "https://www.youtube-nocookie.com";
            const forcedPlayerVars = {
                rel: 0,
                iv_load_policy: 3,
                modestbranding: 1,
                playsinline: 1,
                enablejsapi: 1,
                disablekb: 1,
                fs: 0,
                origin: window.location.origin,
                widget_referrer: window.location.origin,
                enablecastapi: 0,
                cc_load_policy: 0,
                hl: navigator.language || "en",
                host_language: navigator.language || "en",
                adformat: "0_0",
                allowfullscreen: 0,
                disable_polymer: 1,
                suppress_ads: 1,
                ads: 0
            };
            mergedConfig.playerVars = {
                ...config.playerVars,
                ...forcedPlayerVars
            };
            const forcedFeatureFlags = [
                "disable_persistent_ads=true",
                "kevlar_allow_multistep_video_ads=false",
                "enable_desktop_ad_controls=false",
                "html5_disable_ads=true",
                "disable_new_pause_state3_player_ads=true",
                "player_ads_enable_gcf=false",
                "web_player_disable_afa=true",
                "kevlar_miniplayer_play_pause_on_scrim=true",
                "preskip_button_style_ads_backend=false",
                "html5_player_enable_ads_client=false"
            ];
            mergedConfig.playerVars.fflags = mergeFeatureFlags(mergedConfig.playerVars.fflags, forcedFeatureFlags);
            mergedConfig.events = mergedConfig.events || {};
            const originalOnReady = mergedConfig.events.onReady;
            mergedConfig.events.onReady = (event) => {
                attachAdSkipper(event?.target);
                if (typeof originalOnReady === "function") {
                    originalOnReady(event);
                }
            };
            const originalOnStateChange = mergedConfig.events.onStateChange;
            mergedConfig.events.onStateChange = (event) => {
                attachAdSkipper(event?.target);
                if (typeof originalOnStateChange === "function") {
                    return originalOnStateChange(event);
                }
                return undefined;
            };

            const instance = new OriginalPlayer(element, mergedConfig);
            trackVideoRequests(instance, mergedConfig);
            attachAdSkipper(instance);
            return instance;
        };

        PatchedPlayer.prototype = OriginalPlayer.prototype;
        Object.setPrototypeOf(PatchedPlayer, OriginalPlayer);
        PatchedPlayer.__ytAdBlockWrapped = true;
        window.YT.Player = PatchedPlayer;
        registerRestore("youtube-player", () => {
            if (window.YT?.Player === PatchedPlayer) {
                window.YT.Player = OriginalPlayer;
            }
        });
    };

    const initialize = () => {
        if (moduleState.initialized) {
            return;
        }

        moduleState.initialized = true;
        patchJsonParse();
        patchResponsePrototypeJson();
        patchYouTubePlayerResponseGlobals();
        patchFetch();
        patchXHR();
        patchSendBeacon();
        patchScriptElements();
        patchLinkElements();
        patchImageElements();
        patchIframeSetter();
        patchWebSocket();
        patchEventSource();
        patchWorkers();
        patchDocumentCreateElement();
        patchServiceWorkers();
        patchWindowOpen();
        patchTimerNeutralization();
        observeIframes();
        patchYouTubePlayer();
        window.__ivLyricsDebugLog?.(`${logPrefix} initialized`);
    };

    waitForSpicetify();
})();
