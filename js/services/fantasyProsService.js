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
    _cacheTimestamp: null,

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
            rank: typeof p.rank_ecr === 'number' ? p.rank_ecr : (parseInt(p.rank_ecr, 10) || -1)
        };
    },

    /**
     * Loads Weekly consensus rankings for all positions in parallel for a given scoring format (STD, HALF, PPR).
     * Checks in-memory cache, then browser localStorage (2hr TTL), then fetches live from FantasyPros via JSONP.
     */
    async fetchRankings(scoring = 'STD', forceRefresh = false) {
        if (!forceRefresh && this._cache[scoring]) {
            return this._cache[scoring];
        }

        const storageKey = 'ff_rankings_' + scoring;
        const TTL = 2 * 60 * 60 * 1000; // 2 hours

        // Check browser localStorage cache
        if (!forceRefresh) {
            try {
                if (typeof localStorage !== 'undefined') {
                    const raw = localStorage.getItem(storageKey);
                    if (raw) {
                        const cached = JSON.parse(raw);
                        if (cached && cached.timestamp && (Date.now() - cached.timestamp < TTL) && cached.rankingsByPos) {
                            this._cache[scoring] = cached.rankingsByPos;
                            if (cached.week) this._lastWeek = cached.week;
                            this._cacheTimestamp = cached.timestamp;
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
                        return this._fetchLocalWeekly(scoring, pos);
                    });
            });

            const results = await Promise.all(fetchPromises);
            const rankingsByPos = {};
            for (const item of results) {
                rankingsByPos[item.pos] = item.players;
            }

            this._cache[scoring] = rankingsByPos;
            this._cacheTimestamp = Date.now();

            // Store in browser localStorage
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(storageKey, JSON.stringify({
                        timestamp: this._cacheTimestamp,
                        week: targetWeek,
                        rankingsByPos
                    }));
                }
            } catch (e) {}

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
        if (!forceRefresh && this._rosCache[scoring]) {
            return this._rosCache[scoring];
        }

        const storageKey = 'ff_ros_rankings_' + scoring;
        const TTL = 2 * 60 * 60 * 1000; // 2 hours

        // Check browser localStorage cache
        if (!forceRefresh) {
            try {
                if (typeof localStorage !== 'undefined') {
                    const raw = localStorage.getItem(storageKey);
                    if (raw) {
                        const cached = JSON.parse(raw);
                        if (cached && cached.timestamp && (Date.now() - cached.timestamp < TTL) && cached.rosByPos) {
                            this._rosCache[scoring] = cached.rosByPos;
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
                        return this._fetchLocalRos(scoring, pos);
                    });
            });

            const results = await Promise.all(fetchPromises);
            const rosByPos = {};
            for (const item of results) {
                rosByPos[item.pos] = item.players;
            }

            this._rosCache[scoring] = rosByPos;

            // Store in browser localStorage
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(storageKey, JSON.stringify({
                        timestamp: Date.now(),
                        rosByPos
                    }));
                }
            } catch (e) {}

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
        this._cache[scoring] = rankingsByPos;
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
        this._rosCache[scoring] = rosByPos;
        return rosByPos;
    },

    /**
     * Fetches metadata including current active NFL week and cache age.
     */
    async fetchMetadata() {
        if (this._metadata) {
            return this._metadata;
        }

        try {
            const state = await this.getNflState();
            let minutesAgo = 0;

            if (this._cacheTimestamp) {
                minutesAgo = Math.max(0, Math.floor((Date.now() - this._cacheTimestamp) / 1000 / 60));
            } else if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem('ff_rankings_PPR') || localStorage.getItem('ff_rankings_STD');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && parsed.timestamp) {
                        minutesAgo = Math.max(0, Math.floor((Date.now() - parsed.timestamp) / 1000 / 60));
                    }
                }
            }

            this._metadata = {
                week: String(this._lastWeek || state.week),
                year: state.year,
                minutesAgo: isNaN(minutesAgo) ? 0 : minutesAgo
            };
            return this._metadata;
        } catch (e) {}

        // Fallback to local lastUpdatedAt.json if available
        try {
            if (typeof axios !== 'undefined') {
                const res = await axios.get('data/lastUpdatedAt.json');
                const data = res.data;
                const updatedDate = new Date(data.date);
                const minutesAgo = Math.max(0, Math.floor((new Date() - updatedDate) / 1000 / 60));

                this._metadata = {
                    week: data.week,
                    date: data.date,
                    minutesAgo: isNaN(minutesAgo) ? 0 : minutesAgo
                };
                return this._metadata;
            }
        } catch (err) {}

        return { week: '1', date: '', minutesAgo: 0 };
    },

    /**
     * Clears all memory and localStorage cached rankings to force a fresh re-fetch.
     */
    clearCache() {
        this._cache = {};
        this._rosCache = {};
        this._metadata = null;
        this._cacheTimestamp = null;
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
