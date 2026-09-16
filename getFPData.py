#!/usr/bin/env python3
"""
FF Optimizer - Data Fetcher
Fetches consensus rankings from FantasyPros and NFL player data from Sleeper.
Uses Sleeper's live NFL state API to dynamically determine the current active NFL week.
"""

import os
import sys
import json
import datetime
import argparse
import requests

def get_current_nfl_state():
    """
    Fetches the current NFL week and season year from Sleeper's live NFL state API.
    Falls back to calendar date estimation if the API call fails.
    """
    try:
        r = requests.get('https://api.sleeper.app/v1/state/nfl', timeout=10)
        if r.status_code == 200:
            data = r.json()
            week = data.get('display_week') or data.get('week')
            season = data.get('season')
            if week and season:
                print(f"[+] Retrieved live NFL state from Sleeper: Season {season}, Week {week}")
                return int(week), str(season)
    except Exception as e:
        print(f"[-] Note: Could not reach Sleeper state API ({e}). Using calendar estimation.")

    # Fallback to date estimation
    today = datetime.date.today()
    # Estimate week (NFL season starts around early September)
    week = int((today - datetime.timedelta(days=1)).strftime("%U")) - 35
    if week < 1:
        week = 1
    elif week > 18:
        week = 18

    year = (today - datetime.timedelta(days=14)).strftime("%Y")
    return week, year

def fetch_rankings_for_week(year, week, pos, scoring):
    """Fetches FantasyPros rankings for a specific position, scoring, and week."""
    fp_url = (
        f"https://partners.fantasypros.com/api/v1/consensus-rankings.php"
        f"?sport=NFL&year={year}&week={week}&scoring={scoring}&export=json&position={pos}"
    )
    r = requests.get(fp_url, timeout=20)
    r.raise_for_status()
    data = r.json()

    players_list = []
    for p in data.get('players', []):
        player_id = p.get('player_team_id') if pos == 'DST' else p.get('sportsdata_id')
        players_list.append({
            'name': p.get('player_name', ''),
            'position': p.get('player_position_id', pos),
            'id': player_id,
            'rank': p.get('rank_ecr')
        })
    return players_list

def fetch_rankings_for_ros(year, pos, scoring):
    """Fetches FantasyPros Rest of Season (ROS) consensus rankings for a position and scoring."""
    fp_url = (
        f"https://partners.fantasypros.com/api/v1/consensus-rankings.php"
        f"?sport=NFL&year={year}&type=ROS&scoring={scoring}&export=json&position={pos}"
    )
    r = requests.get(fp_url, timeout=20)
    r.raise_for_status()
    data = r.json()

    players_list = []
    for p in data.get('players', []):
        player_id = p.get('player_team_id') if pos == 'DST' else p.get('sportsdata_id')
        players_list.append({
            'name': p.get('player_name', ''),
            'position': p.get('player_position_id', pos),
            'id': player_id,
            'rank': p.get('rank_ecr')
        })
    return players_list

