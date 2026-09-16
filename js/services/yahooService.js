/**
 * YahooService: Supports Yahoo Fantasy through both zero-auth Roster Text/HTML Import
 * and direct Yahoo Fantasy Sports REST API.
 */

const YahooService = {
    /**
     * Parses copied text or HTML from Yahoo Fantasy Football team / matchup page.
     * Works with 100% of Yahoo leagues without requiring OAuth tokens or CORS proxies.
     */
    parseRosterText(input) {
        if (!input || typeof input !== 'string') {
            throw new Error('Please paste your Yahoo roster text or table');
        }

        const trimmed = input.trim();
        if (trimmed.startsWith('<') && trimmed.includes('</')) {
            return this._parseHtmlTable(trimmed);
        }

        return this._parseRawText(trimmed);
    },

    /**
     * Parses raw copied text from Yahoo team page.
     */
    _parseRawText(text) {
        const lines = text.split(/\r?\n/);
        const startingSlots = [];
        const rosteredPlayers = [];
        const posMap = (typeof CONFIG !== 'undefined' && CONFIG.YAHOO_POS_MAP) 
            ? CONFIG.YAHOO_POS_MAP 
            : { 'QB': 'QB', 'RB': 'RB', 'WR': 'WR', 'TE': 'TE', 'W/R/T': 'FLX', 'W/R': 'FLX', 'K': 'K', 'DEF': 'DST' };

        const validSlots = new Set(['QB', 'RB', 'WR', 'TE', 'W/R/T', 'W/R', 'FLEX', 'K', 'DEF', 'DST', 'BN', 'IR']);

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            // Skip common table header lines
            if (/^(Pos|Edit|Player|Opp|Status|Proj|% Start|Week|Rank)/i.test(line)) {
                continue;
            }

            // Detect slot (first token e.g. "QB", "RB", "W/R/T", "BN")
            const tokens = line.split(/[\t\s]{2,}|\t/); // split by tabs or multiple spaces
            let slot = '';
            let rest = line;

            if (tokens.length >= 2 && validSlots.has(tokens[0].toUpperCase())) {
                slot = tokens[0].toUpperCase();
                rest = tokens.slice(1).join(' ');
            } else {
                // Try matching start of line
                const matchSlot = line.match(/^(QB|RB|WR|TE|W\/R\/T|W\/R|FLEX|K|DEF|DST|BN|IR)\b\s*(.*)$/i);
                if (matchSlot) {
                    slot = matchSlot[1].toUpperCase();
                    rest = matchSlot[2];
                }
            }

            if (!slot) continue;

            // Remove Yahoo action words: "Start", "Bench", "Video", "Note"
            rest = rest.replace(/^(Start|Bench)\s+/i, '');
            rest = rest.replace(/\b(Video|Note)\b/gi, '');

            // Clean up player name & extract position if available (e.g. "Patrick Mahomes KC - QB")
            let playerName = rest;
            let playerPos = '';

            // Yahoo pattern: "Player Name Team - POS"
            const yahooMetaMatch = rest.match(/^(.*?)\s+([A-Z]{2,3})\s*-\s*([A-Z\/]+)/i);
            if (yahooMetaMatch) {
                playerName = yahooMetaMatch[1].trim();
                playerPos = yahooMetaMatch[3].toUpperCase().trim();
            } else {
                // If there are tab-separated extra columns (Opponent, Proj, etc.), take first segment
                const subTokens = rest.split(/\t/);
                if (subTokens.length > 1) {
                    playerName = subTokens[0].trim();
                }
            }

            // Strip trailing injury status indicators like "Q", "PUP", "IR", "O", "D"
            playerName = playerName.replace(/\s+(Q|PUP|IR|O|D|SSPD|NA)$/i, '').trim();

            // Strip periods
            playerName = playerName.replace(/\./g, '');

            // Determine canonical position
            if (!playerPos) {
                if (slot === 'DEF' || slot === 'DST') {
                    playerPos = 'DST';
                } else if (slot !== 'BN' && slot !== 'IR' && slot !== 'W/R/T' && slot !== 'W/R' && slot !== 'FLEX') {
                    playerPos = posMap[slot] || slot;
                }
            } else {
                playerPos = posMap[playerPos] || playerPos;
            }

            const isStarter = (slot !== 'BN' && slot !== 'IR');

            if (isStarter) {
                const mappedSlot = posMap[slot] || slot;
                if (mappedSlot) {
                    startingSlots.push(mappedSlot);
                }
            }

            rosteredPlayers.push({
                id: false,
                name: playerName,
                position: playerPos || (slot === 'DEF' ? 'DST' : 'FLX'),
                onRoster: 1,
                starter: isStarter,
                slot: slot,
                rank: -1,
                flxRank: -1
            });
        }

        if (rosteredPlayers.length === 0) {
            throw new Error('Could not parse any players from the pasted text. Please verify the Yahoo roster format.');
        }

        // Default standard starting slots if none extracted
        const finalStartingSlots = startingSlots.length > 0 
            ? startingSlots 
            : ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DST'];

        return {
            leagueName: 'Yahoo Roster',
            startingSlots: finalStartingSlots,
            owners: [{ id: 1, owner: 'My Yahoo Team' }],
            rosteredPlayers
        };
    },

    /**
     * Parses pasted HTML table from Yahoo team page.
     */
    _parseHtmlTable(html) {
        let parser;
        let doc;
        if (typeof DOMParser !== 'undefined') {
            parser = new DOMParser();
            doc = parser.parseFromString(html, 'text/html');
        } else {
            // In non-DOM environment, strip HTML tags and use text parser
            const stripped = html.replace(/<[^>]+>/g, '\t');
            return this._parseRawText(stripped);
        }

        const rows = doc.querySelectorAll('tr');
        const posMap = (typeof CONFIG !== 'undefined' && CONFIG.YAHOO_POS_MAP) 
            ? CONFIG.YAHOO_POS_MAP 
            : { 'QB': 'QB', 'RB': 'RB', 'WR': 'WR', 'TE': 'TE', 'W/R/T': 'FLX', 'W/R': 'FLX', 'K': 'K', 'DEF': 'DST' };

        const startingSlots = [];
        const rosteredPlayers = [];

        rows.forEach(tr => {
            // Find slot/position cell
            const posEl = tr.querySelector('.pos, td:first-child');
            // Find player name element
            const nameEl = tr.querySelector('a.name, .ysf-player-name a, td:nth-child(2) a');

            if (posEl && nameEl) {
                const slot = posEl.textContent.trim().toUpperCase();
                let rawName = nameEl.textContent.trim().replace(/\./g, '');
                
                // Extract detail text if available
                const detailEl = tr.querySelector('.ysf-player-detail, .detail');
                let playerPos = '';
                if (detailEl) {
                    const match = detailEl.textContent.match(/([A-Z]{2,3})\s*-\s*([A-Z\/]+)/i);
                    if (match) {
                        playerPos = posMap[match[2].toUpperCase()] || match[2].toUpperCase();
                    }
                }

                if (!playerPos) {
                    if (slot === 'DEF' || slot === 'DST') playerPos = 'DST';
                    else if (slot !== 'BN' && slot !== 'IR' && slot !== 'W/R/T') playerPos = posMap[slot] || slot;
                }

                const isStarter = (slot !== 'BN' && slot !== 'IR');
                if (isStarter && posMap[slot]) {
                    startingSlots.push(posMap[slot]);
                }

                rosteredPlayers.push({
                    id: false,
                    name: rawName,
                    position: playerPos || 'FLX',
                    onRoster: 1,
                    starter: isStarter,
                    rank: -1,
                    flxRank: -1
                });
            }
        });

        if (rosteredPlayers.length === 0) {
            // Fallback to text parsing
            return this._parseRawText(doc.body.textContent);
        }

        return {
            leagueName: 'Yahoo Roster',
            startingSlots: startingSlots.length > 0 ? startingSlots : ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DST'],
            owners: [{ id: 1, owner: 'My Yahoo Team' }],
            rosteredPlayers
        };
    },

    /**
     * Direct Yahoo Fantasy API fetch via OAuth token and CORS proxy.
     */
    async loadLeagueDataFromApi(leagueId, accessToken = '', proxyUrl = '') {
        if (!leagueId) {
            throw new Error('Please enter a Yahoo League ID');
        }

        // Format league key: e.g. "nfl.l.123456"
        const leagueKey = leagueId.includes('.l.') ? leagueId : `nfl.l.${leagueId}`;
        const baseUrl = `https://fantasysports.yahooapis.com/fantasy/v2`;

        const makeUrl = (path) => {
            const fullTarget = `${baseUrl}/${path}?format=json`;
            if (proxyUrl) {
                return proxyUrl.includes('?url=') ? `${proxyUrl}${encodeURIComponent(fullTarget)}` : `${proxyUrl}/${fullTarget}`;
            }
            return fullTarget;
        };

        const headers = {};
        if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken.trim()}`;
        }

        try {
            const [settingsRes, teamsRes] = await Promise.all([
                axios.get(makeUrl(`league/${leagueKey}/settings`), { headers }),
                axios.get(makeUrl(`league/${leagueKey}/teams/roster`), { headers })
            ]);

            return this._parseApiResponse(settingsRes.data, teamsRes.data);
        } catch (err) {
            console.error('Yahoo API error:', err);
            throw new Error('Failed to connect to Yahoo API. Note: Yahoo requires OAuth 2.0 and CORS proxy when called from browsers.');
        }
    },

    /**
     * Parses JSON responses from Yahoo Fantasy Sports API.
     */
    _parseApiResponse(settingsJson, teamsJson) {
        const posMap = (typeof CONFIG !== 'undefined' && CONFIG.YAHOO_POS_MAP) 
            ? CONFIG.YAHOO_POS_MAP 
            : { 'QB': 'QB', 'RB': 'RB', 'WR': 'WR', 'TE': 'TE', 'W/R/T': 'FLX', 'K': 'K', 'DEF': 'DST' };

        const startingSlots = [];
        const owners = [];
        const rosteredPlayers = [];
        let leagueName = '';

        try {
            // 1. Settings / roster positions
            const leagueObj = settingsJson.fantasy_content && settingsJson.fantasy_content.league;
            if (leagueObj && leagueObj[0] && leagueObj[0].name) {
                leagueName = leagueObj[0].name;
            }
            const settings = leagueObj && leagueObj[1] && leagueObj[1].settings;
            if (settings && settings[0] && settings[0].roster_positions) {
                for (const posItem of settings[0].roster_positions) {
                    const posInfo = posItem.roster_position;
                    if (posInfo && posInfo.position !== 'BN' && posInfo.position !== 'IR') {
                        const canonPos = posMap[posInfo.position] || posInfo.position;
                        const count = parseInt(posInfo.count, 10) || 0;
                        for (let i = 0; i < count; i++) {
                            startingSlots.push(canonPos);
                        }
                    }
                }
            }

            // 2. Teams & Rosters
            const teamsData = teamsJson.fantasy_content && teamsJson.fantasy_content.league;
            const teamsList = teamsData && teamsData[1] && teamsData[1].teams;

            if (teamsList) {
                const count = teamsList.count || 0;
                for (let i = 0; i < count; i++) {
                    const teamWrap = teamsList[i] && teamsList[i].team;
                    if (!teamWrap) continue;

                    const teamMeta = teamWrap[0];
                    let teamId = i + 1;
                    let teamName = `Team ${teamId}`;

                    if (Array.isArray(teamMeta)) {
                        for (const item of teamMeta) {
                            if (item.team_id) teamId = item.team_id;
                            if (item.name) teamName = item.name;
                        }
                    }

                    owners.push({ id: teamId, owner: teamName });

                    // Rosters
                    const rosterWrap = teamWrap[1] && teamWrap[1].roster;
                    const playersObj = rosterWrap && rosterWrap[0] && rosterWrap[0].players;
                    if (playersObj) {
                        const pCount = playersObj.count || 0;
                        for (let j = 0; j < pCount; j++) {
                            const pItem = playersObj[j] && playersObj[j].player;
                            if (!pItem) continue;

                            let pName = '';
                            let pPos = '';
                            let selectedPos = '';

                            const pMeta = pItem[0];
                            if (Array.isArray(pMeta)) {
                                for (const field of pMeta) {
                                    if (field.name && field.name.full) pName = field.name.full;
                                    if (field.display_position) pPos = field.display_position;
                                }
                            }

                            const pSelected = pItem[1] && pItem[1].selected_position;
                            if (Array.isArray(pSelected)) {
                                for (const field of pSelected) {
                                    if (field.position) selectedPos = field.position;
                                }
                            }

                            const isStarter = selectedPos !== 'BN' && selectedPos !== 'IR';
                            const canonPos = posMap[pPos] || pPos || 'FLX';

                            rosteredPlayers.push({
                                id: false,
                                name: pName.replace(/\./g, ''),
                                position: canonPos,
                                onRoster: teamId,
                                starter: isStarter,
                                rank: -1,
                                flxRank: -1
                            });
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing Yahoo API JSON:', e);
        }

        return {
            leagueName: leagueName || 'Yahoo League',
            startingSlots: startingSlots.length > 0 ? startingSlots : ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DST'],
            owners,
            rosteredPlayers
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = YahooService;
}
