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
            leagueHistory: []
        };
    },

    computed: {
        benchPlayers() {
            return (this.fullBench || []).filter(p => p.highlight !== 'drop');
        },
        dropPlayers() {
            return (this.fullBench || []).filter(p => p.highlight === 'drop');
        }
    },

    async mounted() {
        this.loadPreferences();
        this.loadQueryParams();
        this.loadHistory();

        try {
            const meta = await FantasyProsService.fetchMetadata();
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
                const meta = await FantasyProsService.fetchMetadata();
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

            if (this.lastPlatform !== this.platform) {
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

                // Auto-select owner (matching pendingOwnerId if provided from query params, otherwise first owner)
                if (this.owners.length > 0) {
                    let selected = null;
                    if (this.pendingOwnerId) {
                        selected = this.owners.find(o => String(o.id) === String(this.pendingOwnerId) || String(o.owner).toLowerCase() === String(this.pendingOwnerId).toLowerCase());
                    }
                    if (!selected && this.ownerId) {
                        selected = this.owners.find(o => o.id == this.ownerId);
                    }
                    this.ownerId = selected ? selected.id : this.owners[0].id;
                }

                // 2. Fetch and apply FantasyPros rankings
                await this.applyRankings();

                try {
                    const meta = await FantasyProsService.fetchMetadata();
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
                        } else {
                            matchedRosterPlayer.rank = fpPlayer.rank;
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
                                flxRank: -1
                            };
                            unrosteredMap.set(key, entry);
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
                }
            }

            this.allRosRankedPlayers = [...rosRoster, ...rosUnrosteredMap.values()];
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
