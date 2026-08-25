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
#
# ## Parallelism, added later, on the axis that comment never tested
#
# Everything above is about how far apart two requests to the SAME operator
# should be. It says nothing about running DIFFERENT operators at once,
# which is the axis that actually costs three minutes: the script was
# strictly serial, so 60 sources meant 60 sequential one-second waits
# against 60 unrelated servers, none of which were waiting on each other.
#
# So requests are now grouped by operator and the groups run concurrently,
# while each group stays sequential and paced exactly as before. Nobody
# receives requests any faster than they did; the waiting just happens in
# parallel. The measured 13-17 CI baseline is a property of who answers a
# datacenter IP, not of dispatch order, and is expected to be unchanged.
#
# **The unit is the operator, not the host, and that distinction is the
# whole thing.** All 60 in-app sources are on 60 different hosts, so
# grouping by host would put every one of them in its own group and fire
# all sixteen TownNews/BLOX papers simultaneously — which is the "single IP
# inside two seconds, reads as a scrape" pattern the runs above were
# investigating. Grouped by operator the catalog is 14 groups: 27 SB
# Nation, 16 TownNews/BLOX, 6 Arc, and 11 papers standing alone. Those
# three patterns are the same ones OWNER_FEED_URL names in
# community-sources.ts, for the same reason: these papers live and die as a
# chain.
#
# The critical path is now the largest group rather than the whole list, so
# the ceiling is ~27 paced requests instead of 60. If a future catalog puts
# 200 sources behind one operator, that group is the cost and splitting it
# is not something to do without re-reading the runs above.
#
# MAX_PARALLEL bounds how many groups are in flight; 1 restores the old
# fully-serial behaviour if a run ever needs to be compared like-for-like.
PACE_SECONDS="${PACE_SECONDS:-1}"
RETRY_SECONDS="${RETRY_SECONDS:-10}"
MAX_PARALLEL="${MAX_PARALLEL:-8}"

# The app's own fetch budget, imported rather than restated.
#
# curl gets 20s below, on purpose: this script asks whether a feed exists
# at all, and a generous budget is right for that question. src/lib/http.ts
# gives the app 10s, because a phone cannot wait. A source that lands
# between those two numbers passes here and times out on every device —
# alive in the report, absent from the feed.
#
# That gap is the same shape as the Atom problem the format column exists
# to expose: being more tolerant than the app is exactly what lets a source
# look healthy while contributing nothing. WV MetroNews sat in it for a day
# (16-20s against a 10s budget), which is why the number is read from the
# app here rather than being nobody's job to notice.
APP_TIMEOUT_MS="${APP_TIMEOUT_MS:-$(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON -e '
  import("./scripts/lib/app-modules.mjs")
    .then(({ loadAppModule }) => loadAppModule("@/lib/http"))
    .then((http) => console.log(http.FETCH_TIMEOUT_MS))
    .catch(() => console.log(""));
' 2>/dev/null)}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

EVIDENCE_DIR="docs/evidence"
mkdir -p "$EVIDENCE_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$EVIDENCE_DIR/feed-status-$STAMP.txt"
OUT_JSON="$EVIDENCE_DIR/feed-status-$STAMP.json"

# The job list, built before anything is fetched. Every entry is one line:
#   S<TAB><heading>              a section break
#   C<TAB><name><TAB><url>       a source to check
#
# Building it first is what allows the fetches to be reordered without the
# report being reordered: the sequence number here is the line number, and
# render() walks this file, not the order results came back in. That matters
# more than it sounds — docs/evidence/README.md's whole premise is diffing a
# report against the last one, and a report whose line order depends on which
# server answered first would diff against itself.
JOBS="$WORK/jobs"
: > "$JOBS"

section() {
  printf 'S\t%s\n' "$1" >> "$JOBS"
}

enqueue() {
  printf 'C\t%s\t%s\t%s\n' "$1" "$2" "$(operator_of "$2")" >> "$JOBS"
}

# A literal line in the report. Only one thing uses it, and that thing is the
# reason it exists rather than a printf: the extractor-drift warning has to
# appear IN the report, because .github/workflows/feed-check.yml greps the
# report for it and fails the run. Printed beside the report instead, it would
# scroll past in a log nobody reads and the check would go green.
note() {
  printf 'N\t%s\n' "$1" >> "$JOBS"
}

# Prints "<status> <milliseconds>". The timing comes from curl rather than
# from `date` around the call: whole-second resolution rounds a 10.9s
# response down to 10, which is exactly the boundary the SLOW check sits on.
fetch() {
  curl -sS -L --compressed --max-time 20 \
       -A "$UA" \
       -o "$2" \
       -w '%{http_code} %{time_total}' \
       "$1" 2>/dev/null |
    awk '{ printf "%s %d", $1, ($2 * 1000) }'
}

