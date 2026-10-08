/**
 * PlayerMatcher: High-performance O(1) player matching with normalized dictionary lookup
 * and single-instance fuzzy search fallback.
 */

const PlayerMatcher = {
    ALIASES: {
        'gabe davis': 'gabriel davis',
        'gabriel davis': 'gabe davis',
        'joshua palmer': 'josh palmer',
        'josh palmer': 'joshua palmer',
        'marquise brown': 'hollywood brown',
        'hollywood brown': 'marquise brown',
        'kenneth walker': 'ken walker',
        'ken walker': 'kenneth walker',
        'mitch trubisky': 'mitchell trubisky',
        'mitchell trubisky': 'mitch trubisky',
        'nathaniel dell': 'tank dell',
        'tank dell': 'nathaniel dell',
        'chigoziem okonkwo': 'chig okonkwo',
        'chig okonkwo': 'chigoziem okonkwo',
        'jeffrey wilson': 'jeff wilson',
        'jeff wilson': 'jeffrey wilson'
    },

    NICKNAMES: {
        'gabriel': ['gabe'],
        'gabe': ['gabriel'],
        'joshua': ['josh'],
        'josh': ['joshua'],
        'kenneth': ['ken'],
        'ken': ['kenneth'],
        'mitchell': ['mitch'],
        'mitch': ['mitchell'],
        'nathaniel': ['tank', 'nate'],
        'tank': ['nathaniel'],
        'nate': ['nathaniel'],
        'marquise': ['hollywood'],
        'hollywood': ['marquise'],
        'chigoziem': ['chig'],
        'chig': ['chigoziem'],
        'jeffrey': ['jeff'],
        'jeff': ['jeffrey'],
        'cameron': ['cam'],
        'cam': ['cameron'],
        'michael': ['mike'],
        'mike': ['michael'],
        'christopher': ['chris'],
        'chris': ['christopher'],
        'matthew': ['matt'],
        'matt': ['matthew'],
        'daniel': ['dan', 'danny'],
        'dan': ['daniel'],
        'danny': ['daniel'],
        'william': ['will', 'bill'],
        'will': ['william'],
        'alexander': ['alex'],
        'alex': ['alexander'],
        'robert': ['rob', 'robbie', 'robby', 'bob'],
        'rob': ['robert'],
        'robbie': ['robert', 'robby'],
        'robby': ['robert', 'robbie'],
        'anthony': ['tony'],
        'tony': ['anthony'],
        'zachary': ['zach', 'zack'],
        'zach': ['zachary'],
        'zack': ['zachary'],
        'nicholas': ['nick'],
        'nick': ['nicholas'],
        'samuel': ['sam'],
        'sam': ['samuel'],
        'timothy': ['tim'],
        'tim': ['timothy'],
        'joseph': ['joe'],
        'joe': ['joseph'],
        'benjamin': ['ben'],
        'ben': ['benjamin'],
        'david': ['dave'],
        'dave': ['david'],
        'jacob': ['jake'],
        'jake': ['jacob'],
        'jonathan': ['jon'],
        'jon': ['jonathan'],
        'raymond': ['ray'],
        'ray': ['raymond'],
        'elijah': ['eli'],
        'eli': ['elijah']
    },

    /**
     * Calculates Levenshtein distance between two strings.
     */
    levenshtein(a, b) {
        if (a === b) return 0;
        const la = a.length, lb = b.length;
        if (la === 0) return lb;
        if (lb === 0) return la;

        const prev = new Array(lb + 1);
        for (let j = 0; j <= lb; j++) prev[j] = j;

        for (let i = 1; i <= la; i++) {
            let current = i;
            let prevDiagonal = i - 1;
            for (let j = 1; j <= lb; j++) {
                const nextDiagonal = prev[j];
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                current = Math.min(
                    prev[j] + 1,        // deletion
                    current + 1,        // insertion
                    prevDiagonal + cost // substitution
                );
                prevDiagonal = nextDiagonal;
                prev[j] = current;
            }
        }
        return prev[lb];
    },

    /**
     * Checks if two positions are compatible (e.g. RB with RB or FLX, DST only with DST).
     */
    isPositionCompatible(pos1, pos2) {
        if (!pos1 || !pos2) return true;
        const p1 = String(pos1).toUpperCase();
        const p2 = String(pos2).toUpperCase();
        if (p1 === p2) return true;
        const flexPositions = ['RB', 'WR', 'TE'];
        if (p1 === 'FLX' && flexPositions.includes(p2)) return true;
        if (p2 === 'FLX' && flexPositions.includes(p1)) return true;
        return false;
    },

    /**
     * Validates that two normalized player names are compatible, preventing distinct
     * players with identical last names from falsely matching (e.g. Trevor vs Travis Etienne,
     * Brian vs Bijan Robinson).
     */
    isNameCompatible(normSearch, normCandidate) {
        if (!normSearch || !normCandidate) return false;
        if (normSearch === normCandidate) return true;

        // Check ALIASES
        if (this.ALIASES[normSearch] === normCandidate || this.ALIASES[normCandidate] === normSearch) {
            return true;
        }

        const wordsSearch = normSearch.split(' ').filter(Boolean);
        const wordsCand = normCandidate.split(' ').filter(Boolean);

        if (wordsSearch.length < 2 || wordsCand.length < 2) {
            return this.levenshtein(normSearch, normCandidate) <= 1;
        }

        const firstSearch = wordsSearch[0];
        const lastSearch = wordsSearch.slice(1).join(' ');
        const firstCand = wordsCand[0];
        const lastCand = wordsCand.slice(1).join(' ');

        // 1. Last name check: must match exactly, or have edit distance <= 1 for a rare typo
        const lastDist = this.levenshtein(lastSearch, lastCand);
        if (lastDist > 1) {
            return false;
        }

        // 2. First name check:
        if (firstSearch === firstCand) {
            return true;
        }

        // Check known first-name nicknames/diminutives
        const nickList = this.NICKNAMES[firstSearch];
        if (nickList && nickList.includes(firstCand)) {
            return true;
        }
        const candNickList = this.NICKNAMES[firstCand];
        if (candNickList && candNickList.includes(firstSearch)) {
            return true;
        }

        // Typo tolerance in first name: only allowed if edit distance is <= 1
        // AND both first names have length >= 4 (to reject distinct short names)
        if (firstSearch.length >= 4 && firstCand.length >= 4) {
            if (this.levenshtein(firstSearch, firstCand) <= 1) {
                return true;
            }
        }

        return false;
    },

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
     * Supports exact ID lookup, normalized exact name lookup, nickname expansion,
     * position filtering, and validated fuzzy search.
     * @param {Array} players - Array of player objects with a `name` property
     * @returns {Object} Index object with find()
     */
    createIndex(players) {
        const idMap = new Map();
        const exactMap = new Map();
        const posExactMap = new Map();
        let fuseInstance = null;

        // Build O(1) maps
        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            if (!p) continue;

            // Index by ID if valid (string or number, not boolean)
            if (p.id && typeof p.id !== 'boolean') {
                idMap.set(String(p.id).trim(), p);
            }

            const norm = this.normalizeName(p.name);
            if (norm) {
                if (!exactMap.has(norm)) {
                    exactMap.set(norm, p);
                }
                if (p.position) {
                    const key = `${p.position.toUpperCase()}_${norm}`;
                    if (!posExactMap.has(key)) {
                        posExactMap.set(key, p);
                    }
                }
            }

            // Also index defense variations if position is DST
            if (p.position === 'DST' || (p.name && (p.name.includes('DEF') || p.name.includes('D/ST')))) {
                const canon = this.resolveDefenseName(p.name);
                const normCanon = this.normalizeName(canon);
                if (normCanon) {
                    if (!exactMap.has(normCanon)) {
                        exactMap.set(normCanon, p);
                    }
                    const key = `DST_${normCanon}`;
                    if (!posExactMap.has(key)) {
                        posExactMap.set(key, p);
                    }
                }
            }
        }

        return {
            /**
             * Looks up a player by name (and optional position/id).
             * Priority:
             * 0. Exact ID match (if id provided)
             * 1. Position-specific normalized exact match
             * 2. Global normalized exact match
             * 3. Known ALIASES match
             * 4. Known first-name NICKNAMES permutation match
             * 5. Validated fuzzy search fallback (enforces position & first/last name compatibility)
             */
            find(name, position = null, id = null) {
                if (!name && !id) return null;

                // 0. Exact ID match (highest precision)
                const validId = (id && typeof id !== 'boolean') ? String(id).trim() : null;
                if (validId && idMap.has(validId)) {
                    const candidate = idMap.get(validId);
                    if (PlayerMatcher.isPositionCompatible(position, candidate.position)) {
                        return candidate;
                    }
                }

                if (!name) return null;

                // Handle Defense specially
                let searchName = name;
                const isDst = (position === 'DST' || name.toLowerCase().includes('d/st') || name.toLowerCase().includes('dst'));
                if (isDst) {
                    const resolved = PlayerMatcher.resolveDefenseName(name);
                    const normResolved = PlayerMatcher.normalizeName(resolved);
                    if (posExactMap.has(`DST_${normResolved}`)) {
                        return posExactMap.get(`DST_${normResolved}`);
                    }
                    if (exactMap.has(normResolved)) {
                        return exactMap.get(normResolved);
                    }
                }

                const norm = PlayerMatcher.normalizeName(searchName);

                // 1. Position-specific exact normalized match
                if (position) {
                    const posUpper = position.toUpperCase();
                    if (posExactMap.has(`${posUpper}_${norm}`)) {
                        return posExactMap.get(`${posUpper}_${norm}`);
                    }
                    if (posUpper === 'FLX') {
                        for (const flxPos of ['RB', 'WR', 'TE']) {
                            if (posExactMap.has(`${flxPos}_${norm}`)) {
                                return posExactMap.get(`${flxPos}_${norm}`);
                            }
                        }
                    }
                }

                // 2. Global normalized exact match
                if (exactMap.has(norm)) {
                    const candidate = exactMap.get(norm);
                    if (PlayerMatcher.isPositionCompatible(position, candidate.position)) {
                        return candidate;
                    }
                }

                // 3. Check ALIASES map
                if (PlayerMatcher.ALIASES && PlayerMatcher.ALIASES[norm]) {
                    const aliasNorm = PlayerMatcher.normalizeName(PlayerMatcher.ALIASES[norm]);
                    if (position) {
                        const posUpper = position.toUpperCase();
                        if (posExactMap.has(`${posUpper}_${aliasNorm}`)) {
                            return posExactMap.get(`${posUpper}_${aliasNorm}`);
                        }
                        if (posUpper === 'FLX') {
                            for (const flxPos of ['RB', 'WR', 'TE']) {
                                if (posExactMap.has(`${flxPos}_${aliasNorm}`)) {
                                    return posExactMap.get(`${flxPos}_${aliasNorm}`);
                                }
                            }
                        }
                    }
                    if (exactMap.has(aliasNorm)) {
                        const candidate = exactMap.get(aliasNorm);
                        if (PlayerMatcher.isPositionCompatible(position, candidate.position)) {
                            return candidate;
                        }
                    }
                }

                // 4. Nickname / diminutive permutation check
                const words = norm.split(' ').filter(Boolean);
                if (words.length >= 2) {
                    const first = words[0];
                    const last = words.slice(1).join(' ');
                    const nicks = PlayerMatcher.NICKNAMES[first] || [];
                    for (const altFirst of nicks) {
                        const altNorm = `${altFirst} ${last}`;
                        if (position) {
                            const posUpper = position.toUpperCase();
                            if (posExactMap.has(`${posUpper}_${altNorm}`)) {
                                return posExactMap.get(`${posUpper}_${altNorm}`);
                            }
                            if (posUpper === 'FLX') {
                                for (const flxPos of ['RB', 'WR', 'TE']) {
                                    if (posExactMap.has(`${flxPos}_${altNorm}`)) {
                                        return posExactMap.get(`${flxPos}_${altNorm}`);
                                    }
                                }
                            }
                        }
                        if (exactMap.has(altNorm)) {
                            const candidate = exactMap.get(altNorm);
                            if (PlayerMatcher.isPositionCompatible(position, candidate.position)) {
                                return candidate;
                            }
                        }
                    }
                }

                // 5. Fallback: Fuzzy search with single Fuse instance + Strict Validation
                if (typeof Fuse !== 'undefined' && players.length > 0) {
                    if (!fuseInstance) {
                        fuseInstance = new Fuse(players, {
                            threshold: 0.25,
                            keys: ['name']
                        });
                    }
                    const results = fuseInstance.search(searchName);
                    if (results && results.length > 0) {
                        for (let i = 0; i < results.length; i++) {
                            const candidate = results[i].item || results[i];
                            if (!candidate) continue;

                            // Validate position compatibility
                            if (!PlayerMatcher.isPositionCompatible(position, candidate.position)) {
                                continue;
                            }

                            // If both search and candidate have an ID, they must not conflict
                            if (validId && candidate.id && typeof candidate.id !== 'boolean') {
                                if (validId !== String(candidate.id).trim()) {
                                    continue;
                                }
                            }

                            // Validate name compatibility (first name, last name, nicknames, distance)
                            const candNorm = PlayerMatcher.normalizeName(candidate.name);
                            if (PlayerMatcher.isNameCompatible(norm, candNorm)) {
                                return candidate;
                            }
                        }
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
