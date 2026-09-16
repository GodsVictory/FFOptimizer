#!/usr/bin/env python3
"""
FF Optimizer - Yahoo OAuth Token Helper
A simple script to authenticate with Yahoo and obtain an OAuth Access Token.
"""

import sys
import webbrowser
import urllib.parse
import base64
import requests

AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
REDIRECT_URI = "https://localhost:8080"

def get_tokens(client_id, client_secret):
    # 1. Generate authorization URL
    params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "language": "en-us"
    }
    url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"
    
    print("\n[+] Opening browser to authorize with Yahoo...")
    print(f"URL: {url}\n")
    try:
        webbrowser.open(url)
    except Exception:
        pass

    print("=" * 65)
    print("STEP 1: Log in and click 'Agree' on Yahoo.")
    print("STEP 2: Your browser will redirect to a URL like:")
    print("        https://localhost:8080/?code=XXXXX")
    print("STEP 3: Copy the 'code' parameter value (or paste the entire URL here).")
    print("=" * 65)

    code_input = input("\nPaste code or redirect URL: ").strip()
    if not code_input:
        print("[-] Error: No code provided.")
        return

    # Extract code if full URL was pasted
    if "code=" in code_input:
        parsed = urllib.parse.urlparse(code_input)
        queries = urllib.parse.parse_qs(parsed.query)
        code = queries.get("code", [code_input])[0]
    else:
        code = code_input

    # 2. Exchange authorization code for access token
    auth_header = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    headers = {
        "Authorization": f"Basic {auth_header}",
        "Content-Type": "application/x-www-form-urlencoded"
    }
    data = {
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI,
        "code": code
    }

    print("\n[+] Exchanging code for Access Token...")
    try:
        r = requests.post(TOKEN_URL, headers=headers, data=data, timeout=15)
        r.raise_for_status()
        tokens = r.json()
        
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in", 3600)

        print("\n" + "=" * 65)
        print("SUCCESS! Your Yahoo Access Token:")
        print("=" * 65)
        print(f"\n{access_token}\n")
        print("=" * 65)
        print(f"[!] Note: Yahoo access tokens expire after {expires_in // 60} minutes.")
        if refresh_token:
            print(f"[i] Refresh Token (to generate new tokens without re-logging in):")
            print(f"    {refresh_token}")
        print("=" * 65)

    except requests.exceptions.HTTPError as e:
        print(f"[-] Token exchange failed: {e}")
        try:
            print("Response:", r.json())
        except Exception:
            pass
    except Exception as e:
        print(f"[-] Error: {e}")

if __name__ == "__main__":
    print("--- Yahoo Fantasy OAuth Token Generator ---")
    c_id = input("Enter Yahoo Client ID (Consumer Key): ").strip()
    c_secret = input("Enter Yahoo Client Secret (Consumer Secret): ").strip()

    if not c_id or not c_secret:
        print("[-] Both Client ID and Client Secret are required.")
        sys.exit(1)

    get_tokens(c_id, c_secret)