def main():
    parser = argparse.ArgumentParser(description="Fetch FantasyPros rankings and Sleeper player data")
    parser.add_argument("--week", type=int, help="NFL Week number (1-18)")
    parser.add_argument("--year", type=str, help="NFL Season year (e.g. 2026)")
    args = parser.parse_args()

    os.makedirs('data', exist_ok=True)

    # Determine week and year
    detected_week, detected_year = get_current_nfl_state()
    week = args.week if args.week else detected_week
    year = args.year if args.year else detected_year

    print(f"[+] Target: NFL Season {year}, Week {week}")

    # 1. Probe FantasyPros to check if rankings are available for this week
    probe_url = (
        f"https://partners.fantasypros.com/api/v1/consensus-rankings.php"
        f"?sport=NFL&year={year}&week={week}&scoring=HALF&export=json&position=QB"
    )
    try:
        probe_res = requests.get(probe_url, timeout=15)
        probe_players = probe_res.json().get('players', [])
        if len(probe_players) == 0 and week > 1:
            print(f"[-] FantasyPros has 0 rankings published for Week {week} yet.")
            print(f"[+] Falling back to Week {week - 1} rankings where data is available.")
            week = week - 1
    except Exception as e:
        print(f"[-] Warning during FantasyPros probe: {e}")

    # 2. Fetch Sleeper NFL Players Database
    print("\n[+] Fetching Sleeper NFL player database...")
    sleeper_url = 'https://api.sleeper.app/v1/players/nfl'
    try:
        r = requests.get(sleeper_url, timeout=30)
        r.raise_for_status()
        players = r.json()

        valid_positions = {'QB', 'RB', 'WR', 'TE', 'K', 'DEF'}
        out_players = {}

        for player_id, p in players.items():
            if not isinstance(p, dict):
                continue
            if p.get('team') is None:
                continue
            pos = p.get('position')
            if pos not in valid_positions:
                continue

            name = f"{p.get('first_name', '')} {p.get('last_name', '')}".strip() if pos == 'DEF' else p.get('full_name', '')
            ext_id = p.get('player_id') if pos == 'DEF' else p.get('sportradar_id')

            out_players[player_id] = {
                'position': pos,
                'name': name,
                'id': ext_id
            }

        if len(out_players) > 0:
            with open('data/sleeperPlayers.json', 'w', encoding='utf-8') as f:
                json.dump(out_players, f)
            print(f"[+] Saved data/sleeperPlayers.json ({len(out_players)} players)")
        else:
            print("[-] Warning: No Sleeper players found, skipping write.")
    except Exception as e:
        print(f"[-] Warning: Failed to fetch Sleeper players: {e}", file=sys.stderr)

    # 3. Fetch FantasyPros Consensus Rankings
    positions = ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DST']
    scoring_types = ['STD', 'HALF', 'PPR']

    print(f"\n[+] Fetching FantasyPros consensus rankings for Week {week}...")
    saved_count = 0

    for pos in positions:
        for scoring in scoring_types:
            try:
                players_list = fetch_rankings_for_week(year, week, pos, scoring)

                # Safeguard: Do not overwrite existing ranking files with empty arrays
                file_path = f"data/{scoring}-{pos}.json"
                if len(players_list) > 0:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        json.dump(players_list, f)
                    print(f"    - Saved {file_path} ({len(players_list)} rankings)")
                    saved_count += 1
                else:
                    print(f"    - Skipped {file_path} (0 players returned, preserving existing data)")
            except Exception as e:
                print(f"    - Warning: Failed to fetch {scoring}-{pos}: {e}", file=sys.stderr)

    # 4. Fetch FantasyPros Rest of Season (ROS) Consensus Rankings
    print(f"\n[+] Fetching FantasyPros Rest of Season (ROS) consensus rankings...")
    ros_saved_count = 0

    for pos in positions:
        for scoring in scoring_types:
            try:
                players_list = fetch_rankings_for_ros(year, pos, scoring)

                # Safeguard: Do not overwrite existing ranking files with empty arrays
                file_path = f"data/ROS-{scoring}-{pos}.json"
                if len(players_list) > 0:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        json.dump(players_list, f)
                    print(f"    - Saved {file_path} ({len(players_list)} ROS rankings)")
                    ros_saved_count += 1
                else:
                    print(f"    - Skipped {file_path} (0 players returned, preserving existing data)")
            except Exception as e:
                print(f"    - Warning: Failed to fetch ROS-{scoring}-{pos}: {e}", file=sys.stderr)

    # Save last updated timestamp only if rankings were saved
    if saved_count > 0 or ros_saved_count > 0:
        timestamp_data = {
            "date": datetime.datetime.now().strftime("%m/%d/%Y %H:%M"),
            "week": str(week),
            "has_ros": ros_saved_count > 0
        }
        with open('data/lastUpdatedAt.json', 'w', encoding='utf-8') as f:
            json.dump(timestamp_data, f, indent=2)
        print(f"\n[+] Updated data/lastUpdatedAt.json (Week {week}, {timestamp_data['date']}, ROS: {ros_saved_count} files)")
        print("[+] Data fetch successfully completed!")
    else:
        print("\n[-] Warning: No ranking data could be fetched. Existing data files were preserved.")

if __name__ == '__main__':
    main()
