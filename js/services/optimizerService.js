/**
 * OptimizerService: Pure, deterministic fantasy football lineup solver and bench alerts.
 */

const OptimizerService = {
    // Free agents must beat the best rostered option by this many rank spots before a PICKUP is suggested,
    // so the app doesn't churn the waiver wire over coin-flip differences (especially K/DST streaming).
    PICKUP_MARGIN: { QB: 2, RB: 2, WR: 2, TE: 2, K: 3, DST: 3, FLEX: 3 },

    // Approximate number of startable players per position in a 12-team league, used to put
    // positional ranks on a comparable scale when choosing which player to drop.
    POSITION_DEPTH: { QB: 12, RB: 24, WR: 30, TE: 12, K: 12, DST: 12 },

    // Flex slot eligibility. FLX follows the league-level flex toggle; the others are fixed by the slot type.
    // Filled narrowest-first so wide slots (superflex) get whoever is left.
    FLEX_SLOT_ORDER: ['REC', 'WRRB', 'FLX', 'SFLX'],

    getFlexEligibility(slot, flexType) {
        if (slot === 'FLX') return (flexType === 'WR') ? ['RB', 'WR'] : ['RB', 'WR', 'TE'];
        if (slot === 'WRRB') return ['RB', 'WR'];
        if (slot === 'REC') return ['WR', 'TE'];
        if (slot === 'SFLX') return ['QB', 'RB', 'WR', 'TE'];
        return [];
    },

    normalizeSlot(slot) {
        if (slot === 'FLX' || slot === 'W/R/T' || slot === 'FLEX') return 'FLX';
        if (slot === 'W/R' || slot === 'WRRB_FLEX') return 'WRRB';
        if (slot === 'W/T' || slot === 'REC_FLEX') return 'REC';
        if (slot === 'SUPER_FLEX' || slot === 'OP' || slot === 'Q/W/R/T') return 'SFLX';
        return slot;
    },

    /**
     * Estimates weekly fantasy points from FantasyPros projections, falling back to a rank-based curve.
     */
    estimatePoints(p) {
        if (!p) return 0;
        if (typeof p.pts === 'number' && p.pts > 0) return p.pts;
        const pos = p.position || p.slot;
        const r = (p.rank > 0) ? p.rank : 30;
        if (pos === 'QB') return Math.max(8, +(26 - r * 0.45).toFixed(1));
        if (pos === 'DST' || pos === 'K') return Math.max(3, +(12 - r * 0.28).toFixed(1));
        return Math.max(3, +(22 - r * 0.35).toFixed(1));
    },

    /**
     * Roster value used to pick drops: higher means more expendable. ROS rank dominates, weekly rank breaks ties.
     */
    dropScore(p) {
        const depth = this.POSITION_DEPTH[p.position] || 24;
        const hasRos = typeof p.rosRank === 'number' && p.rosRank > 0;
        const ros = hasRos ? p.rosRank / depth : 5;
        // A missing weekly rank (bye week, injury) is neutral for a player who still has ROS value
        const weekly = (typeof p.rank === 'number' && p.rank > 0) ? p.rank / depth : ros;
        return ros + weekly * 0.25;
    },

    /**
     * Solves the optimal starting lineup based on league starting slots and FantasyPros ranks.
     * 
     * @param {Array} players - All ranked players (rostered players carry onRoster = team id, free agents onRoster = 0)
     * @param {Array} startingSlots - Array of required starting positions e.g. ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DST']
     * @param {string|number} ownerId - Current team/owner ID
     * @param {string} flexType - 'WRT' (RB/WR/TE) or 'WR' (RB/WR), applies to FLX slots
     * @param {Object} options - { includeFreeAgents: false } disables PICKUP/DROP suggestions
     *                           (used when other teams' rosters are unknown, e.g. Yahoo paste mode)
     * @returns {Object} { optimalLineup, fullBench, benchAlerts, opinionatedMoves }
     */
    solveLineup(players, startingSlots, ownerId, flexType = 'WRT', options = {}) {
        if (!players || !Array.isArray(players) || !startingSlots || !Array.isArray(startingSlots)) {
            return { optimalLineup: [], fullBench: [], benchAlerts: [] };
        }
        const includeFreeAgents = options.includeFreeAgents !== false;

        // 1. Separate user's team players and unrostered free agents
        const myTeamPlayers = players.filter(p => p.onRoster == ownerId);
        const freeAgents = includeFreeAgents
            ? players.filter(p => p.onRoster === 0 && (p.rank > -1 || p.flxRank > -1))
            : [];
        const availableCandidates = [...myTeamPlayers.filter(p => p.rank > -1 || p.flxRank > -1), ...freeAgents];

        // Group required slots
        const fixedSlots = [];
        const flexSlotCounts = {};
        for (const rawSlot of startingSlots) {
            const slot = this.normalizeSlot(rawSlot);
            if (this.FLEX_SLOT_ORDER.includes(slot)) {
                flexSlotCounts[slot] = (flexSlotCounts[slot] || 0) + 1;
            } else if (slot !== 'BN' && slot !== 'IR') {
                fixedSlots.push(slot);
            }
        }

        const assignedPlayers = new Set();
        const optimalLineup = [];
        const pickupsAssigned = [];
        const labels = (typeof CONFIG !== 'undefined' && CONFIG.SLOT_LABELS) ? CONFIG.SLOT_LABELS : {};

        const pushStarter = (slot, chosen, displayRank) => {
            assignedPlayers.add(chosen);
            const isPickup = (chosen.onRoster === 0);
            if (isPickup) pickupsAssigned.push(chosen);

            let highlight = 'ok';
            let badge = '';
            let bgColor = 'transparent';
            if (isPickup) {
                highlight = 'pickup';
                badge = 'PICKUP';
                bgColor = '#ecfdf5';
            } else if (!chosen.starter) {
                highlight = 'start';
                badge = 'START';
                bgColor = '#e8f4fd';
            }

            optimalLineup.push({
                slot,
                slotLabel: labels[slot] || slot,
                name: chosen.name,
                position: chosen.position,
                rank: displayRank,
                starter: chosen.starter,
                onRoster: chosen.onRoster,
                highlight,
                badge,
                backgroundColor: bgColor
            });
        };

        const pushEmpty = (slot) => {
            optimalLineup.push({
                slot,
                slotLabel: labels[slot] || slot,
                name: '(Empty Slot)',
                position: slot,
                rank: '-',
                starter: false,
                onRoster: ownerId,
                highlight: 'none',
                badge: '',
                backgroundColor: 'transparent'
            });
        };

        // Order fixed slots logically: QB, RB, WR, TE, K, DST
        const positionPriority = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
        const slotCounts = {};
        for (const slot of fixedSlots) {
            slotCounts[slot] = (slotCounts[slot] || 0) + 1;
        }

        // 1. Assign fixed position slots
        for (const pos of positionPriority) {
            const count = slotCounts[pos] || 0;
            if (count === 0) continue;

            const margin = this.PICKUP_MARGIN[pos] || 2;
            const sortKey = p => p.rank + (p.onRoster === 0 ? margin : 0);
            const candidates = availableCandidates
                .filter(p => p.position === pos && p.rank > -1 && !assignedPlayers.has(p))
                .sort((a, b) => sortKey(a) - sortKey(b));

            for (let i = 0; i < count; i++) {
                if (i < candidates.length) {
                    pushStarter(pos, candidates[i], candidates[i].rank);
                } else {
                    pushEmpty(pos);
                }
            }
        }

        // 2. Assign Flex slots (narrowest eligibility first)
        const flexRankOf = p => (p.flxRank > -1 ? p.flxRank : (p.rank + 50));
        for (const slot of this.FLEX_SLOT_ORDER) {
            const count = flexSlotCounts[slot] || 0;
            if (count === 0) continue;

            const eligible = this.getFlexEligibility(slot, flexType);
            let candidates = availableCandidates
                .filter(p => eligible.includes(p.position) && !assignedPlayers.has(p) && (p.flxRank > -1 || p.rank > -1));

            if (slot === 'SFLX') {
                // QBs and skill players have no shared ranking, so compare on projected points
                const ptsKey = p => this.estimatePoints(p) - (p.onRoster === 0 ? 1 : 0);
                candidates = candidates.sort((a, b) => ptsKey(b) - ptsKey(a));
            } else {
                const sortKey = p => flexRankOf(p) + (p.onRoster === 0 ? this.PICKUP_MARGIN.FLEX : 0);
                candidates = candidates.sort((a, b) => sortKey(a) - sortKey(b));
            }

            for (let i = 0; i < count; i++) {
                if (i < candidates.length) {
                    const chosen = candidates[i];
                    const displayRank = (chosen.position !== 'QB' && chosen.flxRank > -1) ? chosen.flxRank : chosen.rank;
                    pushStarter(slot, chosen, displayRank);
                } else {
                    pushEmpty(slot);
                }
            }
        }

        // 3. Build Full Bench for user's team
        const fullBench = [];
        const notStarting = myTeamPlayers.filter(p => !assignedPlayers.has(p));

        // Pair each pickup with the most expendable roster player. K/DST pickups are paired first and
        // prefer dropping a redundant player at the same position (e.g. swap one DST for another).
        const dropFor = new Map(); // roster player -> pickup
        const pickupOrder = [...pickupsAssigned].sort((a, b) => {
            const aSpecial = (a.position === 'K' || a.position === 'DST') ? 0 : 1;
            const bSpecial = (b.position === 'K' || b.position === 'DST') ? 0 : 1;
            return aSpecial - bSpecial;
        });
        for (const pk of pickupOrder) {
            const remaining = notStarting.filter(p => !dropFor.has(p));
            if (remaining.length === 0) break;
            const samePos = remaining.filter(p => p.position === pk.position);
            const pool = ((pk.position === 'K' || pk.position === 'DST') && samePos.length > 0) ? samePos : remaining;
            const drop = pool.reduce((worst, p) => (this.dropScore(p) > this.dropScore(worst) ? p : worst), pool[0]);
            dropFor.set(drop, pk);
            const optMatch = optimalLineup.find(o => o.name === pk.name && o.highlight === 'pickup');
            if (optMatch) optMatch.targetDrop = drop.name;
        }

        for (const p of notStarting) {
            const pk = dropFor.get(p);
            const isDrop = !!pk;
            let highlight = 'none';
            let badge = '';
            let bgColor = 'transparent';
            if (isDrop) {
                highlight = 'drop';
                badge = 'DROP';
                bgColor = '#fef2f2';
            } else if (p.starter) {
                highlight = 'bench';
                badge = 'BENCH';
                bgColor = '#fde8e8';
            }

            fullBench.push({
                slot: 'BN',
                name: p.name,
                position: p.position,
                rank: p.rank > -1 ? p.rank : (p.flxRank > -1 ? p.flxRank : '-'),
                flxRank: p.flxRank,
                starter: !!p.starter,
                highlight,
                badge,
                targetPickup: isDrop ? pk.name : null,
                backgroundColor: bgColor
            });
        }

        // Sort full bench: drops and benchings first, then by rank
        fullBench.sort((a, b) => {
            const priorityOrder = { 'drop': 1, 'bench': 2, 'none': 3 };
            const prioDiff = (priorityOrder[a.highlight] || 3) - (priorityOrder[b.highlight] || 3);
            if (prioDiff !== 0) return prioDiff;
            const rankA = typeof a.rank === 'number' ? a.rank : 999;
            const rankB = typeof b.rank === 'number' ? b.rank : 999;
            return rankA - rankB;
        });

        const benchAlerts = fullBench.filter(p => p.highlight === 'drop' || p.highlight === 'bench');

        // 4. Compute Opinionated Recommendations & Confidence Values
        const playerLookup = new Map();
        for (const p of players) {
            const norm = (p.name || '').toLowerCase().trim();
            if (norm && !playerLookup.has(norm)) {
                playerLookup.set(norm, p);
            }
        }

        for (const optItem of optimalLineup) {
            if (optItem.highlight === 'pickup') {
                const dropMatch = optItem.targetDrop ? fullBench.find(b => b.name === optItem.targetDrop) : null;
                const fullDrop = dropMatch ? (playerLookup.get(dropMatch.name.toLowerCase().trim()) || dropMatch) : null;
                const fullPickup = playerLookup.get(optItem.name.toLowerCase().trim()) || optItem;
                const conf = this.evaluateMoveConfidence(fullPickup, fullDrop, true);
                Object.assign(optItem, conf);
            } else if (optItem.highlight === 'start') {
                const displaced = fullBench.find(b => b.highlight === 'bench' && b.position === optItem.position);
                const fullDisplaced = displaced ? (playerLookup.get(displaced.name.toLowerCase().trim()) || displaced) : null;
                const fullStart = playerLookup.get(optItem.name.toLowerCase().trim()) || optItem;
                const conf = this.evaluateMoveConfidence(fullStart, fullDisplaced, false);
                Object.assign(optItem, conf);
            } else if (optItem.highlight === 'ok') {
                const fullStarter = playerLookup.get(optItem.name.toLowerCase().trim()) || optItem;
                const conf = this.evaluateStarterConfidence(fullStarter);
                Object.assign(optItem, conf);
            }
        }

        for (const benchItem of fullBench) {
            const fullDrop = playerLookup.get(benchItem.name.toLowerCase().trim()) || benchItem;
            if (benchItem.highlight === 'drop') {
                const pickupMatch = benchItem.targetPickup ? optimalLineup.find(o => o.name === benchItem.targetPickup) : null;
                const fullPickup = pickupMatch ? (playerLookup.get(pickupMatch.name.toLowerCase().trim()) || pickupMatch) : null;
                const conf = this.evaluateDropConfidence(fullDrop, fullPickup);
                Object.assign(benchItem, conf);
            } else {
                const dRos = (typeof fullDrop.rosRank === 'number' && fullDrop.rosRank > 0) ? fullDrop.rosRank : (fullDrop.rosFlxRank > 0 ? fullDrop.rosFlxRank : null);
                if (dRos && dRos <= 35) {
                    benchItem.isStashWarning = true;
                    benchItem.stashNote = `✦ Key ROS Stash (#${dRos} ROS). Priority hold on your bench.`;
                }
            }
        }

        const mustAdds = optimalLineup.filter(p => p.highlight === 'pickup' && p.confidenceTier === 'MUST ADD');
        const strongAdds = optimalLineup.filter(p => p.highlight === 'pickup' && p.confidenceTier === 'STRONG ADD');
        const mustDrops = fullBench.filter(p => p.highlight === 'drop' && p.confidenceTier === 'MUST DROP');
        const strongDrops = fullBench.filter(p => p.highlight === 'drop' && p.confidenceTier === 'STRONG DROP');
        const stashWarnings = fullBench.filter(p => p.isStashWarning);

        const opinionatedMoves = {
            mustAdds,
            strongAdds,
            mustDrops,
            strongDrops,
            stashWarnings,
            urgentCount: mustAdds.length + mustDrops.length,
            hasUrgentMoves: (mustAdds.length > 0 || mustDrops.length > 0)
        };

        return {
            optimalLineup,
            fullBench,
            benchAlerts,
            opinionatedMoves
        };
    },

    /**
     * Evaluates confidence score (0-100) and opinionated verdict for a starting/pickup move.
     */
    evaluateMoveConfidence(pickup, drop, isFreeAgentPickup = true) {
        if (!pickup) return null;

        const pRank = (typeof pickup.rank === 'number' && pickup.rank > 0) ? pickup.rank : 99;
        const dRank = drop ? ((typeof drop.rank === 'number' && drop.rank > 0) ? drop.rank : 99) : 99;
        const rankDelta = dRank - pRank;

        const getEstPts = (p) => this.estimatePoints(p);

        const pPts = getEstPts(pickup);
        const dPts = drop ? getEstPts(drop) : 0;
        const ptsDelta = +(pPts - dPts).toFixed(1);

        let score = 50;

        // 1. Weekly Rank Delta
        if (rankDelta >= 15) score += 28;
        else if (rankDelta >= 10) score += 20;
        else if (rankDelta >= 5) score += 12;
        else if (rankDelta >= 2) score += 5;
        else if (rankDelta <= 0) score -= 15;

        // 2. Projected Points
        if (ptsDelta >= 4.0) score += 18;
        else if (ptsDelta >= 2.5) score += 12;
        else if (ptsDelta >= 1.0) score += 6;

        // 3. Absolute tier of player
        if (pRank <= 5) score += 10;
        else if (pRank <= 12) score += 5;

        // 4. Expert consensus agreement
        let consensusNote = '';
        if (pickup.minRank && pickup.maxRank && drop && drop.minRank && drop.maxRank) {
            if (pickup.maxRank < drop.minRank) {
                score += 10;
                consensusNote = 'Unanimous expert consensus';
            } else if (pickup.minRank > drop.maxRank) {
                score -= 15;
                consensusNote = 'High expert disagreement';
            } else {
                consensusNote = 'Solid expert agreement';
            }
        }

        // 5. Rest of Season (ROS) Preservation
        let rosNote = '';
        let isStashWarning = false;
        if (drop) {
            const dRos = (typeof drop.rosRank === 'number' && drop.rosRank > 0) ? drop.rosRank : (drop.rosFlxRank > 0 ? drop.rosFlxRank : null);
            const pRos = (typeof pickup.rosRank === 'number' && pickup.rosRank > 0) ? pickup.rosRank : (pickup.rosFlxRank > 0 ? pickup.rosFlxRank : null);

            if (dRos && dRos <= 35 && (!pRos || pRos > dRos + 20)) {
                score -= 22; // High penalty for dropping valuable long-term asset
                isStashWarning = true;
                rosNote = `⚠️ Caution: ${drop.name} is a high-value ROS stash (#${dRos} ROS)`;
            } else if (pRos && dRos && pRos < dRos) {
                score += 8;
                rosNote = `Upgrades both Weekly (#${pRank} vs #${dRank}) and ROS (#${pRos} vs #${dRos})`;
            } else if (!dRos || dRos > 60) {
                score += 6;
                rosNote = 'Safe drop with minimal ROS penalty';
            }
        }

        const confidence = Math.max(40, Math.min(98, Math.round(score)));

        let tier = 'CONSIDER';
        let badgeText = 'CONSIDER';
        let rationale = '';

        if (confidence >= 85) {
            tier = isFreeAgentPickup ? 'MUST ADD' : 'MUST START';
            badgeText = isFreeAgentPickup ? '★ MUST ADD' : 'MUST START';
            rationale = `Slam-dunk upgrade (+${rankDelta > 0 ? rankDelta : 0} spots${drop ? ' over ' + drop.name : ''}). ${consensusNote || 'Clear tier jump'}.`;
        } else if (confidence >= 70) {
            tier = isFreeAgentPickup ? 'STRONG ADD' : 'STRONG START';
            badgeText = isFreeAgentPickup ? 'STRONG ADD' : 'STRONG START';
            rationale = `Strong play (+${rankDelta > 0 ? rankDelta : 0} spots${drop ? ' over ' + drop.name : ''}). ${rosNote || consensusNote || 'Solid weekly advantage'}.`;
        } else if (confidence >= 55) {
            tier = isFreeAgentPickup ? 'LEAN ADD' : 'SOLID START';
            badgeText = isFreeAgentPickup ? 'LEAN ADD' : 'SOLID START';
            rationale = `Moderate upside (+${rankDelta > 0 ? rankDelta : 0} spots). ${isStashWarning ? rosNote : 'Consider matchup and league depth'}.`;
        } else {
            tier = isFreeAgentPickup ? 'SPECULATIVE' : 'BORDERLINE';
            badgeText = isFreeAgentPickup ? 'SPECULATIVE' : 'BORDERLINE';
            rationale = `Marginal upgrade (+${rankDelta > 0 ? rankDelta : 0} spots). ${isStashWarning ? rosNote : 'Coin-flip vs existing option'}.`;
        }

        return {
            confidence,
            confidenceTier: tier,
            confidenceBadge: `${badgeText} (${confidence}%)`,
            confidenceShortBadge: badgeText,
            rankDelta,
            ptsDelta,
            rationale,
            isStashWarning
        };
    },

    /**
     * Evaluates confidence score (0-100) and opinionated verdict for a drop candidate.
     */
    evaluateDropConfidence(drop, pickup) {
        if (!drop) return null;

        const dRank = (typeof drop.rank === 'number' && drop.rank > 0) ? drop.rank : 99;
        const dRos = (typeof drop.rosRank === 'number' && drop.rosRank > 0) ? drop.rosRank : (drop.rosFlxRank > 0 ? drop.rosFlxRank : null);

        let score = 55;

        // 1. Weekly rank
        if (dRank >= 35) score += 20;
        else if (dRank >= 25) score += 12;
        else if (dRank <= 15) score -= 20;

        // 2. ROS value check (critical for drop decisions)
        let isStashWarning = false;
        let rationale = '';
        if (dRos && dRos <= 30) {
            score -= 30;
            isStashWarning = true;
            rationale = `High-value stash (#${dRos} ROS). Look for an alternative drop before cutting.`;
        } else if (!dRos || dRos > 65) {
            score += 20;
            rationale = `Low ROS equity (#${dRos || 'unranked'} ROS). Safe, low-risk drop candidate.`;
        } else {
            rationale = `Modest ROS value (#${dRos} ROS). Safe drop to fund starting lineup upgrade.`;
        }

        if (pickup) {
            score += 10;
            rationale = `Displaced for ${pickup.name}. ${rationale}`;
        }

        const confidence = Math.max(35, Math.min(96, Math.round(score)));

        let tier = 'CONSIDER';
        let badgeText = 'CONSIDER';
        if (confidence >= 85) {
            tier = 'MUST DROP';
            badgeText = '✕ MUST DROP';
        } else if (confidence >= 70) {
            tier = 'STRONG DROP';
            badgeText = 'STRONG DROP';
        } else if (confidence >= 55) {
            tier = 'SOFT DROP';
            badgeText = 'SOFT DROP';
        } else {
            tier = 'HOLD / CAUTION';
            badgeText = 'HOLD / CAUTION';
        }

        return {
            confidence,
            confidenceTier: tier,
            confidenceBadge: `${badgeText} (${confidence}%)`,
            confidenceShortBadge: badgeText,
            rationale,
            isStashWarning
        };
    },

    /**
     * Evaluates starting confidence for locked starters.
     */
    evaluateStarterConfidence(player) {
        if (!player) return null;
        const rank = (typeof player.rank === 'number' && player.rank > 0) ? player.rank : (player.flxRank > 0 ? player.flxRank : 30);
        
        let confidence = 50;
        let tier = 'BORDERLINE';
        let badgeText = 'BORDERLINE';
        let rationale = '';

        if (rank <= 6) {
            confidence = 98;
            tier = 'MUST START';
            badgeText = '★ MUST START';
            rationale = `Elite Tier 1 starter (#${rank}). Lock into your lineup with complete confidence.`;
        } else if (rank <= 14) {
            confidence = 88;
            tier = 'STRONG START';
            badgeText = 'STRONG START';
            rationale = `Solid top-tier starter (#${rank}). High weekly floor and ceiling.`;
        } else if (rank <= 22) {
            confidence = 72;
            tier = 'SOLID START';
            badgeText = 'SOLID START';
            rationale = `Viable starter (#${rank}). Favorable start in standard formats.`;
        } else {
            confidence = 58;
            tier = 'BORDERLINE';
            badgeText = 'BORDERLINE';
            rationale = `Volatile starter (#${rank}). Check waiver wire or bench for streaming options.`;
        }

        return {
            confidence,
            confidenceTier: tier,
            confidenceBadge: `${badgeText} (${confidence}%)`,
            confidenceShortBadge: badgeText,
            rationale,
            isStashWarning: false
        };
    },

    /**
     * Builds position ranking columns (top 10 players for each position).
     */
    buildPositionColumns(players, ownerId, flexType = 'WRT', pickupPlayerNames = null) {
        const positions = ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST'];
        const columns = {};

        // Helper to check pickup status
        let matcher = (typeof PlayerMatcher !== 'undefined') ? PlayerMatcher : null;
        if (!matcher && typeof require !== 'undefined') {
            try { matcher = require('../playerMatcher.js'); } catch (e) {}
        }

        const isPickup = (name) => {
            if (!pickupPlayerNames || !name) return false;
            const norm = matcher ? matcher.normalizeName(name) : name.toLowerCase().trim();
            return pickupPlayerNames.has(norm);
        };

        for (const pos of positions) {
            let eligiblePositions = [pos];
            let rankField = 'rank';

            if (pos === 'FLX') {
                eligiblePositions = (flexType === 'WR') ? ['RB', 'WR'] : ['RB', 'WR', 'TE'];
                rankField = 'flxRank';
            }

            const filtered = players
                .filter(p => eligiblePositions.includes(p.position) && p[rankField] > -1 && (p.onRoster == ownerId || p.onRoster === 0))
                .sort((a, b) => a[rankField] - b[rankField])
                .slice(0, 10);

            columns[pos] = {
                position: pos,
                players: filtered.map(p => ({
                    name: p.name,
                    rank: p[rankField],
                    flxRank: p.flxRank,
                    onRoster: p.onRoster,
                    isPickup: isPickup(p.name)
                }))
            };
        }

        return columns;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = OptimizerService;
}
