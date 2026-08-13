#!/bin/bash
tok() {
  local resp
  resp=$(curl -s -X POST "$SB_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $SB_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"Password123!\"}")
  echo "$resp" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'access_token' not in d:
    sys.exit('LOGIN FAILED for $1: ' + str(d))
print(d['access_token'])
"
}

export TOKEN_A=$(tok reneo.sellera@gmail.com)
export TOKEN_B=$(tok reneo.sellerb@gmail.com)
export TOKEN_C=$(tok reneo.customer@gmail.com)

echo "A=${#TOKEN_A} B=${#TOKEN_B} C=${#TOKEN_C}"
