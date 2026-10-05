/**
 * OptimizerService: Pure, deterministic fantasy football lineup solver and bench alerts.
 */

const OptimizerService = {
    /**
     * Solves the optimal starting lineup based on league starting slots and FantasyPros ranks.
     * 
     * @param {Array} rosteredPlayers - All players (filtered to team or with onRoster property)
     * @param {Array} startingSlots - Array of required starting positions e.g. ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DST']
     * @param {string|number} ownerId - Current team/owner ID
     * @param {string} flexType - 'WRT' (RB/WR/TE) or 'WR' (RB/WR)
     * @returns {Object} { optimalLineup, benchAlerts }
     */
    solveLineup(players, startingSlots, ownerId, flexType = 'WRT') {
        if (!players || !Array.isArray(players) || !startingSlots || !Array.isArray(startingSlots)) {
            return { optimalLineup: [], fullBench: [], benchAlerts: [] };
        }

        // 1. Separate user's team players and unrostered free agents
        const myTeamPlayers = players.filter(p => p.onRoster == ownerId);
        const freeAgents = players.filter(p => p.onRoster === 0 && (p.rank > -1 || p.flxRank > -1));
        const availableCandidates = [...myTeamPlayers.filter(p => p.rank > -1 || p.flxRank > -1), ...freeAgents];

        // Group required slots
        const fixedSlots = [];
        const flexSlots = [];
        for (const slot of startingSlots) {
            if (slot === 'FLX' || slot === 'W/R/T' || slot === 'W/R' || slot === 'FLEX') {
                flexSlots.push('FLX');
            } else if (slot !== 'BN' && slot !== 'IR') {
                fixedSlots.push(slot);
            }
        }

        const assignedPlayerNames = new Set();
        const optimalLineup = [];
        const pickupsAssigned = [];

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

            const candidates = availableCandidates
                .filter(p => p.position === pos && p.rank > -1 && !assignedPlayerNames.has(p.name))
                .sort((a, b) => a.rank - b.rank);

            for (let i = 0; i < count; i++) {
                if (i < candidates.length) {
                    const chosen = candidates[i];
                    assignedPlayerNames.add(chosen.name);

                    const isPickup = (chosen.onRoster === 0);
                    if (isPickup) {
                        pickupsAssigned.push(chosen);
                    }

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
                        slot: pos,
                        name: chosen.name,
                        position: chosen.position,
                        rank: chosen.rank,
                        starter: chosen.starter,
                        onRoster: chosen.onRoster,
                        highlight: highlight,
                        badge: badge,
                        backgroundColor: bgColor
                    });
                } else {
                    // Empty starting slot
                    optimalLineup.push({
                        slot: pos,
                        name: '(Empty Slot)',
                        position: pos,
                        rank: '-',
                        starter: false,
                        onRoster: ownerId,
                        highlight: 'none',
                        badge: '',
                        backgroundColor: 'transparent'
                    });
                }
            }
        }

        // 2. Assign Flex slots
        const flexEligiblePositions = (flexType === 'WR') ? ['RB', 'WR'] : ['RB', 'WR', 'TE'];

        const flexCandidates = availableCandidates
            .filter(p => flexEligiblePositions.includes(p.position) && !assignedPlayerNames.has(p.name) && (p.flxRank > -1 || p.rank > -1))
            .sort((a, b) => {
                const rankA = a.flxRank > -1 ? a.flxRank : (a.rank + 50);
                const rankB = b.flxRank > -1 ? b.flxRank : (b.rank + 50);
                return rankA - rankB;
            });

        for (let i = 0; i < flexSlots.length; i++) {
            if (i < flexCandidates.length) {
                const chosen = flexCandidates[i];
                assignedPlayerNames.add(chosen.name);

                const isPickup = (chosen.onRoster === 0);
                if (isPickup) {
                    pickupsAssigned.push(chosen);
                }

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
                    slot: 'FLX',
                    name: chosen.name,
                    position: chosen.position,
                    rank: chosen.flxRank > -1 ? chosen.flxRank : chosen.rank,
                    starter: chosen.starter,
                    onRoster: chosen.onRoster,
                    highlight: highlight,
                    badge: badge,
                    backgroundColor: bgColor
                });
            } else {
                optimalLineup.push({
                    slot: 'FLX',
                    name: '(Empty Slot)',
                    position: 'FLX',
                    rank: '-',
                    starter: false,
                    onRoster: ownerId,
                    highlight: 'none',
                    badge: '',
                    backgroundColor: 'transparent'
                });
            }
        }

        // 3. Build Full Bench for user's team
        const fullBench = [];
        const displacedStarters = myTeamPlayers.filter(p => p.starter && !assignedPlayerNames.has(p.name));
        const normalBench = myTeamPlayers.filter(p => !p.starter && !assignedPlayerNames.has(p.name));

        // Sort displaced starters worst-ranked first to pair worst starters with drops
        displacedStarters.sort((a, b) => {
            const rankA = typeof a.rank === 'number' && a.rank > -1 ? a.rank : 999;
            const rankB = typeof b.rank === 'number' && b.rank > -1 ? b.rank : 999;
            return rankB - rankA;
        });

        // Track available pickup tokens to pair 1-to-1 with drops
        const dropTokens = [...pickupsAssigned];

        // Starters displaced by better bench players or free agent pickups
        for (const p of displacedStarters) {
            // Check if there was a free agent pickup at this position (or flex)
            const tokenIndex = dropTokens.findIndex(pk => 
                pk.position === p.position || 
                (['RB', 'WR', 'TE'].includes(p.position) && ['RB', 'WR', 'TE'].includes(pk.position))
            );

            let isDrop = false;
            let targetPickup = null;
            if (tokenIndex !== -1) {
                isDrop = true;
                const pk = dropTokens.splice(tokenIndex, 1)[0];
                targetPickup = pk.name;
                const optMatch = optimalLineup.find(o => o.name === pk.name);
                if (optMatch) {
                    optMatch.targetDrop = p.name;
                }
            }

            fullBench.push({
                slot: 'BN',
                name: p.name,
                position: p.position,
                rank: p.rank > -1 ? p.rank : (p.flxRank > -1 ? p.flxRank : '-'),
                flxRank: p.flxRank,
                starter: true,
                highlight: isDrop ? 'drop' : 'bench',
                badge: isDrop ? 'DROP' : 'BENCH',
                targetPickup: targetPickup,
                backgroundColor: isDrop ? '#fef2f2' : '#fde8e8'
            });
        }

        // Normal bench players
        // Sort normal bench worst-ranked first to pair any remaining drop tokens with lowest-value bench players
        normalBench.sort((a, b) => {
            const rankA = typeof a.rank === 'number' && a.rank > -1 ? a.rank : (a.flxRank > -1 ? a.flxRank : 999);
            const rankB = typeof b.rank === 'number' && b.rank > -1 ? b.rank : (b.flxRank > -1 ? b.flxRank : 999);
            return rankB - rankA;
        });

        for (const p of normalBench) {
            let isDrop = false;
            let targetPickup = null;
            if (dropTokens.length > 0) {
                isDrop = true;
                const pk = dropTokens.shift();
                targetPickup = pk.name;
                const optMatch = optimalLineup.find(o => o.name === pk.name);
                if (optMatch && !optMatch.targetDrop) {
                    optMatch.targetDrop = p.name;
                }
            }

            fullBench.push({
                slot: 'BN',
                name: p.name,
                position: p.position,
                rank: p.rank > -1 ? p.rank : (p.flxRank > -1 ? p.flxRank : '-'),
                flxRank: p.flxRank,
                starter: false,
                highlight: isDrop ? 'drop' : 'none',
                badge: isDrop ? 'DROP' : '',
                targetPickup: targetPickup,
                backgroundColor: isDrop ? '#fef2f2' : 'transparent'
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

        const getEstPts = (p) => {
            if (!p) return 0;
            if (typeof p.pts === 'number' && p.pts > 0) return p.pts;
            const pos = p.position || p.slot;
            const r = (p.rank > 0) ? p.rank : 30;
            if (pos === 'QB') return Math.max(8, +(26 - r * 0.45).toFixed(1));
            if (pos === 'DST' || pos === 'K') return Math.max(3, +(12 - r * 0.28).toFixed(1));
            return Math.max(3, +(22 - r * 0.35).toFixed(1));
        };

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
