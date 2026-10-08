/**
 * FF Optimizer - Main Vue Application
 */

var app = new Vue({
    el: '#app',
    data() {
        return {
            platform: 'Sleeper',
            scoring: 'PPR',
            flex: 'WRT',
            showSettingsOverride: false,
            leagueDetectedScoring: '',
            leagueDetectedFlex: '',

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
            matrixZoom: 'fit', // 'fit' (show all unclamped) or 'cluster' (focus on starters cluster)
            matrixHoverPlayer: null,
            matrixSelectedPlayer: null,
            matrixTooltipPos: { left: '0px', top: '0px' },
            showMatrixChart: true,
            opinionatedMoves: null,
            matrixFilters: {
                pickup: true,
                drop: true,
                roster: true,
                wire: true
            },

            // Matrix Chart Pan & Zoom interactive state
            matrixViewBox: { x: 0, y: 0, w: 800, h: 500 },
            matrixIsDragging: false,
            matrixHasDragged: false,
            matrixDragStart: { clientX: 0, clientY: 0, vbX: 0, vbY: 0 },
            matrixTouchDistance: null
        };
    },

    computed: {
        matrixViewBoxString() {
            const vb = this.matrixViewBox || { x: 0, y: 0, w: 800, h: 500 };
            return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
        },
        matrixZoomPercent() {
            return Math.round((800 / (this.matrixViewBox?.w || 800)) * 100);
        },
        isMatrixZoomedOrPanned() {
            const vb = this.matrixViewBox;
            if (!vb) return false;
            return vb.w !== 800 || vb.x !== 0 || vb.y !== 0;
        },
        benchPlayers() {
            return (this.fullBench || []).filter(p => p.highlight !== 'drop');
        },
        dropPlayers() {
            return (this.fullBench || []).filter(p => p.highlight === 'drop');
        },
        activeMatrixPlayer() {
            return this.matrixHoverPlayer || this.matrixSelectedPlayer || null;
        },
        currentSelectedPlayerIndex() {
            if (!this.matrixSelectedPlayer || !this.matrixChartData || !this.matrixChartData.players) return -1;
            const matcher = (typeof PlayerMatcher !== 'undefined') ? PlayerMatcher : null;
            const norm = matcher ? matcher.normalizeName(this.matrixSelectedPlayer.name) : (this.matrixSelectedPlayer.name || '').toLowerCase().trim();
            return this.matrixChartData.players.findIndex(p => {
                const pNorm = matcher ? matcher.normalizeName(p.name) : (p.name || '').toLowerCase().trim();
                return pNorm === norm;
            });
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

            const flexPositions = (this.flex === 'WR') ? ['RB', 'WR'] : ['RB', 'WR', 'TE'];

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
            } else if (currentPos === 'FLX') {
                selectedFreeAgents = allFreeAgents
                    .filter(p => flexPositions.includes(p.position) && (p.flxRank > 0 || p.rank > 0))
                    .sort((a, b) => {
                        const rA = a.flxRank > 0 ? a.flxRank : (a.rank + 50);
                        const rB = b.flxRank > 0 ? b.flxRank : (b.rank + 50);
                        return rA - rB;
                    })
                    .slice(0, 15);
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

                if (currentPos !== 'ALL') {
                    if (currentPos === 'FLX') {
                        if (!flexPositions.includes(pos) && pos !== 'FLX') return;
                    } else if (pos !== currentPos) {
                        return;
                    }
                }

                // If in FLX filter or slot/pos is FLX, prioritize flex ranks
                const weekRank = (currentPos === 'FLX' || pos === 'FLX')
                    ? (full.flxRank > 0 ? full.flxRank : (full.rank > 0 ? full.rank : (p.rank > 0 ? p.rank : null)))
                    : (full.rank > 0 ? full.rank : (full.flxRank > 0 ? full.flxRank : (p.rank > 0 ? p.rank : null)));

                const rosRank = (currentPos === 'FLX' || pos === 'FLX')
                    ? (full.rosFlxRank > 0 ? full.rosFlxRank : (full.rosRank > 0 ? full.rosRank : null))
                    : (full.rosRank > 0 ? full.rosRank : (full.rosFlxRank > 0 ? full.rosFlxRank : null));

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
                        confidence: extra.confidence || p.confidence || full.confidence || null,
                        confidenceTier: extra.confidenceTier || p.confidenceTier || full.confidenceTier || null,
                        confidenceBadge: extra.confidenceBadge || p.confidenceBadge || full.confidenceBadge || null,
                        confidenceShortBadge: extra.confidenceShortBadge || p.confidenceShortBadge || full.confidenceShortBadge || null,
                        rationale: extra.rationale || p.rationale || full.rationale || null,
                        rankDelta: extra.rankDelta || p.rankDelta || full.rankDelta || null,
                        ptsDelta: extra.ptsDelta || p.ptsDelta || full.ptsDelta || null,
                        isStashWarning: extra.isStashWarning || p.isStashWarning || full.isStashWarning || false,
                        targetDrop: extra.targetDrop || p.targetDrop || null,
                        targetPickup: extra.targetPickup || p.targetPickup || null
                    });
                }
            };

            pickups.forEach(p => addPlayer(p, 'pickup', { targetDrop: p.targetDrop, ...p }));
            drops.forEach(p => addPlayer(p, 'drop', { targetPickup: p.targetPickup, ...p }));
            starters.filter(p => p.highlight !== 'pickup').forEach(p => addPlayer(p, 'roster', { ...p }));
            bench.forEach(p => addPlayer(p, 'roster', { ...p }));
            selectedFreeAgents.forEach(p => addPlayer(p, 'wire', { ...p }));

            const rawList = Array.from(playerMap.values()).filter(p => {
                if (this.matrixFilters && this.matrixFilters[p.status] === false) {
                    return false;
                }
                return true;
            });
            if (rawList.length === 0) return null;

            const width = 800;
            const height = 500;
            const margin = { top: 40, right: 45, bottom: 50, left: 65 };
            const plotWidth = width - margin.left - margin.right;
            const plotHeight = height - margin.top - margin.bottom;

            // 1. Gather display points and effective ROS rank for all candidates
            const preparedPlayers = rawList.map(p => {
                let displayPts = p.pts;
                if (displayPts == null && p.weekRank) {
                    if (p.pos === 'QB') displayPts = Math.max(10, +(26 - p.weekRank * 0.45).toFixed(1));
                    else if (p.pos === 'DST' || p.pos === 'K') displayPts = Math.max(3, +(12 - p.weekRank * 0.28).toFixed(1));
                    else displayPts = Math.max(4, +(22 - p.weekRank * 0.35).toFixed(1));
                }
                const effRos = (p.rosRank != null && p.rosRank > 0) ? p.rosRank : (p.weekRank != null ? p.weekRank : null);
                return {
                    ...p,
                    displayPts: displayPts,
                    effRos: effRos
                };
            });

            const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
            const getPercentile = (sorted, p) => {
                if (sorted.length === 0) return 0;
                const idx = (sorted.length - 1) * p;
                const l = Math.floor(idx);
                const h = Math.ceil(idx);
                return sorted[l] + (sorted[h] - sorted[l]) * (idx - l);
            };

            // Gather valid sorted X and Y values
            const validX = isRankMode
                ? preparedPlayers.map(p => p.weekRank).filter(v => v != null && v > 0).sort((a, b) => a - b)
                : preparedPlayers.map(p => p.displayPts).filter(v => v != null).sort((a, b) => a - b);
            const validRos = preparedPlayers.map(p => p.effRos).filter(v => v != null && v > 0).sort((a, b) => a - b);

            // Standard Fantasy Football Starting & ROS Thresholds
            const THRESHOLDS = {
                QB:  { rank: 12, pts: 17.0, ros: 12, maxRankFit: 36, maxRankCluster: 26, maxRosFit: 36, maxRosCluster: 26 },
                RB:  { rank: 24, pts: 11.5, ros: 24, maxRankFit: 60, maxRankCluster: 42, maxRosFit: 60, maxRosCluster: 42 },
                WR:  { rank: 30, pts: 11.5, ros: 30, maxRankFit: 70, maxRankCluster: 48, maxRosFit: 70, maxRosCluster: 48 },
                TE:  { rank: 12, pts: 9.0,  ros: 12, maxRankFit: 36, maxRankCluster: 26, maxRosFit: 36, maxRosCluster: 26 },
                K:   { rank: 12, pts: 7.5,  ros: 12, maxRankFit: 32, maxRankCluster: 22, maxRosFit: 32, maxRosCluster: 22 },
                DST: { rank: 12, pts: 7.0,  ros: 12, maxRankFit: 32, maxRankCluster: 22, maxRosFit: 32, maxRosCluster: 22 },
                FLX: { rank: 36, pts: 10.5, ros: 40, maxRankFit: 90, maxRankCluster: 60, maxRosFit: 120, maxRosCluster: 75 },
                ALL: { rank: 24, pts: 12.0, ros: 24, maxRankFit: 60, maxRankCluster: 40, maxRosFit: 60, maxRosCluster: 40 }
            };
            const posThresh = THRESHOLDS[currentPos] || THRESHOLDS.ALL;

            // Compute highest weekly and ROS ranks across all prepared players
            const highestPlayerRank = validX.length ? validX[validX.length - 1] : posThresh.maxRankFit;
            const highestPlayerRos = validRos.length ? validRos[validRos.length - 1] : posThresh.maxRosFit;

            // X Domain (Weekly Rank or Projected Points)
            let minX = 1;
            // Pad maxX so the lowest ranked player has generous breathing room and is never clamped to border
            let maxX = Math.max(posThresh.maxRankFit, Math.ceil(highestPlayerRank + 5));
            let minPts = 2.0;
            let maxPts = 24.0;

            if (isRankMode) {
                minX = 1;
            } else {
                const lowPt = validX.length ? validX[0] : 4.0;
                const topPt = validX.length ? validX[validX.length - 1] : 22.0;
                minPts = Math.max(0.0, Math.floor(lowPt - 1.5));
                maxPts = Math.max(22.0, Math.ceil(topPt + 2.0));
            }

            // Y Domain (Rest of Season)
            let minY = 1;
            // Pad maxY so the lowest ROS player has generous breathing room and is never clamped to border
            let maxY = Math.max(posThresh.maxRosFit, Math.ceil(highestPlayerRos + 5));

            // Internal padding to guarantee player dots and whiskers never touch or overlap axis boundary lines
            const innerPad = 16;
            const usablePlotWidth = plotWidth - innerPad * 2;
            const usablePlotHeight = plotHeight - innerPad * 2;

            const xScale = val => {
                if (isRankMode) {
                    const safe = Math.max(minX, Math.min(maxX, val != null && val > 0 ? val : maxX));
                    const ratio = (maxX - safe) / (maxX - minX);
                    return margin.left + innerPad + ratio * usablePlotWidth;
                } else {
                    const safe = Math.max(minPts, Math.min(maxPts, val != null ? val : minPts));
                    const ratio = (safe - minPts) / (maxPts - minPts);
                    return margin.left + innerPad + ratio * usablePlotWidth;
                }
            };

            const yScale = ros => {
                const safe = Math.max(minY, Math.min(maxY, ros != null && ros > 0 ? ros : maxY));
                const ratio = (safe - minY) / (maxY - minY);
                return margin.top + innerPad + ratio * usablePlotHeight;
            };

            // Dynamic Crosshair Divider lines anchored to Fantasy Football Value Thresholds
            const targetThresholdX = isRankMode ? posThresh.rank : posThresh.pts;
            const targetThresholdY = posThresh.ros;

            const midX = xScale(targetThresholdX);
            const midY = yScale(targetThresholdY);

            const thresholdLabelX = isRankMode ? '#' + posThresh.rank : posThresh.pts + ' pts';
            const thresholdLabelY = '#' + posThresh.ros;

            // Diagonal equality vector coordinates (Weekly Rank == ROS Rank)
            const commonMax = Math.min(maxX, maxY);
            const diagX1 = xScale(1);
            const diagY1 = yScale(1);
            const diagX2 = xScale(commonMax);
            const diagY2 = yScale(commonMax);

            let outlierCount = 0;
            const plottedPlayers = preparedPlayers.map(p => {
                const xVal = isRankMode ? p.weekRank : p.displayPts;
                const effRos = p.effRos || maxY;

                let cx = xScale(xVal);
                let cy = yScale(effRos);

                let dotColor = '#94a3b8';
                let strokeColor = '#64748b';
                let strokeWidth = 2;
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
                if (isRankMode) {
                    if (currentPos !== 'FLX' && p.minRank && p.maxRank) {
                        const wMin = xScale(p.minRank);
                        const wMax = xScale(p.maxRank);
                        whisker = {
                            x1: Math.min(wMin, wMax),
                            x2: Math.max(wMin, wMax),
                            y: cy,
                            strokeColor: strokeColor,
                            opacity: (p.status === 'pickup' || p.status === 'drop') ? 0.9 : 0.45
                        };
                    } else if (currentPos === 'FLX' && p.stdDev && p.weekRank) {
                        const spread = Math.max(2, Math.round(p.stdDev * 1.8));
                        const wMin = xScale(Math.max(1, p.weekRank - spread));
                        const wMax = xScale(p.weekRank + spread);
                        whisker = {
                            x1: Math.min(wMin, wMax),
                            x2: Math.max(wMin, wMax),
                            y: cy,
                            strokeColor: strokeColor,
                            opacity: (p.status === 'pickup' || p.status === 'drop') ? 0.9 : 0.45
                        };
                    }
                }

                const isTopPerformer = (p.weekRank != null && p.weekRank <= 3) || (p.effRos != null && p.effRos <= 3);

                let label = null;
                if (p.status === 'pickup' || p.status === 'drop' || (p.status === 'roster' && (p.weekRank <= 8 || p.effRos <= 8))) {
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
                    cx: cx,
                    cy: cy,
                    dotColor: dotColor,
                    strokeColor: strokeColor,
                    strokeWidth: strokeWidth,
                    radius: radius,
                    isOutlier: false,
                    isTopPerformer: isTopPerformer,
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
                        pickupName: pk.name,
                        confidence: pk.confidence || 85,
                        confidenceTier: pk.confidenceTier || 'MUST ADD',
                        confidenceBadge: pk.confidenceShortBadge || (pk.confidence ? `${pk.confidence}% CONFIDENCE` : 'UPGRADE'),
                        isMustAdd: pk.confidenceTier === 'MUST ADD'
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
                        pickupName: pkPlayer.name,
                        confidence: pkPlayer.confidence || 85,
                        confidenceTier: pkPlayer.confidenceTier || 'MUST ADD',
                        confidenceBadge: pkPlayer.confidenceShortBadge || (pkPlayer.confidence ? `${pkPlayer.confidence}% CONFIDENCE` : 'UPGRADE'),
                        isMustAdd: pkPlayer.confidenceTier === 'MUST ADD'
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
                thresholdLabelX,
                thresholdLabelY,
                diagX1,
                diagY1,
                diagX2,
                diagY2,
                minX: isRankMode ? minX : minPts,
                maxX: isRankMode ? maxX : maxPts,
                minY,
                maxY,
                minRank: isRankMode ? minX : 1,
                maxRank: isRankMode ? maxX : posThresh.maxRankFit,
                minPts,
                maxPts,
                isRankMode,
                outlierCount,
                players: plottedPlayers,
                upgradeVectors: upgradeVectors
            };
        }
    },

    watch: {
        matrixViewBox: {
            deep: true,
            handler() {
                this.applyMatrixViewBox();
            }
        },
        matrixChartData() {
            this.$nextTick(() => {
                this.applyMatrixViewBox();
                this.initMatrixWheelListener();
            });
        }
    },

    updated() {
        this.initMatrixWheelListener();
    },

    async mounted() {
        this.loadPreferences();
        this.loadQueryParams();
        this.loadHistory();

        this.$nextTick(() => {
            this.applyMatrixViewBox();
            this.initMatrixWheelListener();
        });

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

                if (leagueData.scoring) {
                    this.scoring = leagueData.scoring;
                    this.leagueDetectedScoring = leagueData.scoring;
                }
                if (leagueData.flex) {
                    this.flex = leagueData.flex;
                    this.leagueDetectedFlex = leagueData.flex;
                }

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
                    const matchedRosterPlayer = index.find(fpPlayer.name, pos, fpPlayer.id);

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
                    const matchedRosterPlayer = rosIndex.find(fpPlayer.name, pos, fpPlayer.id);

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
                    const matchedWeekly = weeklyIndex.find(fpPlayer.name, pos, fpPlayer.id);
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

        toggleMatrixFilter(status) {
            if (this.matrixFilters && this.matrixFilters.hasOwnProperty(status)) {
                this.matrixFilters[status] = !this.matrixFilters[status];
                // If currently selected player is now filtered out, clear selection
                if (this.matrixSelectedPlayer && !this.matrixFilters[this.matrixSelectedPlayer.status]) {
                    this.matrixSelectedPlayer = null;
                    this.matrixHoverPlayer = null;
                }
            }
        },

        setMatrixPos(pos) {
            this.matrixPos = pos;
            this.resetMatrixZoom();
            if (this.matrixSelectedPlayer) {
                this.$nextTick(() => {
                    const exists = this.matrixChartData?.players?.some(p => p.name === this.matrixSelectedPlayer.name);
                    if (!exists) {
                        this.matrixSelectedPlayer = null;
                        this.matrixHoverPlayer = null;
                    }
                });
            }
        },

        setMatrixXMode(mode) {
            this.matrixXMode = mode;
            this.resetMatrixZoom();
            if (this.matrixSelectedPlayer) {
                this.$nextTick(() => {
                    const updated = this.matrixChartData?.players?.find(p => p.name === this.matrixSelectedPlayer.name);
                    if (updated) this.updateMatrixTooltipPosition(updated);
                });
            }
        },

        setMatrixZoom(zoom) {
            this.matrixZoom = zoom;
            if (zoom === 'cluster') {
                // Camera preset: zoom viewport into primary starters & stashes cluster
                const vbW = Math.round(800 / 1.55);
                const vbH = Math.round(500 / 1.55);
                const vbX = Math.round(800 - vbW - 12);
                const vbY = 12;
                this.matrixViewBox = { x: vbX, y: vbY, w: vbW, h: vbH };
                this.applyMatrixViewBox();
            } else {
                this.resetMatrixZoom();
            }
            if (this.matrixSelectedPlayer) {
                this.$nextTick(() => {
                    const updated = this.matrixChartData?.players?.find(p => p.name === this.matrixSelectedPlayer.name);
                    if (updated) this.updateMatrixTooltipPosition(updated);
                });
            }
        },

        applyMatrixViewBox() {
            if (typeof document === 'undefined') return;
            const svg = document.querySelector('.matrix-svg');
            if (svg) {
                const vb = this.matrixViewBox || { x: 0, y: 0, w: 800, h: 500 };
                svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
            }
        },

        initMatrixWheelListener() {
            if (typeof document === 'undefined') return;
            const container = document.querySelector('.matrix-chart-container');
            if (container && !container.__hasWheelListener) {
                container.__hasWheelListener = true;
                container.addEventListener('wheel', (e) => {
                    this.onMatrixWheel(e);
                }, { passive: false });
            }
        },

        zoomMatrixAt(px, py, factor) {
            const minW = 800 / 4.5; // Max ~4.5x zoom
            const maxW = 800 * 1.1; // Max slight zoom out
            const newW = Math.max(minW, Math.min(maxW, this.matrixViewBox.w / factor));
            const k = this.matrixViewBox.w / newW;
            const newH = 500 * (newW / 800);

            let newX = px - (px - this.matrixViewBox.x) / k;
            let newY = py - (py - this.matrixViewBox.y) / k;

            newX = Math.max(-120, Math.min(920 - newW, newX));
            newY = Math.max(-80, Math.min(580 - newH, newY));

            this.matrixViewBox = {
                x: Math.round(newX),
                y: Math.round(newY),
                w: Math.round(newW),
                h: Math.round(newH)
            };

            this.applyMatrixViewBox();

            if (this.matrixHoverPlayer) {
                this.updateMatrixTooltipPosition(this.matrixHoverPlayer);
            }
        },

        zoomMatrixBy(factor) {
            const cx = this.matrixViewBox.x + this.matrixViewBox.w / 2;
            const cy = this.matrixViewBox.y + this.matrixViewBox.h / 2;
            this.zoomMatrixAt(cx, cy, factor);
        },

        resetMatrixZoom() {
            this.matrixViewBox = { x: 0, y: 0, w: 800, h: 500 };
            this.matrixIsDragging = false;
            this.matrixHasDragged = false;
            this.applyMatrixViewBox();
            if (this.matrixHoverPlayer) {
                this.updateMatrixTooltipPosition(this.matrixHoverPlayer);
            }
        },

        onMatrixWheel(event) {
            if (!this.matrixChartData) return;
            if (event && event.preventDefault) event.preventDefault();
            if (event && event.stopPropagation) event.stopPropagation();

            const svg = (typeof document !== 'undefined') ? document.querySelector('.matrix-svg') : null;
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            const clientX = (event.clientX != null) ? event.clientX : (rect.left + rect.width / 2);
            const clientY = (event.clientY != null) ? event.clientY : (rect.top + rect.height / 2);
            const ratioX = (clientX - rect.left) / (rect.width || 800);
            const ratioY = (clientY - rect.top) / (rect.height || 500);
            const svgPointX = this.matrixViewBox.x + ratioX * this.matrixViewBox.w;
            const svgPointY = this.matrixViewBox.y + ratioY * this.matrixViewBox.h;

            const rawFactor = Math.exp(-event.deltaY * 0.002);
            const factor = Math.max(0.75, Math.min(1.35, rawFactor));
            this.zoomMatrixAt(svgPointX, svgPointY, factor);
        },

        onMatrixMouseDown(event) {
            if (event.button !== 0) return;
            this.matrixIsDragging = true;
            this.matrixHasDragged = false;
            this.matrixDragStart = {
                clientX: event.clientX,
                clientY: event.clientY,
                vbX: this.matrixViewBox.x,
                vbY: this.matrixViewBox.y
            };
            if (typeof window !== 'undefined') {
                window.removeEventListener('mousemove', this.onMatrixMouseMove);
                window.removeEventListener('mouseup', this.onMatrixMouseUp);
                window.addEventListener('mousemove', this.onMatrixMouseMove);
                window.addEventListener('mouseup', this.onMatrixMouseUp);
            }
        },

        onMatrixMouseMove(event) {
            if (!this.matrixIsDragging) return;
            const dx = event.clientX - this.matrixDragStart.clientX;
            const dy = event.clientY - this.matrixDragStart.clientY;
            if (Math.hypot(dx, dy) > 5) {
                this.matrixHasDragged = true;
            }

            const svg = (typeof document !== 'undefined') ? document.querySelector('.matrix-svg') : null;
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            const scaleX = this.matrixViewBox.w / (rect.width || 800);
            const scaleY = this.matrixViewBox.h / (rect.height || 500);

            let newX = this.matrixDragStart.vbX - dx * scaleX;
            let newY = this.matrixDragStart.vbY - dy * scaleY;
            newX = Math.max(-120, Math.min(920 - this.matrixViewBox.w, newX));
            newY = Math.max(-80, Math.min(580 - this.matrixViewBox.h, newY));

            this.matrixViewBox.x = Math.round(newX);
            this.matrixViewBox.y = Math.round(newY);
            this.applyMatrixViewBox();

            if (this.matrixHoverPlayer) {
                this.updateMatrixTooltipPosition(this.matrixHoverPlayer);
            }
        },

        onMatrixMouseUp(event) {
            this.matrixIsDragging = false;
            if (typeof window !== 'undefined') {
                window.removeEventListener('mousemove', this.onMatrixMouseMove);
                window.removeEventListener('mouseup', this.onMatrixMouseUp);
            }
        },

        onMatrixMouseLeave(event) {
            this.onMatrixPlayerLeave();
        },

        onMatrixTouchStart(event) {
            if (event.touches.length === 1) {
                this.matrixIsDragging = true;
                this.matrixHasDragged = false;
                this.matrixTouchDistance = null;
                this.matrixDragStart = {
                    clientX: event.touches[0].clientX,
                    clientY: event.touches[0].clientY,
                    vbX: this.matrixViewBox.x,
                    vbY: this.matrixViewBox.y
                };
            } else if (event.touches.length === 2) {
                this.matrixIsDragging = false;
                this.matrixHasDragged = true;
                const dx = event.touches[0].clientX - event.touches[1].clientX;
                const dy = event.touches[0].clientY - event.touches[1].clientY;
                this.matrixTouchDistance = Math.hypot(dx, dy);
            }
        },

        onMatrixTouchMove(event) {
            if (event.touches.length === 1 && this.matrixIsDragging) {
                const dx = event.touches[0].clientX - this.matrixDragStart.clientX;
                const dy = event.touches[0].clientY - this.matrixDragStart.clientY;
                if (Math.hypot(dx, dy) > 6) {
                    this.matrixHasDragged = true;
                    if (event.cancelable) event.preventDefault();
                }

                if (this.matrixHasDragged) {
                    const svg = (typeof document !== 'undefined') ? document.querySelector('.matrix-svg') : null;
                    if (!svg) return;
                    const rect = svg.getBoundingClientRect();
                    const scaleX = this.matrixViewBox.w / (rect.width || 800);
                    const scaleY = this.matrixViewBox.h / (rect.height || 500);

                    let newX = this.matrixDragStart.vbX - dx * scaleX;
                    let newY = this.matrixDragStart.vbY - dy * scaleY;
                    newX = Math.max(-120, Math.min(920 - this.matrixViewBox.w, newX));
                    newY = Math.max(-80, Math.min(580 - this.matrixViewBox.h, newY));

                    this.matrixViewBox.x = Math.round(newX);
                    this.matrixViewBox.y = Math.round(newY);
                    this.applyMatrixViewBox();
                }
            } else if (event.touches.length === 2 && this.matrixTouchDistance) {
                if (event.cancelable) event.preventDefault();
                const dx = event.touches[0].clientX - event.touches[1].clientX;
                const dy = event.touches[0].clientY - event.touches[1].clientY;
                const currentDist = Math.hypot(dx, dy);
                if (currentDist > 10 && this.matrixTouchDistance > 10) {
                    const factor = currentDist / this.matrixTouchDistance;
                    const midClientX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
                    const midClientY = (event.touches[0].clientY + event.touches[1].clientY) / 2;

                    const svg = (typeof document !== 'undefined') ? document.querySelector('.matrix-svg') : null;
                    if (svg) {
                        const rect = svg.getBoundingClientRect();
                        const ratioX = (midClientX - rect.left) / (rect.width || 800);
                        const ratioY = (midClientY - rect.top) / (rect.height || 500);
                        const svgPointX = this.matrixViewBox.x + ratioX * this.matrixViewBox.w;
                        const svgPointY = this.matrixViewBox.y + ratioY * this.matrixViewBox.h;
                        this.zoomMatrixAt(svgPointX, svgPointY, factor);
                    }
                    this.matrixTouchDistance = currentDist;
                }
            }
        },

        onMatrixTouchEnd(event) {
            if (event.touches.length === 0) {
                this.matrixIsDragging = false;
                this.matrixTouchDistance = null;
            }
        },

        updateMatrixTooltipPosition(player) {
            if (!player) return;
            const container = (typeof document !== 'undefined') ? document.querySelector('.matrix-chart-container') : null;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const width = rect.width || 800;
            const height = rect.height || 500;

            const vb = this.matrixViewBox || { x: 0, y: 0, w: 800, h: 500 };

            // Map SVG coordinates to container pixels based on active viewBox
            let x = ((player.cx - vb.x) / vb.w) * width;
            let y = ((player.cy - vb.y) / vb.h) * height;

            if (x < 115) x = 115;
            if (x > width - 115) x = width - 115;

            const isNearTop = y < 140;
            const transform = isNearTop
                ? 'translate(-50%, 14px)'
                : 'translate(-50%, calc(-100% - 12px))';

            this.matrixTooltipPos = {
                left: `${x}px`,
                top: `${y}px`,
                transform: transform
            };
        },

        onMatrixPlayerHover(player, event) {
            this.matrixHoverPlayer = player;
            this.updateMatrixTooltipPosition(player);
        },

        onMatrixPlayerLeave() {
            this.matrixHoverPlayer = this.matrixSelectedPlayer || null;
        },

        onMatrixPlayerClick(player, event) {
            if (this.matrixHasDragged) return; // Prevent selection if user was dragging
            if (event && event.stopPropagation) {
                event.stopPropagation();
            }
            this.selectMatrixPlayer(player);
        },

        selectMatrixPlayer(player) {
            if (!player) return;
            if (this.matrixSelectedPlayer && this.matrixSelectedPlayer.name === player.name) {
                this.matrixSelectedPlayer = null;
                this.matrixHoverPlayer = null;
            } else {
                this.matrixSelectedPlayer = player;
                this.matrixHoverPlayer = player;
                this.updateMatrixTooltipPosition(player);
            }
        },

        navigateMatrixPlayer(direction) {
            if (!this.matrixChartData || !this.matrixChartData.players || this.matrixChartData.players.length === 0) return;
            const list = this.matrixChartData.players;
            let idx = this.currentSelectedPlayerIndex;
            if (idx === -1) {
                idx = direction > 0 ? 0 : list.length - 1;
            } else {
                idx = (idx + direction + list.length) % list.length;
            }
            const next = list[idx];
            if (next) {
                this.selectMatrixPlayer(next);
            }
        },

        onMatrixSvgClick(event) {
            if (this.matrixHasDragged) return; // Ignore drag completion
            if (!this.matrixChartData || !this.matrixChartData.players || this.matrixChartData.players.length === 0) return;
            const svg = (typeof document !== 'undefined') ? document.querySelector('.matrix-svg') : null;
            if (!svg) return;

            let svgX = 0;
            let svgY = 0;

            if (svg.createSVGPoint && svg.getScreenCTM) {
                try {
                    const pt = svg.createSVGPoint();
                    pt.x = event.clientX;
                    pt.y = event.clientY;
                    const ctm = svg.getScreenCTM();
                    if (ctm) {
                        const transformed = pt.matrixTransform(ctm.inverse());
                        svgX = transformed.x;
                        svgY = transformed.y;
                    }
                } catch (e) {}
            }

            if (!svgX && !svgY) {
                const rect = svg.getBoundingClientRect();
                const vb = this.matrixViewBox || { x: 0, y: 0, w: 800, h: 500 };
                svgX = vb.x + ((event.clientX - rect.left) / (rect.width || 800)) * vb.w;
                svgY = vb.y + ((event.clientY - rect.top) / (rect.height || 500)) * vb.h;
            }

            // Find closest visible player within proximity threshold (scaled by current zoom)
            const zoomScale = 800 / (this.matrixViewBox?.w || 800);
            const threshold = Math.max(16, 36 / zoomScale);
            let closest = null;
            let minDist = threshold;
            for (const p of this.matrixChartData.players) {
                const dx = p.cx - svgX;
                const dy = p.cy - svgY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist) {
                    minDist = dist;
                    closest = p;
                }
            }

            if (closest) {
                this.selectMatrixPlayer(closest);
            } else {
                this.matrixSelectedPlayer = null;
                this.matrixHoverPlayer = null;
            }
        },

        selectPlayerByName(name) {
            if (!name) return;
            const matcher = (typeof PlayerMatcher !== 'undefined') ? PlayerMatcher : null;
            const norm = matcher ? matcher.normalizeName(name) : name.toLowerCase().trim();

            let found = this.matrixChartData?.players?.find(p => {
                const pNorm = matcher ? matcher.normalizeName(p.name) : (p.name || '').toLowerCase().trim();
                return pNorm === norm;
            });

            if (!found && this.allRankedPlayers) {
                const full = this.allRankedPlayers.find(p => (matcher ? matcher.normalizeName(p.name) : (p.name || '').toLowerCase().trim()) === norm);
                if (full) {
                    const pos = full.position || full.slot;
                    if (['QB', 'RB', 'WR', 'TE', 'DST', 'K'].includes(pos)) {
                        this.matrixPos = pos;
                    } else {
                        this.matrixPos = 'ALL';
                    }
                    this.$nextTick(() => {
                        const refreshed = this.matrixChartData?.players?.find(p => (matcher ? matcher.normalizeName(p.name) : (p.name || '').toLowerCase().trim()) === norm);
                        if (refreshed) {
                            this.selectMatrixPlayer(refreshed);
                            this.scrollToMatrixChart();
                        }
                    });
                    return;
                }
            }

            if (found) {
                this.selectMatrixPlayer(found);
                this.scrollToMatrixChart();
            }
        },

        scrollToMatrixChart() {
            this.$nextTick(() => {
                const el = (typeof document !== 'undefined') ? document.querySelector('.matrix-chart-container') : null;
                if (el && el.scrollIntoView) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
        },

        /**
         * Solves optimal starting lineup and generates position columns.
         */
        optimize() {
            if (!this.ownerId) return;

            const { optimalLineup, fullBench, benchAlerts, opinionatedMoves } = OptimizerService.solveLineup(
                this.allRankedPlayers,
                this.startingSlots,
                this.ownerId,
                this.flex
            );

            this.optimalLineup = optimalLineup;
            this.fullBench = fullBench;
            this.benchAlerts = benchAlerts;
            this.opinionatedMoves = opinionatedMoves || null;

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
