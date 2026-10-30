/**
 * SleeperService: High-performance Sleeper API client with batch requests and caching.
 */

const SleeperService = {
    _playersDb: null,
    _livePlayersDb: null,
    LIVE_DB_KEY: 'ff_sleeper_players_live',
    LIVE_DB_TTL: 24 * 60 * 60 * 1000, // Sleeper asks clients to pull /players/nfl at most once per day

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
     * Fetches the full live Sleeper player database (~5MB), slimmed to fantasy positions and cached
     * in localStorage for a day. Only used when a roster contains players missing from the bundled file
     * (e.g. recent signings), so those players aren't silently dropped and mistaken for free agents.
     */
    async getLivePlayersDb() {
        if (this._livePlayersDb) return this._livePlayersDb;

        try {
            if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem(this.LIVE_DB_KEY);
                if (raw) {
                    const cached = JSON.parse(raw);
                    if (cached && cached.timestamp && Date.now() - cached.timestamp < this.LIVE_DB_TTL && cached.players) {
                        this._livePlayersDb = cached.players;
                        return this._livePlayersDb;
                    }
                }
            }
        } catch (e) {}

        try {
            const res = await axios.get('https://api.sleeper.app/v1/players/nfl', { timeout: 30000 });
            const slim = {};
            const validPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
            for (const [playerId, p] of Object.entries(res.data || {})) {
                if (!p || !validPositions.has(p.position)) continue;
                slim[playerId] = {
                    position: p.position,
                    name: p.position === 'DEF'
                        ? `${p.first_name || ''} ${p.last_name || ''}`.trim()
                        : (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()),
                    id: p.position === 'DEF' ? p.player_id : (p.sportradar_id || null)
                };
            }
            this._livePlayersDb = slim;
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(this.LIVE_DB_KEY, JSON.stringify({ timestamp: Date.now(), players: slim }));
                }
            } catch (e) {
                // Quota exceeded: keep the in-memory copy only
            }
            return slim;
        } catch (err) {
            console.warn('Could not fetch live Sleeper player database:', err);
            return {};
        }
    },

    /**
     * Resolves a Sleeper player id that is missing from every player database.
     * Team defenses use the team abbreviation as their id, so those can be reconstructed.
     */
    resolveUnknownPlayer(playerId) {
        const defMap = (typeof CONFIG !== 'undefined' && CONFIG.DEFENSE_CANONICAL_MAP) ? CONFIG.DEFENSE_CANONICAL_MAP : {};
        const teamName = /^[A-Z]{2,3}$/.test(playerId) ? defMap[playerId.toLowerCase()] : null;
        if (teamName) {
            return { position: 'DEF', name: teamName, id: playerId };
        }
        return null;
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
            : { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLX', WRRB_FLEX: 'WRRB', REC_FLEX: 'REC', SUPER_FLEX: 'SFLX', K: 'K', DEF: 'DST' };

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

        // 4. Map rostered players, filling gaps in the bundled player file from the live Sleeper database
        const missingIds = [];
        for (const roster of rosters) {
            for (const playerId of (roster.players || [])) {
                if (!playersDb[playerId]) missingIds.push(playerId);
            }
        }
        let liveDb = {};
        if (missingIds.length > 0) {
            liveDb = await this.getLivePlayersDb();
        }
        const unresolved = [];

        const rosteredPlayers = [];
        for (const roster of rosters) {
            const rosterId = roster.roster_id;
            const starterSet = new Set(roster.starters || []);

            if (Array.isArray(roster.players)) {
                for (const playerId of roster.players) {
                    const pData = playersDb[playerId] || liveDb[playerId] || this.resolveUnknownPlayer(playerId);
                    if (!pData) {
                        unresolved.push(playerId);
                        continue;
                    }

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

        // Auto-detect scoring format from league scoring settings
        let detectedScoring = 'STD';
        if (league.scoring_settings && typeof league.scoring_settings.rec === 'number') {
            const rec = league.scoring_settings.rec;
            if (rec >= 0.75) detectedScoring = 'PPR';
            else if (rec >= 0.25) detectedScoring = 'HALF';
            else detectedScoring = 'STD';
        }

        // Auto-detect flex format from roster positions
        let detectedFlex = 'WRT';
        if (league.roster_positions && Array.isArray(league.roster_positions)) {
            if (league.roster_positions.includes('WRRB_FLEX')) {
                detectedFlex = 'WR';
            } else if (league.roster_positions.includes('FLEX') || league.roster_positions.includes('W/R/T')) {
                detectedFlex = 'WRT';
            }
        }

        if (unresolved.length > 0) {
            console.warn(`Sleeper: ${unresolved.length} rostered player(s) could not be identified:`, unresolved);
        }

        return {
            leagueName: (league && league.name) ? league.name : '',
            unresolvedPlayers: unresolved.length,
            startingSlots,
            owners,
            rosteredPlayers,
            scoring: detectedScoring,
            flex: detectedFlex
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SleeperService;
}
