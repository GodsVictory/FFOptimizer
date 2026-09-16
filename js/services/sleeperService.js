/**
 * SleeperService: High-performance Sleeper API client with batch requests and caching.
 */

const SleeperService = {
    _playersDb: null,

    /**
     * Loads the local Sleeper player database (maps sleeper player_id to sportradar_id/name/pos).
     * Cached in memory for speed.
     */
    async getPlayersDb() {
        if (this._playersDb) {
            return this._playersDb;
        }
        try {
            const res = await axios.get('data/sleeperPlayers.json');
            this._playersDb = res.data || {};
            return this._playersDb;
        } catch (err) {
            console.error('Failed to load data/sleeperPlayers.json:', err);
            return {};
        }
    },

    /**
     * Fetches all required Sleeper league data in parallel.
     * Uses the bulk /league/{id}/users endpoint instead of individual user calls.
     */
    async loadLeagueData(leagueId) {
        if (!leagueId) {
            throw new Error('Please enter a Sleeper League ID');
        }

        // Parallel fetch of league metadata, rosters, league users, and local players DB
        const [leagueRes, rostersRes, usersRes, playersDb] = await Promise.all([
            axios.get(`https://api.sleeper.app/v1/league/${leagueId}`),
            axios.get(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
            axios.get(`https://api.sleeper.app/v1/league/${leagueId}/users`).catch(() => ({ data: [] })),
            this.getPlayersDb()
        ]);

        const league = leagueRes.data;
        const rosters = rostersRes.data;
        const users = usersRes.data || [];

        if (!league || !rosters || !Array.isArray(rosters)) {
            throw new Error('Invalid league data received from Sleeper');
        }

        const posMap = (typeof CONFIG !== 'undefined' && CONFIG.SLEEPER_POS_MAP) 
            ? CONFIG.SLEEPER_POS_MAP 
            : { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLX', K: 'K', DEF: 'DST' };

        // 1. Parse starting roster slots (e.g. ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DST'])
        const startingSlots = [];
        if (league.roster_positions && Array.isArray(league.roster_positions)) {
            for (const pos of league.roster_positions) {
                if (pos !== 'BN' && pos !== 'IR' && pos !== 'TAXI' && posMap[pos]) {
                    startingSlots.push(posMap[pos]);
                }
            }
        }

        // 2. Map users: user_id -> display_name or team_name
        const userMap = new Map();
        for (const u of users) {
            const teamName = u.metadata && u.metadata.team_name;
            const displayName = teamName || u.display_name || `Team ${u.user_id}`;
            userMap.set(u.user_id, displayName);
        }

        // 3. Build owners list for UI dropdown
        const owners = rosters.map(r => {
            const ownerName = userMap.get(r.owner_id) || `Team ${r.roster_id}`;
            return {
                id: r.roster_id,
                owner: ownerName
            };
        }).sort((a, b) => a.owner.localeCompare(b.owner));

        // 4. Map rostered players
        const rosteredPlayers = [];
        for (const roster of rosters) {
            const rosterId = roster.roster_id;
            const starterSet = new Set(roster.starters || []);

            if (Array.isArray(roster.players)) {
                for (const playerId of roster.players) {
                    const pData = playersDb[playerId];
                    if (!pData) continue;

                    const position = posMap[pData.position] || pData.position;
                    const isStarter = starterSet.has(playerId);

                    rosteredPlayers.push({
                        id: pData.id,
                        sleeperId: playerId,
                        name: (pData.name || '').replace(/\./g, ''),
                        position: position,
                        onRoster: rosterId,
                        starter: isStarter,
                        rank: -1,
                        flxRank: -1
                    });
                }
            }
        }

        return {
            leagueName: (league && league.name) ? league.name : '',
            startingSlots,
            owners,
            rosteredPlayers
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SleeperService;
}
