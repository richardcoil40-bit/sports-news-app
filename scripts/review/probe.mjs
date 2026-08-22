/**
 * Asks a URL whether it is a live feed, on scripts/check-feeds.sh's terms.
 *
 * The same question, deliberately answered the same way: the same browser
 * user agent, the same 20-second ceiling, the same single retry for a 429
 * and nothing else, the same "200 with no items is a failure, not a pass"
 * verdict, and the same `<item>`-then-`<entry>` format detection that made
 * the seventeen dead Atom feeds visible. A worksheet that graded a feed
 * more generously than the liveness report would be worse than useless —
 * it would approve sources that the report then fails.
 *
 * Kept in Node rather than shelling out to the script because the script
 * checks the whole catalog and writes an evidence file; this checks one
 * candidate that is not in the catalog yet. Same rules, different question.
 *
 * The pacing note in check-feeds.sh applies here too and is worth reading
 * before changing PACE_SECONDS: the sixteen TownNews/BLOX papers refuse
 * datacenter addresses as policy, and no amount of politeness fixes that.
 * A second between requests costs nothing from a laptop, which is where
 * this is meant to run.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const TIMEOUT_MS = 20_000;
const RETRY_SECONDS = 10;

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function fetchOnce(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, body: response.ok ? await response.text() : '' };
}

/** `<item>` first, then `<entry>` — an Atom feed is a feed, and says so. */
function countItems(body) {
  const items = body.match(/<item[ >]/g)?.length ?? 0;
  if (items > 0) return { format: 'rss', items };
  const entries = body.match(/<entry[ >]/g)?.length ?? 0;
  return { format: entries > 0 ? 'atom' : 'none', items: entries };
}

/**
 * One candidate's verdict: `OK`, `EMPTY` (answered, but not with a feed),
 * `HTTP <code>`, or `ERROR` for a refused connection or a timeout — the
 * distinction docs/source-reliability.md says to read before deciding
 * whether to guess again or give up.
 */
export async function probeFeed(url, { paceSeconds = 1 } = {}) {
  if (paceSeconds > 0) await sleep(paceSeconds);

  let result;
  try {
    result = await fetchOnce(url);
    if (result.status === 429) {
      await sleep(RETRY_SECONDS);
      result = await fetchOnce(url);
    }
  } catch (error) {
    return { url, status: 'ERROR', detail: error.message, format: null, items: 0 };
  }

  if (result.status !== 200) {
    return { url, status: `HTTP ${result.status}`, detail: '', format: null, items: 0 };
  }

  const { format, items } = countItems(result.body);
  if (items === 0) {
    return { url, status: 'EMPTY', detail: '200 but no items — likely not a feed', format: null, items: 0 };
  }
  return { url, status: 'OK', detail: '', format, items };
}
