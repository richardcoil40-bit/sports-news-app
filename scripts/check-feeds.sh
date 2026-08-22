#!/usr/bin/env bash
#
# Checks that the RSS/Atom feeds the app depends on still return items, and
# writes a timestamped report to docs/evidence/.
#
# This is an ongoing check, not a one-time exercise: feeds rot quietly. A
# publisher retires RSS, a path changes, a CDN starts refusing programmatic
# requests — and nothing in the app fails loudly, the source just silently
# stops contributing. Re-run this periodically and diff against the last
# report in docs/evidence/.
#
# The in-app list is read out of src/lib/source-catalog.ts and
# src/lib/community-sources.ts
# rather than duplicated here, so it can't drift from what the app actually
# fetches. Add a source there and it's covered here automatically. The
# per-team half is imported rather than parsed — see extract_in_app_sources.
#
# A FAIL can mean "no feed" or "wrong URL" — for newspapers especially, treat
# it as a prompt to go find the real URL, not proof the outlet has no feed.
#
# Usage:
#   bash scripts/check-feeds.sh              # in-app sources only
#   bash scripts/check-feeds.sh --candidates # also probe the not-in-app list
#   bash scripts/check-feeds.sh --help

set -uo pipefail

cd "$(dirname "$0")/.."

CANDIDATES=0
for arg in "$@"; do
  case "$arg" in
    --candidates) CANDIDATES=1 ;;
    --help|-h) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"

# Requests are paced, and a 429 is retried once after a longer wait.
#
# Both exist because of a CI run rather than a theory. From a GitHub
# Actions runner this script reported thirteen of the catalog's local
# papers as HTTP 429, while the same script from a laptop reported all
# thirteen healthy. They share one CMS — the `search/?f=rss` URLs are
# TownNews/BLOX, which Lee Enterprises papers and a lot of student papers
# run — and the script was hitting all of them from a single IP inside two
# seconds, which reads as a scrape. Which ones tripped varied run to run:
# Lincoln Journal Star failed and Wisconsin State Journal passed, then the
# reverse. That variance is the tell that it was our request pattern and
# not their health.
#
# Don't spend more than this trying to be polite — it was measured and it
# does not pay. Four dispatch runs on the same catalog:
#
#   no pacing                              17 failing, ~15s
#   1s pace, 10s retry                     14 failing, ~3min
#   10s pace on those URLs, 30s retry      13 failing, ~9.5min
#   1s pace, 10s retry (repeat)            17 failing, ~3min
#
# Read those honestly: the spread is 13-17 whatever the configuration, so
# pacing's apparent benefit is run-to-run noise, not a result. The 429s
# are not a burst limit that spacing can satisfy — TownNews/BLOX refuses
# the runner's datacenter IP as policy and answers 429 while doing it.
# Those sites are unreachable from CI at any pace.
#
# The cheap second and the single retry stay anyway: they cost three
# minutes of a job nobody waits on, they're the right way to treat someone
# else's server, and they cost nothing at all locally. The ten-second
# variant was tried and dropped. Don't rerun either experiment expecting
# a different answer without new evidence.
#
# Both are env-overridable: PACE_SECONDS=0 restores the old fast behavior
# for an impatient local run, where none of this matters — a home IP never
# sees these 429s at all.
PACE_SECONDS="${PACE_SECONDS:-1}"
RETRY_SECONDS="${RETRY_SECONDS:-10}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

EVIDENCE_DIR="docs/evidence"
mkdir -p "$EVIDENCE_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$EVIDENCE_DIR/feed-status-$STAMP.txt"

pass=0
fail=0

fetch() {
  curl -sS -L --compressed --max-time 20 \
       -A "$UA" \
       -o "$TMP" \
       -w '%{http_code}' \
       "$1" 2>/dev/null
}

check() {
  name="$1"
  url="$2"

  [ "$PACE_SECONDS" = "0" ] || sleep "$PACE_SECONDS"
  status=$(fetch "$url")

  # One retry, and only for rate limiting — see the note above. Anything
  # else (404, 403, a timeout) is a real answer and gets reported as one.
  if [ "$status" = "429" ]; then
    sleep "$RETRY_SECONDS"
    status=$(fetch "$url")
  fi

  if [ "$status" != "200" ]; then
    printf '  %-26s %-9s %s\n' "$name" "HTTP $status" "$url"
    fail=$((fail + 1))
    return
  fi

  # Print which shape the body actually is. This script counted <entry> as
  # a fallback from the start, so Atom feeds always reported OK here —
  # while the app read only the RSS path and silently got nothing from
  # them. Being more tolerant than the app is precisely what let that hide
  # for months, so the format now goes in the report and any future gap
  # between "the script can read it" and "the app can read it" is visible.
  fmt="rss"
  items=$(grep -o '<item[ >]' "$TMP" 2>/dev/null | wc -l | tr -d ' ')
  if [ "${items:-0}" -eq 0 ]; then
    entries=$(grep -o '<entry[ >]' "$TMP" 2>/dev/null | wc -l | tr -d ' ')
    if [ "${entries:-0}" -gt 0 ]; then
      fmt="atom"
      items="$entries"
    fi
  fi

  if [ "${items:-0}" -gt 0 ]; then
    printf '  %-26s %-9s %-5s %s items\n' "$name" "OK" "$fmt" "$items"
    pass=$((pass + 1))
  else
    printf '  %-26s %-9s %s\n' "$name" "EMPTY" "200 but no items — likely not a feed"
    fail=$((fail + 1))
  fi
}

section() {
  printf '\n%s\n' "$1"
}

