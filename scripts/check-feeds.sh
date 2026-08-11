#!/usr/bin/env bash
#
# Checks candidate RSS/Atom feeds and reports which ones actually return items.
#
# Run this before adding any source to the app. A FAIL here can mean either
# "no feed" or "wrong URL" — for the newspaper entries especially, the URLs
# below are educated guesses at each publisher's feed convention, so a failure
# is a prompt to go find the real URL, not proof the outlet has no feed.
#
# Usage:  bash scripts/check-feeds.sh
#         bash scripts/check-feeds.sh > feed-status.txt

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
    printf '  %-26s %-9s %s\n' "$name" "HTTP $status" "$url"
    fail=$((fail + 1))
    return
  fi

  items=$(grep -o '<item[ >]' "$TMP" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$items" = "0" ]; then
    items=$(grep -o '<entry[ >]' "$TMP" 2>/dev/null | wc -l | tr -d ' ')
  fi

  if [ "${items:-0}" -gt 0 ]; then
    printf '  %-26s %-9s %s items\n' "$name" "OK" "$items"
    pass=$((pass + 1))
  else
    printf '  %-26s %-9s %s\n' "$name" "EMPTY" "200 but no items — likely not a feed"
    fail=$((fail + 1))
  fi
}

section() {
  printf '\n%s\n' "$1"
}

section "Controls (already in the app — these should pass)"
check "ESPN CFB"            "https://www.espn.com/espn/rss/ncf/news"
check "CBS Sports CFB"      "https://www.cbssports.com/rss/headlines/college-football/"
check "Yahoo CFB"           "https://sports.yahoo.com/college-football/rss.xml"
check "Eleven Warriors"     "https://www.elevenwarriors.com/rss.xml"

section "SB Nation network (one per Big Ten program)"
check "Illinois"            "https://www.thechampaignroom.com/rss/index.xml"
check "Indiana"             "https://www.crimsonquarry.com/rss/index.xml"
check "Iowa"                "https://www.blackheartgoldpants.com/rss/index.xml"
check "Maryland"            "https://www.testudotimes.com/rss/index.xml"
check "Michigan"            "https://www.maizenbrew.com/rss/index.xml"
check "Michigan State"      "https://www.theonlycolors.com/rss/index.xml"
check "Minnesota"           "https://www.thedailygopher.com/rss/index.xml"
check "Nebraska"            "https://www.cornnation.com/rss/index.xml"
check "Northwestern"        "https://www.insidenu.com/rss/index.xml"
check "Ohio State"          "https://www.landgrantholyland.com/rss/index.xml"
check "Oregon"              "https://www.addictedtoquack.com/rss/index.xml"
check "Penn State"          "https://www.blackshoediaries.com/rss/index.xml"
check "Purdue"              "https://www.hammerandrails.com/rss/index.xml"
check "Rutgers"             "https://www.onthebanks.com/rss/index.xml"
check "UCLA"                "https://www.bruinsnation.com/rss/index.xml"
check "USC"                 "https://www.conquestchronicles.com/rss/index.xml"
check "Washington"          "https://www.uwdawgpound.com/rss/index.xml"
check "Wisconsin"           "https://www.buckys5thquarter.com/rss/index.xml"
check "Off Tackle Empire"   "https://www.offtackleempire.com/rss/index.xml"

section "Independent / newsletter"
check "Extra Points"        "https://www.extrapointsmb.com/feed"

section "Local newsrooms (URLs are guesses — verify failures by hand)"
check "Cleveland.com"       "https://www.cleveland.com/arc/outboundfeeds/rss/category/sports/?outputType=xml"
check "MLive"               "https://www.mlive.com/arc/outboundfeeds/rss/category/sports/?outputType=xml"
check "PennLive"            "https://www.pennlive.com/arc/outboundfeeds/rss/category/sports/?outputType=xml"
check "NJ.com"              "https://www.nj.com/arc/outboundfeeds/rss/category/sports/?outputType=xml"
check "OregonLive"          "https://www.oregonlive.com/arc/outboundfeeds/rss/category/sports/?outputType=xml"
check "Des Moines Register" "https://rssfeeds.desmoinesregister.com/desmoinesregister/sports"
check "Indianapolis Star"   "https://rssfeeds.indystar.com/indystar/sports"
check "Lincoln Journal Star" "https://journalstar.com/search/?f=rss&t=article&c=sports&l=50"
check "Wisconsin State Jrnl" "https://madison.com/search/?f=rss&t=article&c=sports&l=50"
check "Omaha World-Herald"  "https://omaha.com/search/?f=rss&t=article&c=sports&l=50"
check "Chicago Tribune"     "https://www.chicagotribune.com/arc/outboundfeeds/rss/category/sports/?outputType=xml"
check "Baltimore Sun"       "https://www.baltimoresun.com/arc/outboundfeeds/rss/category/sports/?outputType=xml"
check "Seattle Times"       "https://www.seattletimes.com/sports/feed/"
check "LA Times"            "https://www.latimes.com/sports/rss2.0.xml"
check "Star Tribune"        "https://www.startribune.com/sports/index.rss2"

printf '\n%s\n' "----------------------------------------"
printf '%s\n' "  $pass passing, $fail failing"
printf '%s\n' "----------------------------------------"
