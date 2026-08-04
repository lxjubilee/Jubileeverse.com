'use strict';
/**
 * The per-run article cap must actually bind.
 *
 * `--max-new` is what makes a four-runs-a-day schedule mean 15 articles a run
 * rather than a whole day's worth in the first run. Counting COMPLETIONS to
 * enforce it does not work: with a concurrency window every worker already in
 * flight finishes past the limit, and a live run at a cap of 15 composed and
 * published 17. Slots have to be claimed before the call, not counted after it.
 *
 * This models the claim loop rather than importing the script, which would drag
 * in R2 credentials and the whole module graph for a scheduling question.
 */

/** The claim-before-call loop from composeRealtime, in isolation. */
async function runQuota({ items, target, concurrency, compose }) {
    const results = [];
    let cursor = 0;
    let claimed = 0;

    const worker = async () => {
        for (;;) {
            if (claimed >= target) return;
            const item = items[cursor++];
            if (item === undefined) return;
            claimed++;
            try {
                results.push(await compose(item));
            } catch {
                claimed--;
            }
        }
    };

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    return results.slice(0, target);
}

const settle = (value, ms = 0) => new Promise(res => setTimeout(() => res(value), ms));

describe('per-run article quota', () => {
    test('a cap of 15 at concurrency 3 composes exactly 15, not 17', async () => {
        let calls = 0;
        const out = await runQuota({
            items: Array.from({ length: 40 }, (_, i) => i),
            target: 15,
            concurrency: 3,
            compose: async (i) => { calls++; return settle(i, 1); },
        });
        expect(out).toHaveLength(15);
        expect(calls).toBe(15);
    });

    test.each([[1], [3], [8]])('holds at concurrency %i', async (concurrency) => {
        let calls = 0;
        const out = await runQuota({
            items: Array.from({ length: 60 }, (_, i) => i),
            target: 15,
            concurrency,
            compose: async (i) => { calls++; return settle(i, 1); },
        });
        expect(out).toHaveLength(15);
        expect(calls).toBe(15);
    });

    test('a failed composition frees its slot so the target is still met', async () => {
        // Otherwise a run with a few refusals quietly publishes short.
        let calls = 0;
        const out = await runQuota({
            items: Array.from({ length: 40 }, (_, i) => i),
            target: 15,
            concurrency: 3,
            compose: async (i) => {
                calls++;
                if (i % 3 === 0) throw new Error('refused');
                return settle(i, 1);
            },
        });
        expect(out).toHaveLength(15);
        expect(calls).toBeGreaterThan(15);
    });

    test('runs short rather than inventing filler when the feeds are thin', async () => {
        const out = await runQuota({
            items: [1, 2, 3],
            target: 15,
            concurrency: 3,
            compose: async (i) => settle(i, 1),
        });
        expect(out).toHaveLength(3);
    });

    test('a target of zero composes nothing at all', async () => {
        let calls = 0;
        const out = await runQuota({
            items: [1, 2, 3],
            target: 0,
            concurrency: 3,
            compose: async (i) => { calls++; return settle(i, 1); },
        });
        expect(out).toHaveLength(0);
        expect(calls).toBe(0);
    });
});

describe('day target vs per-run cap', () => {
    // remaining = min(maxNew, target - alreadyPublished)
    const remaining = (target, maxNew, published) => Math.min(maxNew, Math.max(0, target - published));

    test('four runs of 15 reach 60 and then stop', () => {
        let published = 0;
        const perRun = [];
        for (let run = 0; run < 4; run++) {
            const n = remaining(60, 15, published);
            perRun.push(n);
            published += n;
        }
        expect(perRun).toEqual([15, 15, 15, 15]);
        expect(published).toBe(60);
    });

    test('a fifth run in the same day publishes nothing', () => {
        expect(remaining(60, 15, 60)).toBe(0);
    });

    test('a missed run is not made up for — the day just ends short', () => {
        // Deliberate: a catch-up run would double both the load on the outlets
        // and the model spend at the exact moment something is already wrong.
        let published = 0;
        for (const ran of [true, false, true, true]) {
            if (ran) published += remaining(60, 15, published);
        }
        expect(published).toBe(45);
    });

    test('the day target still wins when it is below the per-run cap', () => {
        expect(remaining(10, 15, 0)).toBe(10);
        expect(remaining(60, 15, 50)).toBe(10);
    });
});
