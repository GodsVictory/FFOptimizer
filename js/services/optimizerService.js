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
            if (tokenIndex !== -1) {
                isDrop = true;
                dropTokens.splice(tokenIndex, 1);
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
                backgroundColor: isDrop ? '#fef2f2' : '#fde8e8'
            });
        }

        // Normal bench players
        for (const p of normalBench) {
            fullBench.push({
                slot: 'BN',
                name: p.name,
                position: p.position,
                rank: p.rank > -1 ? p.rank : (p.flxRank > -1 ? p.flxRank : '-'),
                flxRank: p.flxRank,
                starter: false,
                highlight: 'none',
                badge: '',
                backgroundColor: 'transparent'
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

        return {
            optimalLineup,
            fullBench,
            benchAlerts
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
