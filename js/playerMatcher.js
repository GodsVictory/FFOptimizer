/**
 * PlayerMatcher: High-performance O(1) player matching with normalized dictionary lookup
 * and single-instance fuzzy search fallback.
 */

const PlayerMatcher = {
    /**
     * Normalizes a player name for reliable O(1) matching across platforms.
     * Removes dots, apostrophes, hyphens, suffixes (Jr., Sr., II, III, IV), and extra whitespace.
     */
    normalizeName(name) {
        if (!name || typeof name !== 'string') return '';
        let clean = name.toLowerCase().trim();

        // Remove dots, apostrophes, commas
        clean = clean.replace(/[\.\',]/g, '');

        // Remove standard suffixes when preceded by whitespace
        clean = clean.replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '');

        // Replace hyphens with spaces and collapse extra whitespace
        clean = clean.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

        return clean;
    },

    /**
     * Normalizes defense / DST team names to a canonical FantasyPros name.
     */
    resolveDefenseName(rawName) {
        if (!rawName) return '';
        
        let configRef = (typeof CONFIG !== 'undefined') ? CONFIG : null;
        if (!configRef && typeof require !== 'undefined') {
            try {
                configRef = require('./config.js');
            } catch (e) {}
        }

        const defMap = (configRef && configRef.DEFENSE_CANONICAL_MAP) ? configRef.DEFENSE_CANONICAL_MAP : {};

        let clean = rawName.toLowerCase()
            .replace(/[\.\',\/]/g, ' ')
            .replace(/\b(d\s*st|dst|def|defense)\b/gi, '')
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (defMap[clean]) {
            return defMap[clean];
        }

        // Try matching key phrases in defMap (longer keys first)
        const keys = Object.keys(defMap).sort((a, b) => b.length - a.length);
        for (const key of keys) {
            const regex = new RegExp(`(^|\\s)${key}(\\s|$)`, 'i');
            if (regex.test(clean)) {
                return defMap[key];
            }
        }

        return rawName.trim();
    },

    /**
     * Creates an indexed lookup dictionary for a collection of players.
     * @param {Array} players - Array of player objects with a `name` property
     * @returns {Object} Index object with get() and fuzzySearch()
     */
    createIndex(players) {
        const exactMap = new Map();
        let fuseInstance = null;

        // Build O(1) map
        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            const norm = this.normalizeName(p.name);
            if (norm && !exactMap.has(norm)) {
                exactMap.set(norm, p);
            }

            // Also index defense variations if position is DST
            if (p.position === 'DST') {
                const canon = this.resolveDefenseName(p.name);
                const normCanon = this.normalizeName(canon);
                if (normCanon && !exactMap.has(normCanon)) {
                    exactMap.set(normCanon, p);
                }
            }
        }

        return {
            /**
             * Looks up a player by name. First tries O(1) exact normalized match,
             * then falls back to Fuse fuzzy search if necessary.
             */
            find(name, position = null) {
                if (!name) return null;

                // Handle Defense specially
                let searchName = name;
                if (position === 'DST' || name.toLowerCase().includes('d/st') || name.toLowerCase().includes('dst')) {
                    const resolved = PlayerMatcher.resolveDefenseName(name);
                    const normResolved = PlayerMatcher.normalizeName(resolved);
                    if (exactMap.has(normResolved)) {
                        return exactMap.get(normResolved);
                    }
                }

                // 1. O(1) Normalized exact match
                const norm = PlayerMatcher.normalizeName(searchName);
                if (exactMap.has(norm)) {
                    return exactMap.get(norm);
                }

                // 2. Fallback: Fuzzy search with single Fuse instance (lazily created)
                if (typeof Fuse !== 'undefined' && players.length > 0) {
                    if (!fuseInstance) {
                        fuseInstance = new Fuse(players, {
                            threshold: 0.25,
                            keys: ['name']
                        });
                    }
                    const results = fuseInstance.search(searchName);
                    if (results && results.length > 0) {
                        return results[0].item || results[0];
                    }
                }

                return null;
            }
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlayerMatcher;
}
