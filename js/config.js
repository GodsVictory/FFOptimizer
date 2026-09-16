/**
 * FF Optimizer Configuration and Constants
 */

const CONFIG = {
    PLATFORMS: {
        SLEEPER: 'Sleeper',
        ESPN: 'ESPN',
        YAHOO: 'Yahoo'
    },
    SCORING: {
        STD: 'STD',
        HALF: 'HALF',
        PPR: 'PPR'
    },
    FLEX_TYPES: {
        WRT: 'WRT', // RB/WR/TE
        WR: 'WR'    // RB/WR
    },
    POSITIONS: ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST'],
    CORE_POSITIONS: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'],
    
    // ESPN Roster Slot IDs to Position
    ESPN_SLOT_MAP: {
        0: 'QB',
        2: 'RB',
        3: 'FLX', // RB/WR/TE Flex
        4: 'WR',
        6: 'TE',
        16: 'DST',
        17: 'K',
        20: 'BN',
        21: 'IR'
    },

    // ESPN Player Default Position ID to Position
    ESPN_POS_MAP: {
        1: 'QB',
        2: 'RB',
        3: 'WR',
        4: 'TE',
        5: 'K',
        16: 'DST'
    },

    // Sleeper Position translation
    SLEEPER_POS_MAP: {
        'QB': 'QB',
        'RB': 'RB',
        'WR': 'WR',
        'TE': 'TE',
        'FLEX': 'FLX',
        'K': 'K',
        'DEF': 'DST',
        'DST': 'DST'
    },

    // Yahoo Position translation
    YAHOO_POS_MAP: {
        'QB': 'QB',
        'RB': 'RB',
        'WR': 'WR',
        'TE': 'TE',
        'W/R/T': 'FLX',
        'W/R': 'FLX',
        'FLEX': 'FLX',
        'K': 'K',
        'DEF': 'DST',
        'DST': 'DST',
        'BN': 'BN',
        'IR': 'IR'
    },

    // 32 NFL Teams Canonical Defense Map (Maps city, mascot, or abbrev to canonical FantasyPros name)
    DEFENSE_CANONICAL_MAP: {
        'cardinals': 'Arizona Cardinals', 'arizona': 'Arizona Cardinals', 'ari': 'Arizona Cardinals',
        'falcons': 'Atlanta Falcons', 'atlanta': 'Atlanta Falcons', 'atl': 'Atlanta Falcons',
        'ravens': 'Baltimore Ravens', 'baltimore': 'Baltimore Ravens', 'bal': 'Baltimore Ravens',
        'bills': 'Buffalo Bills', 'buffalo': 'Buffalo Bills', 'buf': 'Buffalo Bills',
        'panthers': 'Carolina Panthers', 'carolina': 'Carolina Panthers', 'car': 'Carolina Panthers',
        'bears': 'Chicago Bears', 'chicago': 'Chicago Bears', 'chi': 'Chicago Bears',
        'bengals': 'Cincinnati Bengals', 'cincinnati': 'Cincinnati Bengals', 'cin': 'Cincinnati Bengals',
        'browns': 'Cleveland Browns', 'cleveland': 'Cleveland Browns', 'cle': 'Cleveland Browns',
        'cowboys': 'Dallas Cowboys', 'dallas': 'Dallas Cowboys', 'dal': 'Dallas Cowboys',
        'broncos': 'Denver Broncos', 'denver': 'Denver Broncos', 'den': 'Denver Broncos',
        'lions': 'Detroit Lions', 'detroit': 'Detroit Lions', 'det': 'Detroit Lions',
        'packers': 'Green Bay Packers', 'green bay': 'Green Bay Packers', 'gb': 'Green Bay Packers',
        'texans': 'Houston Texans', 'houston': 'Houston Texans', 'hou': 'Houston Texans',
        'colts': 'Indianapolis Colts', 'indianapolis': 'Indianapolis Colts', 'ind': 'Indianapolis Colts',
        'jaguars': 'Jacksonville Jaguars', 'jacksonville': 'Jacksonville Jaguars', 'jax': 'Jacksonville Jaguars',
        'chiefs': 'Kansas City Chiefs', 'kansas city': 'Kansas City Chiefs', 'kc': 'Kansas City Chiefs',
        'raiders': 'Las Vegas Raiders', 'las vegas': 'Las Vegas Raiders', 'lv': 'Las Vegas Raiders', 'oakland': 'Las Vegas Raiders',
        'chargers': 'Los Angeles Chargers', 'la chargers': 'Los Angeles Chargers', 'lac': 'Los Angeles Chargers',
        'rams': 'Los Angeles Rams', 'la rams': 'Los Angeles Rams', 'lar': 'Los Angeles Rams',
        'dolphins': 'Miami Dolphins', 'miami': 'Miami Dolphins', 'mia': 'Miami Dolphins',
        'vikings': 'Minnesota Vikings', 'minnesota': 'Minnesota Vikings', 'min': 'Minnesota Vikings',
        'patriots': 'New England Patriots', 'new england': 'New England Patriots', 'ne': 'New England Patriots',
        'saints': 'New Orleans Saints', 'new orleans': 'New Orleans Saints', 'no': 'New Orleans Saints',
        'giants': 'New York Giants', 'ny giants': 'New York Giants', 'nyg': 'New York Giants',
        'jets': 'New York Jets', 'ny jets': 'New York Jets', 'nyj': 'New York Jets',
        'eagles': 'Philadelphia Eagles', 'philadelphia': 'Philadelphia Eagles', 'phi': 'Philadelphia Eagles',
        'steelers': 'Pittsburgh Steelers', 'pittsburgh': 'Pittsburgh Steelers', 'pit': 'Pittsburgh Steelers',
        '49ers': 'San Francisco 49ers', 'san francisco': 'San Francisco 49ers', 'sf': 'San Francisco 49ers',
        'seahawks': 'Seattle Seahawks', 'seattle': 'Seattle Seahawks', 'sea': 'Seattle Seahawks',
        'buccaneers': 'Tampa Bay Buccaneers', 'tampa bay': 'Tampa Bay Buccaneers', 'tb': 'Tampa Bay Buccaneers',
        'titans': 'Tennessee Titans', 'tennessee': 'Tennessee Titans', 'ten': 'Tennessee Titans',
        'commanders': 'Washington Commanders', 'washington': 'Washington Commanders', 'was': 'Washington Commanders'
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
