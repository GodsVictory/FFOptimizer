/**
 * FF Optimizer - Main Vue Application
 */

var app = new Vue({
    el: '#app',
    data() {
        return {
            platform: 'Sleeper',
            scoring: 'STD',
            flex: 'WRT',

            // League inputs
            sleeperLeagueId: '',
            espnLeagueId: '',
            yahooLeagueId: '',
            yahooAccessToken: '',
            yahooProxyUrl: '',
            yahooRosterText: '',
            yahooMode: 'paste', // 'paste' or 'api'
            showYahooHelp: false,

            // Data state
            ownerId: '',
            pendingOwnerId: '',
            owners: [],
            leagueName: '',
            startingSlots: [],
            rosteredPlayers: [],
            allRankedPlayers: [],
            optimalLineup: [],
            fullBench: [],
            benchAlerts: [],
            positionColumns: {},
            rosPositionColumns: {},
            allRosRankedPlayers: [],

            // UI state
            ready: false,
            lineupReady: false,
            loading: false,
            errorMessage: '',
            week: '',
            lastUpdatedAt: '',
            lastPlatform: '',
            leagueHistory: [],

            // Matrix Chart state
            matrixPos: 'ALL',
            matrixXMode: 'rank', // 'rank' or 'pts'
            matrixHoverPlayer: null,
            matrixTooltipPos: { left: '0px', top: '0px' },
            showMatrixChart: true
        };
    },

    computed: {
        benchPlayers() {
            return (this.fullBench || []).filter(p => p.highlight !== 'drop');
        },
        dropPlayers() {
            return (this.fullBench || []).filter(p => p.highlight === 'drop');
        },
        matrixChartData() {
            if (!this.lineupReady || !this.ownerId) return null;

            const currentPos = this.matrixPos;
            const isRankMode = this.matrixXMode === 'rank';

            // 1. Gather all candidates
            const starters = (this.optimalLineup || []).filter(p => p.name && p.name !== '(Empty Slot)');
            const bench = this.benchPlayers || [];
            const drops = this.dropPlayers || [];
            const pickups = starters.filter(p => p.highlight === 'pickup');

            // Free agents from this.allRankedPlayers
            const matcher = (typeof PlayerMatcher !== 'undefined') ? PlayerMatcher : null;
            const normFn = name => matcher ? matcher.normalizeName(name) : (name || '').toLowerCase().trim();

            const pickupNames = new Set(pickups.map(p => normFn(p.name)));
            const allFreeAgents = (this.allRankedPlayers || []).filter(p => 
                p.onRoster === 0 && 
                p.rank > 0 && 
                !pickupNames.has(normFn(p.name))
            );

            let selectedFreeAgents = [];
            if (currentPos === 'ALL') {
                const positions = ['QB', 'RB', 'WR', 'TE', 'DST'];
                for (const pos of positions) {
                    const topForPos = allFreeAgents
                        .filter(p => p.position === pos)
                        .sort((a, b) => a.rank - b.rank)
                        .slice(0, 4);
                    selectedFreeAgents.push(...topForPos);
                }
            } else {
                selectedFreeAgents = allFreeAgents
                    .filter(p => p.position === currentPos)
                    .sort((a, b) => a.rank - b.rank)
                    .slice(0, 15);
            }

            const playerMap = new Map();

            const addPlayer = (p, status, extra = {}) => {
                if (!p || !p.name || p.name === '(Empty Slot)') return;
                const norm = normFn(p.name);
                
                const full = (this.allRankedPlayers || []).find(ap => normFn(ap.name) === norm) || p;
                const pos = full.position || p.position || p.slot;

                if (currentPos !== 'ALL' && pos !== currentPos) return;

                const weekRank = (pos === 'FLX' && full.flxRank > 0) 
                    ? full.flxRank 
                    : (full.rank > 0 ? full.rank : (p.rank > 0 ? p.rank : null));
                const rosRank = (full.rosRank > 0) 
                    ? full.rosRank 
                    : (pos === 'FLX' && full.rosFlxRank > 0 ? full.rosFlxRank : null);

                if (!playerMap.has(norm)) {
                    playerMap.set(norm, {
                        id: full.id || p.id,
                        name: p.name || full.name,
                        pos: pos,
                        team: full.team || p.team || '',
                        opp: full.opp || p.opp || '',
                        weekRank: weekRank,
                        minRank: full.minRank != null ? full.minRank : (weekRank != null ? Math.max(1, weekRank - 3) : null),
                        maxRank: full.maxRank != null ? full.maxRank : (weekRank != null ? weekRank + 5 : null),
                        stdDev: full.stdDev != null ? full.stdDev : null,
                        pts: full.pts != null ? full.pts : null,
                        rosRank: rosRank,
                        status: status,
                        targetDrop: extra.targetDrop || p.targetDrop || null,
                        targetPickup: extra.targetPickup || p.targetPickup || null
                    });
                }
            };

            pickups.forEach(p => addPlayer(p, 'pickup', { targetDrop: p.targetDrop }));
            drops.forEach(p => addPlayer(p, 'drop', { targetPickup: p.targetPickup }));
            starters.filter(p => p.highlight !== 'pickup').forEach(p => addPlayer(p, 'roster'));
            bench.forEach(p => addPlayer(p, 'roster'));
            selectedFreeAgents.forEach(p => addPlayer(p, 'wire'));

            const rawList = Array.from(playerMap.values());
            if (rawList.length === 0) return null;

            const width = 800;
            const height = 500;
            const margin = { top: 40, right: 45, bottom: 50, left: 65 };
            const plotWidth = width - margin.left - margin.right;
            const plotHeight = height - margin.top - margin.bottom;

            const minRank = 1;
            let maxRank = 50;
            if (currentPos === 'QB' || currentPos === 'DST' || currentPos === 'K' || currentPos === 'TE') {
                maxRank = 32;
            } else if (currentPos === 'ALL') {
                maxRank = 50;
            }

            let minPts = 4.0;
            let maxPts = 24.0;
            if (currentPos === 'QB') {
                minPts = 10.0;
                maxPts = 28.0;
            } else if (currentPos === 'DST' || currentPos === 'K') {
                minPts = 3.0;
                maxPts = 14.0;
            }

            const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

            const xScale = val => {
                if (isRankMode) {
                    const safe = clamp(val != null && val > 0 ? val : maxRank, minRank, maxRank);
                    return margin.left + ((maxRank - safe) / (maxRank - minRank)) * plotWidth;
                } else {
                    const safe = clamp(val != null ? val : minPts, minPts, maxPts);
                    return margin.left + ((safe - minPts) / (maxPts - minPts)) * plotWidth;
                }
            };

            const yScale = ros => {
                const safe = clamp(ros != null && ros > 0 ? ros : maxRank, minRank, maxRank);
                return margin.top + ((safe - minRank) / (maxRank - minRank)) * plotHeight;
            };

            const midX = margin.left + plotWidth / 2;
            const midY = margin.top + plotHeight / 2;

            const plottedPlayers = rawList.map(p => {
                let displayPts = p.pts;
                if (displayPts == null && p.weekRank) {
                    if (p.pos === 'QB') displayPts = Math.max(10, +(26 - p.weekRank * 0.45).toFixed(1));
                    else if (p.pos === 'DST' || p.pos === 'K') displayPts = Math.max(3, +(12 - p.weekRank * 0.28).toFixed(1));
                    else displayPts = Math.max(4, +(22 - p.weekRank * 0.35).toFixed(1));
                }

                const cx = xScale(isRankMode ? p.weekRank : displayPts);
                const effRos = p.rosRank != null && p.rosRank > 0 ? p.rosRank : (p.weekRank != null ? p.weekRank : maxRank);
                const cy = yScale(effRos);

                let dotColor = '#94a3b8';
                let strokeColor = '#64748b';
                let radius = 5.5;

                if (p.status === 'pickup') {
                    dotColor = '#10b981';
                    strokeColor = '#059669';
                    radius = 8;
                } else if (p.status === 'drop') {
                    dotColor = '#f43f5e';
                    strokeColor = '#e11d48';
                    radius = 7.5;
                } else if (p.status === 'roster') {
                    dotColor = '#3b82f6';
                    strokeColor = '#2563eb';
                    radius = 6.5;
                }

                let whisker = null;
                if (isRankMode && p.minRank && p.maxRank) {
                    const xMin = xScale(p.minRank);
                    const xMax = xScale(p.maxRank);
                    whisker = {
                        x1: Math.min(xMin, xMax),
                        x2: Math.max(xMin, xMax),
                        y: cy,
                        strokeColor: strokeColor,
                        opacity: (p.status === 'pickup' || p.status === 'drop') ? 0.9 : 0.45
                    };
                }

                let label = null;
                if (p.status === 'pickup' || p.status === 'drop' || (p.status === 'roster' && (p.weekRank <= 3 || p.rosRank <= 3))) {
                    const lastName = p.name.split(' ').pop();
                    const isPickup = (p.status === 'pickup');
                    label = {
                        text: lastName,
                        x: cx + (isPickup ? 11 : -11),
                        y: cy + 4,
                        anchor: isPickup ? 'start' : 'end',
                        color: isPickup ? '#059669' : (p.status === 'drop' ? '#e11d48' : '#2563eb')
                    };
                }

                return {
                    ...p,
                    displayPts: displayPts,
                    effRos: effRos,
                    cx: cx,
                    cy: cy,
                    dotColor: dotColor,
                    strokeColor: strokeColor,
                    radius: radius,
                    whisker: whisker,
                    label: label
                };
            });

            const upgradeVectors = [];
            plottedPlayers.filter(p => p.status === 'pickup' && p.targetDrop).forEach(pk => {
                const dropPlayer = plottedPlayers.find(p => p.name === pk.targetDrop);
                if (dropPlayer) {
                    upgradeVectors.push({
                        x1: dropPlayer.cx,
                        y1: dropPlayer.cy,
                        x2: pk.cx,
                        y2: pk.cy,
                        dropName: dropPlayer.name,
                        pickupName: pk.name
                    });
                }
            });
            plottedPlayers.filter(p => p.status === 'drop' && p.targetPickup && !upgradeVectors.some(v => v.dropName === p.name)).forEach(dp => {
                const pkPlayer = plottedPlayers.find(p => p.name === dp.targetPickup);
                if (pkPlayer) {
                    upgradeVectors.push({
                        x1: dp.cx,
                        y1: dp.cy,
                        x2: pkPlayer.cx,
                        y2: pkPlayer.cy,
                        dropName: dp.name,
                        pickupName: pkPlayer.name
                    });
                }
            });

            return {
                width,
                height,
                margin,
                plotWidth,
                plotHeight,
                midX,
                midY,
                minRank,
                maxRank,
                minPts,
                maxPts,
                isRankMode,
                players: plottedPlayers,
                upgradeVectors: upgradeVectors
            };
        }
    },

    async mounted() {
        this.loadPreferences();
        this.loadQueryParams();
        this.loadHistory();

        try {
            const meta = await FantasyProsService.fetchMetadata(this.scoring);
            this.week = meta.week;
            this.lastUpdatedAt = meta.minutesAgo;
        } catch (e) {
            console.warn('Could not load metadata on mount:', e);
        }

        // Auto-refresh and optimize if league input is present
        const hasLeagueInput = (this.platform === 'Sleeper' && this.sleeperLeagueId) ||
                               (this.platform === 'ESPN' && this.espnLeagueId) ||
                               (this.platform === 'Yahoo' && (this.yahooLeagueId || this.yahooRosterText));

        if (hasLeagueInput) {
            await this.refresh();
        }
    },

    methods: {
        loadQueryParams() {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                if (!urlParams.toString()) return false;

                if (urlParams.has('platform')) {
                    const p = urlParams.get('platform');
                    if (['Sleeper', 'ESPN', 'Yahoo'].includes(p)) {
                        this.platform = p;
                    }
                }
                if (urlParams.has('scoring')) {
                    const s = urlParams.get('scoring').toUpperCase();
                    if (['STD', 'HALF', 'PPR'].includes(s)) {
                        this.scoring = s;
                    }
                }
                if (urlParams.has('flex')) {
                    const f = urlParams.get('flex').toUpperCase();
                    if (['WRT', 'WR'].includes(f)) {
                        this.flex = f;
                    }
                }
                if (urlParams.has('leagueId')) {
                    const lid = urlParams.get('leagueId').trim();
                    if (this.platform === 'Sleeper') this.sleeperLeagueId = lid;
                    else if (this.platform === 'ESPN') this.espnLeagueId = lid;
                    else if (this.platform === 'Yahoo') this.yahooLeagueId = lid;
                }
                if (urlParams.has('sleeperLeagueId')) this.sleeperLeagueId = urlParams.get('sleeperLeagueId').trim();
                if (urlParams.has('espnLeagueId')) this.espnLeagueId = urlParams.get('espnLeagueId').trim();
                if (urlParams.has('yahooLeagueId')) this.yahooLeagueId = urlParams.get('yahooLeagueId').trim();
                if (urlParams.has('yahooMode')) this.yahooMode = urlParams.get('yahooMode');
                if (urlParams.has('owner')) {
                    this.pendingOwnerId = urlParams.get('owner');
                }
                return true;
            } catch (e) {
                return false;
            }
        },

        updateQueryParams() {
            try {
                const params = new URLSearchParams();
                if (this.platform) params.set('platform', this.platform);
                if (this.scoring) params.set('scoring', this.scoring);
                if (this.flex) params.set('flex', this.flex);

                let currentLeagueId = '';
                if (this.platform === 'Sleeper') currentLeagueId = this.sleeperLeagueId;
                else if (this.platform === 'ESPN') currentLeagueId = this.espnLeagueId;
                else if (this.platform === 'Yahoo') currentLeagueId = this.yahooLeagueId;

                if (currentLeagueId) {
                    params.set('leagueId', currentLeagueId);
                }
                if (this.ownerId) {
                    params.set('owner', this.ownerId);
                }
                if (this.platform === 'Yahoo' && this.yahooMode) {
                    params.set('yahooMode', this.yahooMode);
                }

                const queryString = params.toString();
                const newRelativePathQuery = window.location.pathname + (queryString ? '?' + queryString : '');
                window.history.replaceState(null, '', newRelativePathQuery);
            } catch (e) {}
        },

        getSavedOwnerForLeague(platform, leagueId) {
            if (!platform || !leagueId) return '';
            try {
                const direct = localStorage.getItem(`ff_owner_${platform}_${leagueId}`);
                if (direct) return direct;

                if (this.leagueHistory && this.leagueHistory.length > 0) {
                    const found = this.leagueHistory.find(h => 
                        h.platform === platform && 
                        String(h.leagueId) === String(leagueId) && 
                        h.owner
                    );
                    if (found) return String(found.owner);
                }
            } catch (e) {}
            return '';
        },

        saveOwnerForLeague(platform, leagueId, ownerId) {
            if (!platform || !leagueId || !ownerId) return;
            try {
                localStorage.setItem(`ff_owner_${platform}_${leagueId}`, String(ownerId));
            } catch (e) {}
        },

        loadPreferences() {
            try {
                const savedPlatform = localStorage.getItem('ff_platform');
                if (savedPlatform) this.platform = savedPlatform;

                const savedScoring = localStorage.getItem('ff_scoring');
                if (savedScoring) this.scoring = savedScoring;

                const savedFlex = localStorage.getItem('ff_flex');
                if (savedFlex) this.flex = savedFlex;

                const savedSleeperId = localStorage.getItem('ff_sleeper_league_id');
                if (savedSleeperId) this.sleeperLeagueId = savedSleeperId;

                const savedEspnId = localStorage.getItem('ff_espn_league_id');
                if (savedEspnId) this.espnLeagueId = savedEspnId;

                const savedYahooId = localStorage.getItem('ff_yahoo_league_id');
                if (savedYahooId) this.yahooLeagueId = savedYahooId;

                const savedYahooMode = localStorage.getItem('ff_yahoo_mode');
                if (savedYahooMode) this.yahooMode = savedYahooMode;

                // Determine active league ID for restored platform and restore saved owner
                let currentLeagueId = '';
                if (this.platform === 'Sleeper') currentLeagueId = (this.sleeperLeagueId || '').trim();
                else if (this.platform === 'ESPN') currentLeagueId = (this.espnLeagueId || '').trim();
                else if (this.platform === 'Yahoo') currentLeagueId = (this.yahooLeagueId || '').trim();

                const savedOwner = this.getSavedOwnerForLeague(this.platform, currentLeagueId);
                if (savedOwner) {
                    this.pendingOwnerId = savedOwner;
                    this.ownerId = savedOwner;
                }
            } catch (e) {
                // Ignore localStorage errors (e.g. incognito mode)
            }
        },

        savePreferences() {
            try {
                localStorage.setItem('ff_platform', this.platform);
                localStorage.setItem('ff_scoring', this.scoring);
                localStorage.setItem('ff_flex', this.flex);
                if (this.sleeperLeagueId) localStorage.setItem('ff_sleeper_league_id', this.sleeperLeagueId);
                if (this.espnLeagueId) localStorage.setItem('ff_espn_league_id', this.espnLeagueId);
                if (this.yahooLeagueId) localStorage.setItem('ff_yahoo_league_id', this.yahooLeagueId);
                if (this.yahooMode) localStorage.setItem('ff_yahoo_mode', this.yahooMode);

                let currentLeagueId = '';
                if (this.platform === 'Sleeper') currentLeagueId = (this.sleeperLeagueId || '').trim();
                else if (this.platform === 'ESPN') currentLeagueId = (this.espnLeagueId || '').trim();
                else if (this.platform === 'Yahoo') currentLeagueId = (this.yahooLeagueId || '').trim();

                if (currentLeagueId && this.ownerId) {
                    this.saveOwnerForLeague(this.platform, currentLeagueId, this.ownerId);
                }
            } catch (e) {}
        },

        onPlatformChange() {
            this.clear();
            this.savePreferences();
            this.updateQueryParams();
        },

        async onScoringOrFlexChange() {
            this.savePreferences();
            this.updateQueryParams();
            if (this.rosteredPlayers.length > 0 && this.ownerId) {
                this.loading = true;
                await this.applyRankings();
                this.optimize();
                this.loading = false;
            }
        },

        clear() {
            this.errorMessage = '';
            this.ready = false;
            this.lineupReady = false;
            this.rosteredPlayers = [];
            this.allRankedPlayers = [];
            this.optimalLineup = [];
            this.fullBench = [];
            this.benchAlerts = [];
            this.positionColumns = {};
            this.rosPositionColumns = {};
            this.allRosRankedPlayers = [];
            this.owners = [];
            this.ownerId = '';
            this.leagueName = '';
        },

        async refreshRankings() {
            this.loading = true;
            this.errorMessage = '';
            try {
                FantasyProsService.clearCache();
                if (this.rosteredPlayers.length > 0) {
                    await this.applyRankings();
                    if (this.ownerId) {
                        this.optimize();
                    }
                }
                const meta = await FantasyProsService.fetchMetadata(this.scoring, true);
                this.week = meta.week;
                this.lastUpdatedAt = meta.minutesAgo;
            } catch (err) {
                console.error('Failed to refresh rankings:', err);
                this.errorMessage = 'Could not refresh rankings from FantasyPros.';
            } finally {
                this.loading = false;
            }
        },

        async refresh() {
            this.errorMessage = '';
            this.loading = true;
            this.savePreferences();

            if (this.lastPlatform && this.lastPlatform !== this.platform) {
                this.ownerId = '';
            }
            this.lastPlatform = this.platform;

            try {
                // 1. Fetch League Data according to Platform
                let leagueData;
                if (this.platform === CONFIG.PLATFORMS.SLEEPER) {
                    leagueData = await SleeperService.loadLeagueData(this.sleeperLeagueId);
                } else if (this.platform === CONFIG.PLATFORMS.ESPN) {
                    leagueData = await EspnService.loadLeagueData(this.espnLeagueId);
                } else if (this.platform === CONFIG.PLATFORMS.YAHOO) {
                    if (this.yahooMode === 'paste') {
                        leagueData = YahooService.parseRosterText(this.yahooRosterText);
                    } else {
                        leagueData = await YahooService.loadLeagueDataFromApi(
                            this.yahooLeagueId,
                            this.yahooAccessToken,
                            this.yahooProxyUrl
                        );
                    }
                }

                if (!leagueData || !leagueData.rosteredPlayers || leagueData.rosteredPlayers.length === 0) {
                    throw new Error('No rostered players found for this league.');
                }

                this.leagueName = leagueData.leagueName || '';
                this.startingSlots = leagueData.startingSlots || [];
                this.owners = leagueData.owners || [];
                this.rosteredPlayers = leagueData.rosteredPlayers;

                // Auto-select owner:
                // Priority:
                // 1. pendingOwnerId (from query params, preferences, or history)
                // 2. this.ownerId (if already active)
                // 3. getSavedOwnerForLeague (from localStorage / history)
                // 4. fallback: first owner in alphabetical order
                let currentLeagueId = '';
                if (this.platform === 'Sleeper') currentLeagueId = (this.sleeperLeagueId || '').trim();
                else if (this.platform === 'ESPN') currentLeagueId = (this.espnLeagueId || '').trim();
                else if (this.platform === 'Yahoo') currentLeagueId = (this.yahooLeagueId || '').trim();

                if (this.owners.length > 0) {
                    const targetOwner = this.pendingOwnerId || this.ownerId || this.getSavedOwnerForLeague(this.platform, currentLeagueId);
                    let selected = null;

                    if (targetOwner) {
                        selected = this.owners.find(o => 
                            String(o.id) === String(targetOwner) || 
                            String(o.owner).toLowerCase() === String(targetOwner).toLowerCase()
                        );
                    }

                    this.ownerId = selected ? selected.id : this.owners[0].id;
                    this.pendingOwnerId = ''; // Consumed

                    if (currentLeagueId && this.ownerId) {
                        this.saveOwnerForLeague(this.platform, currentLeagueId, this.ownerId);
                    }
                }

                // 2. Fetch and apply FantasyPros rankings
                await this.applyRankings();

                try {
                    const meta = await FantasyProsService.fetchMetadata(this.scoring, true);
                    this.week = meta.week;
                    this.lastUpdatedAt = meta.minutesAgo;
                } catch (e) {}

                // 3. Optimize lineup for selected owner
                if (this.ownerId) {
                    this.optimize();
                }

                this.updateQueryParams();
                this.saveToHistory();
                this.ready = true;
            } catch (err) {
                console.error('Refresh error:', err);
                this.errorMessage = err.message || 'An unexpected error occurred. Please check your inputs.';
                this.ready = false;
                this.lineupReady = false;
            } finally {
                this.loading = false;
            }
        },

        /**
         * Matches FantasyPros rankings (Weekly and ROS) into rostered players in O(1) time.
         */
        async applyRankings() {
            const [fpData, rosData] = await Promise.all([
                FantasyProsService.fetchRankings(this.scoring),
                FantasyProsService.fetchRosRankings(this.scoring)
            ]);

            // 1. Process Weekly Rankings
            const index = PlayerMatcher.createIndex(this.rosteredPlayers);

            // Reset ranks for rostered players
            for (const p of this.rosteredPlayers) {
                p.rank = -1;
                p.flxRank = -1;
                p.rosRank = -1;
                p.rosFlxRank = -1;
                p.minRank = null;
                p.maxRank = null;
                p.stdDev = null;
                p.pts = null;
            }

            const unrosteredMap = new Map();

            // Apply rankings across all positions
            for (const [pos, playerList] of Object.entries(fpData)) {
                const isFlex = (pos === 'FLX');

                for (const fpPlayer of playerList) {
                    const matchedRosterPlayer = index.find(fpPlayer.name, pos);

                    if (matchedRosterPlayer) {
                        if (isFlex) {
                            matchedRosterPlayer.flxRank = fpPlayer.rank;
                            if (matchedRosterPlayer.pts == null && fpPlayer.pts != null) matchedRosterPlayer.pts = fpPlayer.pts;
                        } else {
                            matchedRosterPlayer.rank = fpPlayer.rank;
                            matchedRosterPlayer.minRank = fpPlayer.minRank != null ? fpPlayer.minRank : null;
                            matchedRosterPlayer.maxRank = fpPlayer.maxRank != null ? fpPlayer.maxRank : null;
                            matchedRosterPlayer.stdDev = fpPlayer.stdDev != null ? fpPlayer.stdDev : null;
                            matchedRosterPlayer.pts = fpPlayer.pts != null ? fpPlayer.pts : null;
                            if (fpPlayer.team) matchedRosterPlayer.team = fpPlayer.team;
                            if (fpPlayer.opp) matchedRosterPlayer.opp = fpPlayer.opp;
                        }
                    } else {
                        // Unrostered ranked player - deduplicate across position & FLX rankings
                        const cleanName = PlayerMatcher.normalizeName(fpPlayer.name);
                        const playerPos = fpPlayer.position || pos;
                        const key = cleanName + '_' + (playerPos === 'FLX' ? '' : playerPos);

                        let entry = unrosteredMap.get(key);
                        if (!entry) {
                            entry = {
                                id: fpPlayer.id || false,
                                name: (fpPlayer.name || '').replace(/\./g, ''),
                                position: playerPos,
                                onRoster: 0,
                                starter: false,
                                rank: -1,
                                flxRank: -1,
                                rosRank: -1,
                                rosFlxRank: -1,
                                minRank: fpPlayer.minRank != null ? fpPlayer.minRank : null,
                                maxRank: fpPlayer.maxRank != null ? fpPlayer.maxRank : null,
                                stdDev: fpPlayer.stdDev != null ? fpPlayer.stdDev : null,
                                pts: fpPlayer.pts != null ? fpPlayer.pts : null,
                                team: fpPlayer.team || '',
                                opp: fpPlayer.opp || ''
                            };
                            unrosteredMap.set(key, entry);
                        }

                        if (isFlex) {
                            entry.flxRank = fpPlayer.rank;
                            if (entry.pts == null && fpPlayer.pts != null) entry.pts = fpPlayer.pts;
                        } else {
                            entry.rank = fpPlayer.rank;
                            if (fpPlayer.minRank != null) entry.minRank = fpPlayer.minRank;
                            if (fpPlayer.maxRank != null) entry.maxRank = fpPlayer.maxRank;
                            if (fpPlayer.stdDev != null) entry.stdDev = fpPlayer.stdDev;
                            if (fpPlayer.pts != null) entry.pts = fpPlayer.pts;
                            if (fpPlayer.team) entry.team = fpPlayer.team;
                            if (fpPlayer.opp) entry.opp = fpPlayer.opp;
                            if (playerPos !== 'FLX') {
                                entry.position = playerPos;
                            }
                        }
                    }
                }
            }

            this.allRankedPlayers = [...this.rosteredPlayers, ...unrosteredMap.values()];

            // 2. Process Rest of Season (ROS) Rankings
            const rosRoster = this.rosteredPlayers.map(p => ({
                id: p.id,
                name: p.name,
                position: p.position,
                onRoster: p.onRoster,
                starter: p.starter,
                rank: -1,
                flxRank: -1
            }));
            const rosIndex = PlayerMatcher.createIndex(rosRoster);
            const weeklyIndex = PlayerMatcher.createIndex(this.allRankedPlayers);
            const rosUnrosteredMap = new Map();

            for (const [pos, playerList] of Object.entries(rosData)) {
                const isFlex = (pos === 'FLX');

                for (const fpPlayer of playerList) {
                    const matchedRosterPlayer = rosIndex.find(fpPlayer.name, pos);

                    if (matchedRosterPlayer) {
                        if (isFlex) {
                            matchedRosterPlayer.flxRank = fpPlayer.rank;
                        } else {
                            matchedRosterPlayer.rank = fpPlayer.rank;
                        }
                    } else {
                        const cleanName = PlayerMatcher.normalizeName(fpPlayer.name);
                        const playerPos = fpPlayer.position || pos;
                        const key = cleanName + '_' + (playerPos === 'FLX' ? '' : playerPos);

                        let entry = rosUnrosteredMap.get(key);
                        if (!entry) {
                            entry = {
                                id: fpPlayer.id || false,
                                name: (fpPlayer.name || '').replace(/\./g, ''),
                                position: playerPos,
                                onRoster: 0,
                                starter: false,
                                rank: -1,
                                flxRank: -1
                            };
                            rosUnrosteredMap.set(key, entry);
                        }

                        if (isFlex) {
                            entry.flxRank = fpPlayer.rank;
                        } else {
                            entry.rank = fpPlayer.rank;
                            if (playerPos !== 'FLX') {
                                entry.position = playerPos;
                            }
                        }
                    }

                    // Attach ROS rank to matched player in allRankedPlayers (for matrix chart)
                    const matchedWeekly = weeklyIndex.find(fpPlayer.name, pos);
                    if (matchedWeekly) {
                        if (isFlex) {
                            matchedWeekly.rosFlxRank = fpPlayer.rank;
                        } else {
                            matchedWeekly.rosRank = fpPlayer.rank;
                            if (!matchedWeekly.team && fpPlayer.team) matchedWeekly.team = fpPlayer.team;
                            if (!matchedWeekly.opp && fpPlayer.opp) matchedWeekly.opp = fpPlayer.opp;
                        }
                    }
                }
            }

            this.allRosRankedPlayers = [...rosRoster, ...rosUnrosteredMap.values()];
        },

        setMatrixPos(pos) {
            this.matrixPos = pos;
        },

        setMatrixXMode(mode) {
            this.matrixXMode = mode;
        },

        onMatrixPlayerHover(player, event) {
            this.matrixHoverPlayer = player;
            const container = event.currentTarget.closest('.matrix-chart-container');
            if (container) {
                const rect = container.getBoundingClientRect();
                let x = event.clientX - rect.left;
                let y = event.clientY - rect.top - 12;
                if (x < 115) x = 115;
                if (x > rect.width - 115) x = rect.width - 115;
                if (y < 120) y = y + 130;
                this.matrixTooltipPos = {
                    left: `${x}px`,
                    top: `${y}px`
                };
            }
        },

        onMatrixPlayerLeave() {
            this.matrixHoverPlayer = null;
        },

        /**
         * Solves optimal starting lineup and generates position columns.
         */
        optimize() {
            if (!this.ownerId) return;

            const { optimalLineup, fullBench, benchAlerts } = OptimizerService.solveLineup(
                this.allRankedPlayers,
                this.startingSlots,
                this.ownerId,
                this.flex
            );

            this.optimalLineup = optimalLineup;
            this.fullBench = fullBench;
            this.benchAlerts = benchAlerts;

            // Collect set of suggested pickup player names (normalized)
            const matcher = (typeof PlayerMatcher !== 'undefined') ? PlayerMatcher : null;
            const pickupNames = new Set(
                optimalLineup
                    .filter(p => p.highlight === 'pickup')
                    .map(p => matcher ? matcher.normalizeName(p.name) : (p.name || '').toLowerCase().trim())
            );

            this.positionColumns = OptimizerService.buildPositionColumns(
                this.allRankedPlayers,
                this.ownerId,
                this.flex,
                pickupNames
            );

            this.rosPositionColumns = OptimizerService.buildPositionColumns(
                this.allRosRankedPlayers,
                this.ownerId,
                this.flex,
                pickupNames
            );

            this.lineupReady = true;
        },

        onOwnerChange() {
            let currentLeagueId = '';
            if (this.platform === 'Sleeper') currentLeagueId = (this.sleeperLeagueId || '').trim();
            else if (this.platform === 'ESPN') currentLeagueId = (this.espnLeagueId || '').trim();
            else if (this.platform === 'Yahoo') currentLeagueId = (this.yahooLeagueId || '').trim();

            if (currentLeagueId && this.ownerId) {
                this.saveOwnerForLeague(this.platform, currentLeagueId, this.ownerId);
            }
            this.optimize();
            this.updateQueryParams();
            this.saveToHistory();
        },

        loadHistory() {
            try {
                const raw = localStorage.getItem('ff_league_history');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        this.leagueHistory = parsed;
                    }
                }
            } catch (e) {
                this.leagueHistory = [];
            }

            if (!this.pendingOwnerId && !this.ownerId) {
                let currentLeagueId = '';
                if (this.platform === 'Sleeper') currentLeagueId = (this.sleeperLeagueId || '').trim();
                else if (this.platform === 'ESPN') currentLeagueId = (this.espnLeagueId || '').trim();
                else if (this.platform === 'Yahoo') currentLeagueId = (this.yahooLeagueId || '').trim();

                const savedOwner = this.getSavedOwnerForLeague(this.platform, currentLeagueId);
                if (savedOwner) {
                    this.pendingOwnerId = savedOwner;
                    this.ownerId = savedOwner;
                }
            }
        },

        saveToHistory() {
            try {
                let currentLeagueId = '';
                if (this.platform === 'Sleeper') currentLeagueId = (this.sleeperLeagueId || '').trim();
                else if (this.platform === 'ESPN') currentLeagueId = (this.espnLeagueId || '').trim();
                else if (this.platform === 'Yahoo') currentLeagueId = (this.yahooLeagueId || '').trim();

                if (!currentLeagueId) return;

                let ownerName = '';
                if (this.owners && this.owners.length > 0) {
                    const ownerObj = this.owners.find(o => String(o.id) === String(this.ownerId));
                    if (ownerObj && ownerObj.owner) {
                        ownerName = ownerObj.owner;
                    }
                }

                let currentLeagueName = this.leagueName || '';
                if (!currentLeagueName && this.leagueHistory) {
                    const existing = this.leagueHistory.find(h => 
                        h.platform === this.platform && 
                        String(h.leagueId) === String(currentLeagueId) && 
                        h.leagueName
                    );
                    if (existing) currentLeagueName = existing.leagueName;
                }

                const entry = {
                    platform: this.platform,
                    leagueId: currentLeagueId,
                    leagueName: currentLeagueName,
                    scoring: this.scoring || 'STD',
                    flex: this.flex || 'WRT',
                    owner: this.ownerId ? String(this.ownerId) : '',
                    ownerName: ownerName,
                    timestamp: Date.now()
                };

                // Filter out any prior duplicate (same platform, leagueId, and owner)
                const history = (this.leagueHistory || []).filter(h => 
                    !(h.platform === entry.platform && 
                      String(h.leagueId) === String(entry.leagueId) && 
                      String(h.owner || '') === String(entry.owner || ''))
                );

                // Add new entry to the front
                history.unshift(entry);

                // Keep up to 10 most recent leagues
                this.leagueHistory = history.slice(0, 10);
                localStorage.setItem('ff_league_history', JSON.stringify(this.leagueHistory));
            } catch (e) {}
        },

        async selectHistoryItem(item) {
            if (!item) return;
            this.platform = item.platform;
            this.scoring = item.scoring || 'STD';
            this.flex = item.flex || 'WRT';
            this.leagueName = item.leagueName || '';

            if (item.platform === 'Sleeper') this.sleeperLeagueId = item.leagueId;
            else if (item.platform === 'ESPN') this.espnLeagueId = item.leagueId;
            else if (item.platform === 'Yahoo') {
                this.yahooLeagueId = item.leagueId;
                this.yahooMode = 'api';
            }

            this.pendingOwnerId = item.owner || '';
            this.ownerId = item.owner || '';
            this.savePreferences();
            this.updateQueryParams();
            await this.refresh();
        },

        removeHistoryItem(index) {
            try {
                this.leagueHistory.splice(index, 1);
                localStorage.setItem('ff_league_history', JSON.stringify(this.leagueHistory));
            } catch (e) {}
        },

        clearHistory() {
            this.leagueHistory = [];
            try {
                localStorage.removeItem('ff_league_history');
            } catch (e) {}
        },

        isCurrentHistoryItem(item) {
            if (!item) return false;
            let currentLeagueId = '';
            if (this.platform === 'Sleeper') currentLeagueId = (this.sleeperLeagueId || '').trim();
            else if (this.platform === 'ESPN') currentLeagueId = (this.espnLeagueId || '').trim();
            else if (this.platform === 'Yahoo') currentLeagueId = (this.yahooLeagueId || '').trim();

            const samePlatform = (this.platform === item.platform);
            const sameLeague = (String(currentLeagueId) === String(item.leagueId));
            const sameOwner = (!item.owner || String(this.ownerId) === String(item.owner));

            return samePlatform && sameLeague && sameOwner;
        },

        /**
         * Loads sample Yahoo roster text for quick user testing.
         */
        loadSampleYahooText() {
            this.yahooRosterText = 
`Pos\tPlayer\tOpp\tStatus\tProj
QB\tPatrick Mahomes KC - QB\t@LAC\tSun 3:25pm\t20.4
RB\tBijan Robinson Atl - RB\tvsKC\tSun 7:20pm\t17.2
RB\tJahmyr Gibbs Det - RB\t@ARI\tSun 3:25pm\t15.8
WR\tJustin Jefferson Min - WR\tvsHOU\tSun 12:00pm\t18.1
WR\tAmon-Ra St. Brown Det - WR\t@ARI\tSun 3:25pm\t16.5
TE\tTrey McBride Ari - TE\tvsDET\tSun 3:25pm\t11.2
W/R/T\tRashee Rice KC - WR\t@LAC\tSun 3:25pm\t13.4
K\tBrandon Aubrey Dal - K\tvsBAL\tSun 3:25pm\t8.5
DEF\tSan Francisco SF - DEF\t@LAR\tSun 3:25pm\t7.2
BN\tDeVonta Smith Phi - WR\t@NO\tSun 12:00pm\t12.8
BN\tJordan Love GB - QB\t@TEN\tSun 12:00pm\t-
IR\tChristian McCaffrey SF - RB\tIR\t-\t-`;
        }
    }
});