# Pulls "name<TAB>url" out of the two source files.
#
# The per-team sources are IMPORTED rather than parsed. They used to be
# read with a regex over adjacent name:/url: lines plus a special case for
# the SB_NATION() helper, and that shape had a bad failure mode: adding a
# second helper — ADVANCE() and LEE(), when the chains were generalized —
# dropped twenty-two sources from this report while the app went on
# fetching them, and a report that quietly checks two thirds of the catalog
# looks exactly like a clean one. Importing the module removes the failure
# instead of patching it: the script sees what the app sees, because it is
# the same code. See scripts/lib/app-modules.mjs for how that works with no
# build step and no node_modules.
#
# The national feeds in source-catalog.ts are still read with the regex,
# and have to be: that module reaches feeds.ts and the league catalog at
# runtime — an npm package and a JSON import — so it cannot be loaded this
# way. It has no helpers either, which is what makes the regex safe there
# and unsafe next door.
extract_in_app_sources() {
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON -e '
    const fs = require("fs");
    const out = [];

    const NAME_URL = /name:\s*(["\x27])(.+?)\1,\s*url:\s*(["\x27])(.+?)\3/g;
    const src = fs.readFileSync("src/lib/source-catalog.ts", "utf8");
    for (const m of src.matchAll(NAME_URL)) out.push([m[2], m[4]]);

    import("./scripts/lib/app-modules.mjs")
      .then(({ loadAppModule }) => loadAppModule("@/lib/community-sources"))
      .then((community) => {
        for (const table of Object.values(community.CURATED_SOURCE_TABLES)) {
          for (const feeds of Object.values(table.sourcesBySlug)) {
            for (const feed of feeds) out.push([feed.name, feed.url]);
          }
        }

        const seen = new Set();
        for (const [name, url] of out) {
          if (seen.has(url)) continue;
          seen.add(url);
          console.log(`${name}\t${url}`);
        }
      })
      .catch((error) => {
        // Loud, and on stderr so it cannot be mistaken for a source line.
        // The caller treats an empty extraction as a failure too, but this
        // says which half broke.
        console.error(`!! could not read the community sources: ${error.message}`);
        process.exit(1);
      });
  '
}

{
  printf '%s\n' "Feed liveness report"
  printf '%s\n' "  generated  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  printf '%s\n' "  commit     $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
  printf '%s\n' "  script     scripts/check-feeds.sh$([ "$CANDIDATES" = 1 ] && echo ' --candidates')"

  section "In-app sources (read from src/lib/source-catalog.ts + src/lib/community-sources.ts)"
  in_app_count=0
  while IFS=$'\t' read -r name url; do
    [ -z "${url:-}" ] && continue
    check "$name" "$url"
    in_app_count=$((in_app_count + 1))
  done <<EOF
$(extract_in_app_sources)
EOF

  if [ "$in_app_count" -eq 0 ]; then
    printf '  %s\n' "!! extracted no sources — the parser in extract_in_app_sources()"
    printf '  %s\n' "!! has probably drifted from the shape of those files. Fix it;"
    printf '  %s\n' "!! an empty run here looks like a clean bill of health."
  fi

  if [ "$CANDIDATES" = 1 ]; then
    # Deliberately NOT in the app. Kept so the negative results stay recorded
    # — most of these are expected to fail, and re-discovering that by hand
    # every few months is the waste this section exists to prevent. See the
    # header comment in src/lib/community-sources.ts for the conclusions.
    section "Candidates not in the app (Gannett / Tribune retired or block RSS)"
    check "DMR home"            "https://rssfeeds.desmoinesregister.com/desmoinesregister/home"
    check "DMR sports"          "https://rssfeeds.desmoinesregister.com/desmoinesregister/sports"
    check "IndyStar home"       "https://rssfeeds.indystar.com/indystar/home"
    check "IndyStar sports"     "https://rssfeeds.indystar.com/indystar/sports"
    check "ChiTrib sports"      "https://www.chicagotribune.com/sports/feed/"
    check "ChiTrib arc"         "https://www.chicagotribune.com/arc/outboundfeeds/rss/category/sports/?outputType=xml"
    check "BaltSun sports"      "https://www.baltimoresun.com/sports/feed/"
    check "BaltSun arc"         "https://www.baltimoresun.com/arc/outboundfeeds/rss/category/sports/?outputType=xml"

    section "Alternates for programs with no local newsroom feed"
    check "Gazette (Iowa)"      "https://www.thegazette.com/feed/"
    check "HawkCentral (Iowa)"  "https://rssfeeds.desmoinesregister.com/hawkcentral/home"
    check "Herald-Times (IU)"   "https://rssfeeds.heraldtimesonline.com/heraldtimesonline/home"
    check "J&C (Purdue)"        "https://rssfeeds.jconline.com/jconline/home"
    check "Daily Northwestern"  "https://dailynorthwestern.com/feed/"
    check "Diamondback (Md)"    "https://dbknews.com/feed/"
    check "Daily Illini"        "https://dailyillini.com/feed/"

    section "Student papers (not currently used)"
    check "Lantern (Ohio St)"   "https://www.thelantern.com/feed/"
    check "Michigan Daily"      "https://www.michigandaily.com/feed/"
    check "Daily Cardinal (Wis)" "https://www.dailycardinal.com/search/?f=rss&t=article&c=sports&l=50"
  fi

  printf '\n%s\n' "----------------------------------------"
  printf '%s\n' "  $pass passing, $fail failing"
  printf '%s\n' "----------------------------------------"
} | tee "$OUT"

printf '\nWrote %s\n' "$OUT"