# Which operator serves this URL — the unit requests are paced within.
#
# The three patterns are the ones OWNER_FEED_URL names in
# community-sources.ts. They are matched here rather than imported because
# this runs per URL inside a shell loop, and because a URL that matches none
# of them still needs an answer; falling back to the host gives every
# unaffiliated paper its own group, which is correct — it IS its own
# operator. See the parallelism note above for why host alone is the wrong
# unit for the three that are affiliated.
operator_of() {
  case "$1" in
    *search/\?f=rss*)    printf 'lee-townnews\n' ;;
    *arc/outboundfeeds*) printf 'advance-arc\n' ;;
    */rss/index.xml)     printf 'sb-nation\n' ;;
    # Gannett's news sitemaps (plus the Statesman's nonstandard child
    # path) — one platform serves every masthead, so one pacing group.
    */news-sitemap.xml|*/sitemap/news/*) printf 'gannett-sitemap\n' ;;
    *) printf '%s\n' "$1" | sed -E 's#^https?://([^/]+).*#\1#' ;;
  esac
}

# One source, fetched and classified. Writes a single record:
#   <status>|<detail>|<format>|<items>
#
# Pipe-separated rather than tab, and that is not a style choice. `read` with
# IFS set to a *whitespace* character — and tab is one — collapses runs of it,
# so an empty middle field silently disappears and every field after it shifts
# left by one. An OK record has an empty detail, so under tabs the format
# column vanished and the item count landed in it. A non-whitespace IFS keeps
# empty fields; none of the four values can contain a pipe.
# Everything that decides pass/fail lives here; nothing counts anything,
# because this runs in a subshell and a counter incremented there would be
# discarded on exit. render() does the counting from the records.
probe() {
  url="$1"
  body="$2"

  [ "$PACE_SECONDS" = "0" ] || sleep "$PACE_SECONDS"
  read -r status elapsed <<EOF
$(fetch "$url" "$body")
EOF

  # One retry, and only for rate limiting — see the note above. Anything
  # else (404, 403, a timeout) is a real answer and gets reported as one.
  if [ "$status" = "429" ]; then
    sleep "$RETRY_SECONDS"
    read -r status elapsed <<EOF
$(fetch "$url" "$body")
EOF
  fi

  if [ "$status" != "200" ]; then
    printf 'HTTP|HTTP %s||0|%s\n' "$status" "$elapsed"
    return
  fi

  # Print which shape the body actually is. This script counted <entry> as
  # a fallback from the start, so Atom feeds always reported OK here —
  # while the app read only the RSS path and silently got nothing from
  # them. Being more tolerant than the app is precisely what let that hide
  # for months, so the format now goes in the report and any future gap
  # between "the script can read it" and "the app can read it" is visible.
  fmt="rss"
  items=$(grep -o '<item[ >]' "$body" 2>/dev/null | wc -l | tr -d ' ')
  if [ "${items:-0}" -eq 0 ]; then
    entries=$(grep -o '<entry[ >]' "$body" 2>/dev/null | wc -l | tr -d ' ')
    if [ "${entries:-0}" -gt 0 ]; then
      fmt="atom"
      items="$entries"
    fi
  fi

  # News sitemaps — the Gannett recovery path; see SITEMAP() in
  # community-sources.ts and the sitemap branch in feeds.ts. The <urlset>
  # guard is load-bearing: an RSS channel's <image> carries a bare <url>
  # element too, so an empty RSS feed without it would misreport as a
  # healthy sitemap instead of EMPTY.
  if [ "${items:-0}" -eq 0 ] && grep -q '<urlset' "$body" 2>/dev/null; then
    urls=$(grep -o '<url>' "$body" 2>/dev/null | wc -l | tr -d ' ')
    if [ "${urls:-0}" -gt 0 ]; then
      fmt="sitemap"
      items="$urls"
    fi
  fi

  if [ "${items:-0}" -gt 0 ]; then
    printf 'OK||%s|%s|%s\n' "$fmt" "$items" "$elapsed"
  else
    printf 'EMPTY|200 but no items — likely not a feed||0|%s\n' "$elapsed"
  fi
}

# Every source in one operator's group, in order, each paced from the last.
# The group is the sequential unit; groups are what run at the same time.
run_group() {
  # The response body scratch file is named after the group file, NOT after
  # $$. In bash, $$ is the *parent* shell's pid even inside a subshell, so
  # every group in flight would name the same file and overwrite each other's
  # download mid-read. That failed the way a race does rather than the way a
  # bug does: item counts came back low and two healthy feeds reported EMPTY,
  # which reads exactly like a publisher having a bad morning.
  body="$1.body"
  while IFS=$'\t' read -r seq name url; do
    [ -z "${url:-}" ] && continue
    probe "$url" "$body" > "$WORK/result.$seq"
  done < "$1"
  rm -f "$body"
}

# Fan the job list out into one file per operator, then run those files
# concurrently, at most MAX_PARALLEL at a time.
#
# The batching is deliberately the dumb kind — launch N, `wait` for all N,
# launch the next N — because `wait -n` needs bash 4.3 and macOS still ships
# 3.2, which is where this script is actually run. A batch is only as fast as
# its slowest group, which costs a little; needing a second shell to run the
# tool at all would cost more.
run_jobs() {
  # The operator was resolved by operator_of() when the job was enqueued and
  # is carried in field 4, so this only has to make it safe as a filename.
  # Re-deriving it here would be a second copy of the rule, and a grouping
  # that disagreed with the operator reported in the JSON is the kind of
  # discrepancy nobody looks for.
  awk -F'\t' -v work="$WORK" '
    $1 == "C" {
      g = $4
      gsub(/[^A-Za-z0-9._-]/, "_", g)
      print NR "\t" $2 "\t" $3 >> (work "/group." g)
    }
  ' "$JOBS"

  running=0
  for group in "$WORK"/group.*; do
    [ -e "$group" ] || continue
    run_group "$group" &
    running=$((running + 1))
    if [ "$running" -ge "$MAX_PARALLEL" ]; then
      wait
      running=0
    fi
  done
  wait
}

# The report, rebuilt in job-list order from the records the groups wrote.
# Emits the text report on stdout and the JSON sidecar to $OUT_JSON.
render() {
  pass=0
  fail=0
  slow_count=0
  seq=0
  first=1
  printf '[\n' > "$OUT_JSON"

  while IFS=$'\t' read -r kind a b op; do
    seq=$((seq + 1))
    if [ "$kind" = "S" ]; then
      printf '\n%s\n' "$a"
      current_section="$a"
      continue
    fi
    if [ "$kind" = "N" ]; then
      printf '%s\n' "$a"
      continue
    fi

    IFS='|' read -r status detail fmt items elapsed < "$WORK/result.$seq" 2>/dev/null || status=""
    if [ -z "${status:-}" ]; then
      status="HTTP"
      detail="HTTP no-result"
      fmt=""
      items=0
      elapsed=0
    fi

    # Alive, and slower than the app will wait. Still counted as a pass,
    # because the feed is real — but called out, because this is the one
    # outcome the report used to render as unqualified health.
    slow=""
    if [ "$status" = "OK" ] && [ -n "${APP_TIMEOUT_MS:-}" ] && [ "${elapsed:-0}" -gt 0 ]; then
      if [ "${elapsed:-0}" -gt "$APP_TIMEOUT_MS" ]; then
        slow="  SLOW $(awk -v ms="$elapsed" 'BEGIN{printf "%.1f", ms/1000}')s > $(awk -v ms="$APP_TIMEOUT_MS" 'BEGIN{printf "%g", ms/1000}')s app timeout"
        slow_count=$(( slow_count + 1 ))
      fi
    fi

    if [ "$status" = "OK" ]; then
      printf '  %-26s %-9s %-5s %s items%s\n' "$a" "OK" "$fmt" "$items" "$slow"
      pass=$((pass + 1))
    elif [ "$status" = "EMPTY" ]; then
      printf '  %-26s %-9s %s\n' "$a" "EMPTY" "$detail"
      fail=$((fail + 1))
    else
      printf '  %-26s %-9s %s\n' "$a" "$detail" "$b"
      fail=$((fail + 1))
    fi

    [ "$first" = 1 ] || printf ',\n' >> "$OUT_JSON"
    first=0
    printf '  {"name": %s, "url": %s, "section": %s, "operator": %s, "status": %s, "detail": %s, "format": %s, "items": %s, "ms": %s}' \
      "$(json_string "$a")" "$(json_string "$b")" "$(json_string "${current_section:-}")" \
      "$(json_string "${op:-}")" "$(json_string "$status")" "$(json_string "${detail:-}")" \
      "$(json_string "${fmt:-}")" "${items:-0}" "${elapsed:-0}" >> "$OUT_JSON"
  done < "$JOBS"

  printf '\n]\n' >> "$OUT_JSON"

  printf '\n%s\n' "----------------------------------------"
  printf '%s\n' "  $pass passing, $fail failing$([ "$slow_count" -gt 0 ] && echo ", $slow_count slower than the app will wait")"
  printf '%s\n' "----------------------------------------"
}

# Minimal JSON string escaping. Only what can actually appear in a source
# name, a URL or a section heading and break the document: a backslash, a
# double quote, and control characters, since names are human-written.
#
# Built with shell substitution rather than sed, because sed works on lines
# and an empty string has none — it emitted nothing at all for a field like
# an OK record's empty `detail`, producing `"detail": ,` and a JSON file no
# parser would open. The text report was fine, which is exactly how a broken
# sidecar would go unnoticed.
json_string() {
  escaped="$1"
  escaped="${escaped//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"
  escaped="$(printf '%s' "$escaped" | LC_ALL=C tr -d '\000-\037')"
  printf '"%s"' "$escaped"
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

# Build the job list, run it, then render. Three phases rather than one
# streamed pass, because the fetches no longer happen in report order — see
# the parallelism note above.
#
# The header is written before any request goes out, so a run killed halfway
# still leaves a file that says what it was and when it started.
{
  printf '%s\n' "Feed liveness report"
  printf '%s\n' "  generated  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  printf '%s\n' "  commit     $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
  printf '%s\n' "  script     scripts/check-feeds.sh$([ "$CANDIDATES" = 1 ] && echo ' --candidates')"
} | tee "$OUT"

section "In-app sources (read from src/lib/source-catalog.ts + src/lib/community-sources.ts)"
in_app_count=0
while IFS=$'\t' read -r name url; do
  [ -z "${url:-}" ] && continue
  enqueue "$name" "$url"
  in_app_count=$((in_app_count + 1))
done <<EOF
$(extract_in_app_sources)
EOF

if [ "$in_app_count" -eq 0 ]; then
  note "  !! extracted no sources — the parser in extract_in_app_sources()"
  note "  !! has probably drifted from the shape of those files. Fix it;"
  note "  !! an empty run here looks like a clean bill of health."
fi

if [ "$CANDIDATES" = 1 ]; then
  # Deliberately NOT in the app. Kept so the negative results stay recorded
  # — most of these are expected to fail, and re-discovering that by hand
  # every few months is the waste this section exists to prevent. See the
  # header comment in src/lib/community-sources.ts for the conclusions.
  section "Candidates not in the app (Gannett / Tribune retired or block RSS)"
  enqueue "DMR home"            "https://rssfeeds.desmoinesregister.com/desmoinesregister/home"
  enqueue "DMR sports"          "https://rssfeeds.desmoinesregister.com/desmoinesregister/sports"
  enqueue "IndyStar home"       "https://rssfeeds.indystar.com/indystar/home"
  enqueue "IndyStar sports"     "https://rssfeeds.indystar.com/indystar/sports"
  enqueue "ChiTrib sports"      "https://www.chicagotribune.com/sports/feed/"
  enqueue "ChiTrib arc"         "https://www.chicagotribune.com/arc/outboundfeeds/rss/category/sports/?outputType=xml"
  enqueue "BaltSun sports"      "https://www.baltimoresun.com/sports/feed/"
  enqueue "BaltSun arc"         "https://www.baltimoresun.com/arc/outboundfeeds/rss/category/sports/?outputType=xml"

  section "Alternates for programs with no local newsroom feed"
  enqueue "Gazette (Iowa)"      "https://www.thegazette.com/feed/"
  enqueue "HawkCentral (Iowa)"  "https://rssfeeds.desmoinesregister.com/hawkcentral/home"
  enqueue "Herald-Times (IU)"   "https://rssfeeds.heraldtimesonline.com/heraldtimesonline/home"
  enqueue "J&C (Purdue)"        "https://rssfeeds.jconline.com/jconline/home"
  enqueue "Daily Northwestern"  "https://dailynorthwestern.com/feed/"
  enqueue "Diamondback (Md)"    "https://dbknews.com/feed/"
  enqueue "Daily Illini"        "https://dailyillini.com/feed/"

  section "Student papers (not currently used)"
  enqueue "Lantern (Ohio St)"   "https://www.thelantern.com/feed/"
  enqueue "Michigan Daily"      "https://www.michigandaily.com/feed/"
  enqueue "Daily Cardinal (Wis)" "https://www.dailycardinal.com/search/?f=rss&t=article&c=sports&l=50"
fi

run_jobs
render | tee -a "$OUT"

printf '\nWrote %s\n' "$OUT_JSON"
printf 'Wrote %s\n' "$OUT"

