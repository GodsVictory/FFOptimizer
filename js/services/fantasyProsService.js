/**
 * FantasyProsService: Fetches consensus rankings directly from FantasyPros via JSONP,
 * caches them in browser storage (localStorage) and memory, and provides graceful offline fallback.
 */

const FantasyProsService = {
    // In-memory cache for loaded scoring data (STD, HALF, PPR)
    _cache: {},
    _rosCache: {},
    _metadata: null,
    _nflState: null,
    _lastWeek: null,
    _requestedWeek: null,
    _cacheTimestamp: null,
    _cacheTimes: {},      // scoring -> time the in-memory weekly entry was stored
    _rosCacheTimes: {},   // scoring -> time the in-memory ROS entry was stored
    _usingFallback: false, // true when rankings came from bundled data/ files instead of live FantasyPros
    _fallbackDate: null,

    CACHE_TTL: 2 * 60 * 60 * 1000,   // 2 hours for complete live data
    PARTIAL_TTL: 5 * 60 * 1000,      // retry soon when any position failed or fell back to bundled data

    _isFresh(times, scoring, data) {
        if (!data) return false;
        const t = times[scoring];
        if (!t) return false;
        const ttl = (data.__partial ? this.PARTIAL_TTL : this.CACHE_TTL);
        return Date.now() - t < ttl;
    },

    /**
     * Executes a JSONP request that bypasses browser CORS restrictions.
     * In Node.js (CLI / tests), it performs a direct HTTPS GET and parses the JSONP wrapper.
     */
    jsonp(url, timeout = 12000) {
        // Node.js environment fallback for CLI and unit tests
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            const https = require('https');
            const cleanUrl = url + (url.includes('?') ? '&' : '?') + 'callback=node_cb';
            return new Promise((resolve, reject) => {
                const req = https.get(cleanUrl, { timeout }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        const match = data.match(/^[a-zA-Z0-9_]+\(([\s\S]*)\);?$/);
                        if (!match) return reject(new Error('Invalid JSONP response'));
                        try {
                            resolve(JSON.parse(match[1]));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                req.on('error', reject);
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('JSONP request timed out'));
                });
            });
        }

        // Browser environment: dynamic <script> tag injection
        return new Promise((resolve, reject) => {
            const callbackName = 'fp_cb_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
            const script = document.createElement('script');
            const cleanUrl = url + (url.includes('?') ? '&' : '?') + 'callback=' + callbackName;

            let timer = setTimeout(() => {
                cleanup();
                reject(new Error('FantasyPros JSONP request timed out for ' + url));
            }, timeout);

            function cleanup() {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                if (script.parentNode) {
                    script.parentNode.removeChild(script);
                }
                delete window[callbackName];
            }

            window[callbackName] = (data) => {
                cleanup();
                resolve(data);
            };

            script.onerror = (err) => {
                cleanup();
                reject(new Error('FantasyPros JSONP script error for ' + url));
            };

            script.src = cleanUrl;
            document.head.appendChild(script);
        });
    },

    /**
     * Determines the active NFL week and season year from Sleeper's open CORS state API.
     */
    async getNflState() {
        if (this._nflState) return this._nflState;

        try {
            let res;
            if (typeof axios !== 'undefined') {
                res = await axios.get('https://api.sleeper.app/v1/state/nfl', { timeout: 8000 });
            } else {
                const https = require('https');
                res = await new Promise((resolve, reject) => {
                    https.get('https://api.sleeper.app/v1/state/nfl', (r) => {
                        let data = '';
                        r.on('data', c => data += c);
                        r.on('end', () => resolve({ data: JSON.parse(data) }));
                    }).on('error', reject);
                });
            }

            if (res && res.data) {
                const week = res.data.display_week || res.data.week;
                const season = res.data.season;
                if (week && season) {
                    this._nflState = { week: parseInt(week, 10), year: String(season) };
                    return this._nflState;
                }
            }
        } catch (e) {
            console.warn('Could not retrieve Sleeper NFL state, estimating week/year:', e);
        }

        // Calendar estimation fallback matching getFPData.py
        const today = new Date();
        const startOfYear = new Date(today.getFullYear(), 0, 1);
        const weekNum = Math.ceil((((today - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
        let week = weekNum - 35;
        if (week < 1) week = 1;
        if (week > 18) week = 18;
        const year = String(today.getFullYear());

        this._nflState = { week, year };
        return this._nflState;
    },

    /**
     * Normalizes a raw FantasyPros player object into standard app format.
     */
    transformPlayer(p, pos) {
        const playerId = (pos === 'DST') ? p.player_team_id : p.sportsdata_id;
        return {
            name: p.player_name || '',
            position: p.player_position_id || pos,
            id: playerId || false,
            rank: typeof p.rank_ecr === 'number' ? p.rank_ecr : (parseInt(p.rank_ecr, 10) || -1),
            minRank: p.rank_min ? parseInt(p.rank_min, 10) : null,
            maxRank: p.rank_max ? parseInt(p.rank_max, 10) : null,
            stdDev: p.rank_std ? parseFloat(p.rank_std) : null,
            pts: p.r2p_pts ? parseFloat(p.r2p_pts) : null,
            team: p.player_team_id || '',
            opp: p.player_opponent || ''
        };
    },

    /**
     * Loads Weekly consensus rankings for all positions in parallel for a given scoring format (STD, HALF, PPR).
     * Checks in-memory cache, then browser localStorage (2hr TTL), then fetches live from FantasyPros via JSONP.
     */
    async fetchRankings(scoring = 'STD', forceRefresh = false) {
        if (!forceRefresh && this._isFresh(this._cacheTimes, scoring, this._cache[scoring])) {
            return this._cache[scoring];
        }

        const storageKey = 'ff_rankings_' + scoring;
        const TTL = this.CACHE_TTL;

        // Check browser localStorage cache
        if (!forceRefresh) {
            try {
                if (typeof localStorage !== 'undefined') {
                    const raw = localStorage.getItem(storageKey);
                    if (raw) {
                        const cached = JSON.parse(raw);
                        if (cached && cached.timestamp && (Date.now() - cached.timestamp < TTL) && cached.rankingsByPos) {
                            this._cache[scoring] = cached.rankingsByPos;
                            this._cacheTimes[scoring] = cached.timestamp;
                            if (cached.week) this._lastWeek = cached.week;
                            this._requestedWeek = cached.requestedWeek || cached.week || null;
                            this._usingFallback = false;
                            this._cacheTimestamp = cached.timestamp;
                            this._metadata = null;
                            return cached.rankingsByPos;
                        }
                    }
                }
            } catch (e) {
                console.warn('Error reading rankings from localStorage:', e);
            }
        }

        const positions = (typeof CONFIG !== 'undefined' && CONFIG.POSITIONS) 
            ? CONFIG.POSITIONS 
            : ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST'];

        // Attempt live JSONP fetch directly from FantasyPros
        try {
            const { week, year } = await this.getNflState();
            let targetWeek = week;
            this._requestedWeek = week;

            // Probe QB first to verify if targetWeek rankings are published
            const probeUrl = `https://partners.fantasypros.com/api/v1/consensus-rankings.php?sport=NFL&year=${year}&week=${targetWeek}&scoring=${scoring}&export=json&position=QB`;
            const probeData = await this.jsonp(probeUrl, 10000);
            if ((!probeData.players || probeData.players.length === 0) && targetWeek > 1) {
                targetWeek = targetWeek - 1; // Fallback to previous week with published rankings
            }

            this._lastWeek = targetWeek;

            // Fetch all 7 positions simultaneously in parallel
            const fetchPromises = positions.map(pos => {
                const url = `https://partners.fantasypros.com/api/v1/consensus-rankings.php?sport=NFL&year=${year}&week=${targetWeek}&scoring=${scoring}&export=json&position=${pos}`;
                return this.jsonp(url, 12000)
                    .then(data => ({
                        pos,
                        players: (data.players || []).map(p => this.transformPlayer(p, pos))
                    }))
                    .catch(err => {
                        console.warn(`JSONP failed for ${pos}, attempting local fallback:`, err);
                        return this._fetchLocalWeekly(scoring, pos).then(r => ({ ...r, fallback: true }));
                    });
            });

            const results = await Promise.all(fetchPromises);
            const rankingsByPos = {};
            let partial = false;
            for (const item of results) {
                rankingsByPos[item.pos] = item.players;
                if (item.fallback || !item.players || item.players.length === 0) partial = true;
            }
            if (partial) {
                // Non-enumerable so it never ends up in JSON / Object.entries iteration
                Object.defineProperty(rankingsByPos, '__partial', { value: true, enumerable: false });
            }

            this._cache[scoring] = rankingsByPos;
            this._cacheTimes[scoring] = Date.now();
            this._cacheTimestamp = Date.now();
            this._usingFallback = false;
            this._metadata = null;

            // Store in browser localStorage, but only complete live results so failures aren't pinned for 2 hours
            if (!partial) {
                try {
                    if (typeof localStorage !== 'undefined') {
                        localStorage.setItem(storageKey, JSON.stringify({
                            timestamp: this._cacheTimestamp,
                            week: targetWeek,
                            requestedWeek: week,
                            rankingsByPos
                        }));
                    }
                } catch (e) {}
            }

            return rankingsByPos;
        } catch (err) {
            console.warn('Live FantasyPros fetch failed, falling back to local files:', err);
            return this._fetchLocalAllWeekly(scoring, positions);
        }
    },

    /**
     * Loads Rest of Season (ROS) consensus rankings for all positions in parallel.
     * Checks in-memory cache, then browser localStorage (2hr TTL), then fetches live from FantasyPros via JSONP.
     */
    async fetchRosRankings(scoring = 'STD', forceRefresh = false) {
        if (!forceRefresh && this._isFresh(this._rosCacheTimes, scoring, this._rosCache[scoring])) {
            return this._rosCache[scoring];
        }

        const storageKey = 'ff_ros_rankings_' + scoring;
        const TTL = this.CACHE_TTL;

        // Check browser localStorage cache
        if (!forceRefresh) {
            try {
                if (typeof localStorage !== 'undefined') {
                    const raw = localStorage.getItem(storageKey);
                    if (raw) {
                        const cached = JSON.parse(raw);
                        if (cached && cached.timestamp && (Date.now() - cached.timestamp < TTL) && cached.rosByPos) {
                            this._rosCache[scoring] = cached.rosByPos;
                            this._rosCacheTimes[scoring] = cached.timestamp;
                            return cached.rosByPos;
                        }
                    }
                }
            } catch (e) {
                console.warn('Error reading ROS rankings from localStorage:', e);
            }
        }

        const positions = (typeof CONFIG !== 'undefined' && CONFIG.POSITIONS) 
            ? CONFIG.POSITIONS 
            : ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST'];

        // Attempt live JSONP fetch directly from FantasyPros
        try {
            const { year } = await this.getNflState();

            // Fetch all 7 ROS positions simultaneously in parallel
            const fetchPromises = positions.map(pos => {
                const url = `https://partners.fantasypros.com/api/v1/consensus-rankings.php?sport=NFL&year=${year}&type=ROS&scoring=${scoring}&export=json&position=${pos}`;
                return this.jsonp(url, 12000)
                    .then(data => ({
                        pos,
                        players: (data.players || []).map(p => this.transformPlayer(p, pos))
                    }))
                    .catch(err => {
                        console.warn(`JSONP ROS failed for ${pos}, attempting local fallback:`, err);
                        return this._fetchLocalRos(scoring, pos).then(r => ({ ...r, fallback: true }));
                    });
            });

            const results = await Promise.all(fetchPromises);
            const rosByPos = {};
            let partial = false;
            for (const item of results) {
                rosByPos[item.pos] = item.players;
                if (item.fallback || !item.players || item.players.length === 0) partial = true;
            }
            if (partial) {
                Object.defineProperty(rosByPos, '__partial', { value: true, enumerable: false });
            }

            this._rosCache[scoring] = rosByPos;
            this._rosCacheTimes[scoring] = Date.now();
            this._metadata = null;

            if (!partial) {
                try {
                    if (typeof localStorage !== 'undefined') {
                        localStorage.setItem(storageKey, JSON.stringify({
                            timestamp: Date.now(),
                            rosByPos
                        }));
                    }
                } catch (e) {}
            }

            return rosByPos;
        } catch (err) {
            console.warn('Live FantasyPros ROS fetch failed, falling back to local files:', err);
            return this._fetchLocalAllRos(scoring, positions);
        }
    },

    // --- Offline Local Fallbacks ---
    async _fetchLocalWeekly(scoring, pos) {
        try {
            if (typeof axios !== 'undefined') {
                const res = await axios.get(`data/${scoring}-${pos}.json`);
                return { pos, players: res.data || [] };
            }
        } catch (e) {}
        return { pos, players: [] };
    },

    async _fetchLocalAllWeekly(scoring, positions) {
        const fetchPromises = positions.map(pos => this._fetchLocalWeekly(scoring, pos));
        const results = await Promise.all(fetchPromises);
        const rankingsByPos = {};
        for (const item of results) {
            rankingsByPos[item.pos] = item.players;
        }
        if (results.every(r => !r.players || r.players.length === 0)) {
            throw new Error('Could not load rankings from FantasyPros, and no offline rankings are available. Please try again shortly.');
        }

        Object.defineProperty(rankingsByPos, '__partial', { value: true, enumerable: false });
        this._cache[scoring] = rankingsByPos;
        this._cacheTimes[scoring] = Date.now();
        this._usingFallback = true;
        this._metadata = null;

        // Report the week the bundled files were generated for, not the live NFL week
        try {
            if (typeof axios !== 'undefined') {
                const res = await axios.get('data/lastUpdatedAt.json');
                if (res.data) {
                    if (res.data.week) {
                        this._lastWeek = parseInt(res.data.week, 10) || this._lastWeek;
                        this._requestedWeek = this._lastWeek;
                    }
                    this._fallbackDate = res.data.date || null;
                }
            }
        } catch (e) {}

        return rankingsByPos;
    },

    async _fetchLocalRos(scoring, pos) {
        try {
            if (typeof axios !== 'undefined') {
                const res = await axios.get(`data/ROS-${scoring}-${pos}.json`);
                return { pos, players: res.data || [] };
            }
        } catch (e) {}
        return { pos, players: [] };
    },

    async _fetchLocalAllRos(scoring, positions) {
        const fetchPromises = positions.map(pos => this._fetchLocalRos(scoring, pos));
        const results = await Promise.all(fetchPromises);
        const rosByPos = {};
        for (const item of results) {
            rosByPos[item.pos] = item.players;
        }
        Object.defineProperty(rosByPos, '__partial', { value: true, enumerable: false });
        this._rosCache[scoring] = rosByPos;
        this._rosCacheTimes[scoring] = Date.now();
        return rosByPos;
    },

    /**
     * Fetches metadata including current active NFL week and cache age.
     * @param {string} scoring Scoring format ('PPR', 'HALF', 'STD')
     * @param {boolean} force Force recalculate without using cached metadata
     */
    async fetchMetadata(scoring = 'PPR', force = false) {
        if (force) {
            this._metadata = null;
        }

        let week = this._lastWeek;
        let year = '';

        if (!this._nflState) {
            try {
                this._nflState = await this.getNflState();
            } catch (e) {}
        }
        if (this._nflState) {
            if (!week) week = this._nflState.week;
            year = this._nflState.year;
        }

        const TTL = 2 * 60 * 60 * 1000; // 2 hours
        let timestamp = this._cacheTimestamp;

        // If in-memory timestamp is not set yet, check browser localStorage
        if (!timestamp && typeof localStorage !== 'undefined') {
            const keysToCheck = [
                'ff_rankings_' + scoring,
                'ff_rankings_PPR',
                'ff_rankings_HALF',
                'ff_rankings_STD'
            ];
            for (const k of keysToCheck) {
                const raw = localStorage.getItem(k);
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (parsed && parsed.timestamp) {
                            // Only use timestamp if within 2-hour TTL
                            if (Date.now() - parsed.timestamp < TTL) {
                                timestamp = parsed.timestamp;
                                if (parsed.week && !this._lastWeek) week = parsed.week;
                                break;
                            }
                        }
                    } catch (e) {}
                }
            }
        }

        let minutesAgo = 0;
        if (timestamp) {
            minutesAgo = Math.max(0, Math.floor((Date.now() - timestamp) / 1000 / 60));
        }

        const currentWeek = this._nflState ? this._nflState.week : null;
        this._metadata = {
            week: String(week || '1'),
            year: year || String(new Date().getFullYear()),
            minutesAgo: isNaN(minutesAgo) ? 0 : minutesAgo,
            // Rankings for the current week weren't published yet, so the previous week's are shown
            isPreviousWeek: !!(week && currentWeek && parseInt(week, 10) < currentWeek),
            currentWeek: currentWeek ? String(currentWeek) : '',
            isFallback: this._usingFallback,
            fallbackDate: this._fallbackDate
        };
        return this._metadata;
    },

    /**
     * Clears all memory and localStorage cached rankings to force a fresh re-fetch.
     */
    clearCache() {
        this._cache = {};
        this._rosCache = {};
        this._metadata = null;
        this._nflState = null;
        this._lastWeek = null;
        this._requestedWeek = null;
        this._cacheTimestamp = null;
        this._cacheTimes = {};
        this._rosCacheTimes = {};
        this._usingFallback = false;
        this._fallbackDate = null;
        try {
            if (typeof localStorage !== 'undefined') {
                for (const s of ['STD', 'HALF', 'PPR']) {
                    localStorage.removeItem('ff_rankings_' + s);
                    localStorage.removeItem('ff_ros_rankings_' + s);
                }
            }
        } catch (e) {}
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FantasyProsService;
}
