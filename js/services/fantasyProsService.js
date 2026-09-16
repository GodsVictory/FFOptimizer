/**
 * FantasyProsService: Loads and caches FantasyPros consensus rankings data in parallel.
 */

const FantasyProsService = {
    // In-memory cache for loaded scoring data (STD, HALF, PPR)
    _cache: {},
    _rosCache: {},
    _metadata: null,

    /**
     * Fetches the last updated timestamp and current week.
     */
    async fetchMetadata() {
        if (this._metadata) {
            return this._metadata;
        }

        try {
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
        } catch (err) {
            console.warn('Failed to fetch lastUpdatedAt metadata:', err);
            return { week: '1', date: '', minutesAgo: 0 };
        }
    },

    /**
     * Loads rankings for all positions in parallel for a given scoring format (STD, HALF, PPR).
     * Uses in-memory caching to make subsequent toggles instantaneous.
     */
    async fetchRankings(scoring = 'STD') {
        if (this._cache[scoring]) {
            return this._cache[scoring];
        }

        const positions = (typeof CONFIG !== 'undefined' && CONFIG.POSITIONS) 
            ? CONFIG.POSITIONS 
            : ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST'];

        // Fetch all position files simultaneously in parallel
        const fetchPromises = positions.map(pos => 
            axios.get(`data/${scoring}-${pos}.json`)
                .then(res => ({ pos, players: res.data || [] }))
                .catch(err => {
                    console.error(`Error loading data/${scoring}-${pos}.json:`, err);
                    return { pos, players: [] };
                })
        );

        const results = await Promise.all(fetchPromises);

        const rankingsByPos = {};
        for (const item of results) {
            rankingsByPos[item.pos] = item.players;
        }

        this._cache[scoring] = rankingsByPos;
        return rankingsByPos;
    },

    /**
     * Loads Rest of Season (ROS) rankings for all positions in parallel for a given scoring format.
     * Uses in-memory caching to make subsequent toggles instantaneous.
     */
    async fetchRosRankings(scoring = 'STD') {
        if (this._rosCache[scoring]) {
            return this._rosCache[scoring];
        }

        const positions = (typeof CONFIG !== 'undefined' && CONFIG.POSITIONS) 
            ? CONFIG.POSITIONS 
            : ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST'];

        // Fetch all ROS position files simultaneously in parallel
        const fetchPromises = positions.map(pos => 
            axios.get(`data/ROS-${scoring}-${pos}.json`)
                .then(res => ({ pos, players: res.data || [] }))
                .catch(err => {
                    console.error(`Error loading data/ROS-${scoring}-${pos}.json:`, err);
                    return { pos, players: [] };
                })
        );

        const results = await Promise.all(fetchPromises);

        const rosByPos = {};
        for (const item of results) {
            rosByPos[item.pos] = item.players;
        }

        this._rosCache[scoring] = rosByPos;
        return rosByPos;
    },

    /**
     * Clears all cached rankings.
     */
    clearCache() {
        this._cache = {};
        this._rosCache = {};
        this._metadata = null;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FantasyProsService;
}
