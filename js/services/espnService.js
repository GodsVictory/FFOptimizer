/**
 * EspnService: Handles fetching ESPN public league rosters, settings, and team owners.
 */

const EspnService = {
    /**
     * Loads ESPN league settings, rosters, and teams concurrently.
     */
    async loadLeagueData(leagueId, season = new Date().getFullYear()) {
        if (!leagueId) {
            throw new Error('Please enter an ESPN League ID');
        }

        const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?view=mSettings&view=mRoster&view=mTeam`;

        let res;
        try {
            res = await axios.get(url);
        } catch (err) {
            console.error('ESPN API error:', err);
            throw new Error('Could not load ESPN league. Please check the League ID and ensure the league is set to Public.');
        }

        const data = res.data;
        if (!data || !data.settings || !data.teams) {
            throw new Error('Incomplete data returned by ESPN API. Is the league public?');
        }

        const slotMap = (typeof CONFIG !== 'undefined' && CONFIG.ESPN_SLOT_MAP) 
            ? CONFIG.ESPN_SLOT_MAP 
            : { 0: 'QB', 2: 'RB', 3: 'FLX', 4: 'WR', 6: 'TE', 16: 'DST', 17: 'K' };

        const posMap = (typeof CONFIG !== 'undefined' && CONFIG.ESPN_POS_MAP) 
            ? CONFIG.ESPN_POS_MAP 
            : { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' };

        // 1. Parse starting roster slots from lineupSlotCounts
        const startingSlots = [];
        const slotCounts = data.settings.rosterSettings && data.settings.rosterSettings.lineupSlotCounts;
        if (slotCounts) {
            for (const [slotId, count] of Object.entries(slotCounts)) {
                const pos = slotMap[slotId];
                if (pos && pos !== 'BN' && pos !== 'IR') {
                    for (let i = 0; i < count; i++) {
                        startingSlots.push(pos);
                    }
                }
            }
        }

        // 2. Parse Owners/Teams
        const owners = [];
        for (const team of data.teams) {
            let teamName = team.name;
            if (!teamName) {
                const location = (team.location || '').trim();
                const nickname = (team.nickname || '').trim();
                teamName = (location + ' ' + nickname).trim() || team.abbrev || `Team ${team.id}`;
            }

            owners.push({
                id: team.id,
                owner: teamName
            });
        }
        owners.sort((a, b) => a.owner.localeCompare(b.owner));

        // 3. Parse Rostered Players
        const rosteredPlayers = [];
        for (const team of data.teams) {
            const teamId = team.id;
            const entries = (team.roster && team.roster.entries) || [];

            for (const entry of entries) {
                const playerObj = entry.playerPoolEntry && entry.playerPoolEntry.player;
                if (!playerObj) continue;

                const defaultPosId = playerObj.defaultPositionId;
                const position = posMap[defaultPosId];
                if (!position) continue; // skip unrecognized positions

                const fullName = (playerObj.fullName || '').replace(/\./g, '');
                // In ESPN, slot ID < 20 indicates an active starting slot (not bench/IR)
                const isStarter = entry.lineupSlotId < 20;

                rosteredPlayers.push({
                    id: playerObj.id ? String(playerObj.id) : false,
                    name: fullName,
                    position: position,
                    onRoster: teamId,
                    starter: isStarter,
                    rank: -1,
                    flxRank: -1
                });
            }
        }

        return {
            startingSlots,
            owners,
            rosteredPlayers
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EspnService;
}
