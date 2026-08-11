#!/usr/bin/env bash
#
# Round 2: retries the outlets that failed the first pass, plus alternates for
# the six programs left without local newsroom coverage (Iowa, Indiana, Purdue,
# Illinois, Northwestern, Maryland).
#
# Several candidates are listed per outlet on purpose — the first pass showed
# the host was usually right and the path wrong, so this brute-forces the path
# rather than guessing once. Expect most lines to fail; we only need one OK per
# outlet.
#
# Usage:  bash scripts/check-feeds-round2.sh > feed-status-2.txt

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

pass=0
fail=0

check() {
  name="$1"
  url="$2"

  status=$(curl -sS -L --compressed --max-time 20 \
                -A "$UA" \
                -o "$TMP" \
                -w '%{http_code}' \
                "$url" 2>/dev/null)

  if [ "$status" != "200" ]; then
    printf '  %-24s %-9s %s\n' "$name" "HTTP $status" "$url"
    fail=$((fail + 1))
    return
  fi

  items=$(grep -o '<item[ >]' "$TMP" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$items" = "0" ]; then
    items=$(grep -o '<entry[ >]' "$TMP" 2>/dev/null | wc -l | tr -d ' ')
  fi

  if [ "${items:-0}" -gt 0 ]; then
    printf '  %-24s %-9s %-4s %s\n' "$name" "OK" "$items" "$url"
    pass=$((pass + 1))
  else
    printf '  %-24s %-9s %s\n' "$name" "EMPTY" "$url"
    fail=$((fail + 1))
  fi
}

section() { printf '\n%s\n' "$1"; }

section "Gannett — Des Moines Register (Iowa)"
check "DMR a" "https://rssfeeds.desmoinesregister.com/desmoinesregister/home"
check "DMR b" "https://rssfeeds.desmoinesregister.com/desmoinesregister/news"
check "DMR c" "https://www.desmoinesregister.com/rss/"
check "DMR d" "https://www.desmoinesregister.com/arc/outboundfeeds/rss/?outputType=xml"

section "Gannett — Indianapolis Star (Indiana / Purdue)"
check "IndyStar a" "https://rssfeeds.indystar.com/indystar/home"
check "IndyStar b" "https://rssfeeds.indystar.com/indystar/news"
check "IndyStar c" "https://www.indystar.com/rss/"
check "IndyStar d" "https://www.indystar.com/arc/outboundfeeds/rss/?outputType=xml"

section "Tribune — Chicago Tribune (Illinois / Northwestern)"
check "ChiTrib a" "https://www.chicagotribune.com/feed/"
check "ChiTrib b" "https://www.chicagotribune.com/sports/feed/"
check "ChiTrib c" "https://www.chicagotribune.com/arc/outboundfeeds/rss/?outputType=xml"

section "Tribune — Baltimore Sun (Maryland)"
check "BaltSun a" "https://www.baltimoresun.com/feed/"
check "BaltSun b" "https://www.baltimoresun.com/sports/feed/"
check "BaltSun c" "https://www.baltimoresun.com/arc/outboundfeeds/rss/?outputType=xml"

section "Extra Points (independent newsletter)"
check "ExtraPoints a" "https://www.extrapointsmb.com/rss/"
check "ExtraPoints b" "https://extrapoints.substack.com/feed"
check "ExtraPoints c" "https://www.extrapointsmb.com/feed/"

section "Alternate local coverage for the uncovered programs"
check "Gazette (Iowa)" "https://www.thegazette.com/feed/"
check "HawkCentral (Iowa)" "https://rssfeeds.desmoinesregister.com/hawkcentral/home"
check "Herald-Times (IU)" "https://rssfeeds.heraldtimesonline.com/heraldtimesonline/home"
check "J&C (Purdue)" "https://rssfeeds.jconline.com/jconline/home"
check "News-Gazette (Ill)" "https://www.news-gazette.com/search/?f=rss&t=article&c=sports&l=50"
check "Daily Northwestern" "https://dailynorthwestern.com/feed/"
check "Diamondback (Md)" "https://dbknews.com/feed/"
check "Daily Illini" "https://dailyillini.com/feed/"

section "Student papers for programs that already have local coverage"
check "Lantern (Ohio St)" "https://www.thelantern.com/feed/"
check "Michigan Daily" "https://www.michigandaily.com/feed/"
check "Daily Nebraskan" "https://www.dailynebraskan.com/search/?f=rss&t=article&c=sports&l=50"
check "Daily Cardinal (Wis)" "https://www.dailycardinal.com/search/?f=rss&t=article&c=sports&l=50"

printf '\n%s\n' "----------------------------------------"
printf '%s\n' "  $pass passing, $fail failing"
printf '%s\n' "----------------------------------------"
