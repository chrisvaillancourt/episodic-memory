import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { searchConversations } from '../src/search.js';
import { searchMultipleConcepts } from '../src/search.js';
import { initDatabase } from '../src/db.js';
import { initEmbeddings, generateEmbedding } from '../src/embeddings.js';
import { getFixturePath } from './test-utils.js';
import { indexTestFiles } from './test-indexer.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Bug 2: similarity score calculation', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-bug2-'));
    process.env.EPISODIC_MEMORY_DB_PATH = path.join(tmpDir, 'test.db');
    await indexTestFiles([
      getFixturePath('short-conversation.jsonl'),
      getFixturePath('long-conversation.jsonl'),
    ]);
  }, 120_000);

  afterAll(() => {
    delete process.env.EPISODIC_MEMORY_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return similarity scores between 0 and 1', async () => {
    const results = await searchConversations('Python class design', {
      limit: 5,
      mode: 'vector'
    });

    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => {
      expect(r.similarity).toBeDefined();
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    });
  });

  it('should not produce negative similarity for distant matches', async () => {
    const results = await searchConversations('quantum physics black hole thermodynamics', {
      limit: 10,
      mode: 'vector'
    });

    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => {
      expect(r.similarity).toBeDefined();
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
    });
  });

  it('should rank semantically related queries higher than unrelated', async () => {
    const relatedResults = await searchConversations('Employee class design', {
      limit: 1,
      mode: 'vector'
    });
    const unrelatedResults = await searchConversations('medieval castle architecture', {
      limit: 1,
      mode: 'vector'
    });

    if (relatedResults.length > 0 && unrelatedResults.length > 0) {
      expect(relatedResults[0].similarity!).toBeGreaterThan(unrelatedResults[0].similarity!);
    }
  });

  it('should compute cosine similarity from L2 distance correctly', async () => {
    const results = await searchConversations('class', {
      limit: 1,
      mode: 'vector'
    });

    expect(results.length).toBeGreaterThan(0);

    // Verify the formula by querying raw distance directly
    const db = initDatabase();
    await initEmbeddings();
    const queryEmbedding = await generateEmbedding('class');
    const rawResult = db.prepare(`
      SELECT vec.distance
      FROM vec_exchanges AS vec
      WHERE vec.embedding MATCH ?
        AND k = 1
    `).get(Buffer.from(new Float32Array(queryEmbedding).buffer)) as any;
    db.close();

    const l2Distance = rawResult.distance;
    const expectedSimilarity = Math.max(0, 1 - (l2Distance ** 2) / 2);

    expect(results[0].similarity).toBeCloseTo(expectedSimilarity, 5);
  });
});

describe('Bug 2b: multi-concept similarity cascade', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-bug2b-'));
    process.env.EPISODIC_MEMORY_DB_PATH = path.join(tmpDir, 'test.db');
    await indexTestFiles([
      getFixturePath('large-conversation.jsonl'),
      getFixturePath('long-conversation.jsonl'),
    ]);
  }, 120_000);

  afterAll(() => {
    delete process.env.EPISODIC_MEMORY_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should produce averageSimilarity between 0 and 1', async () => {
    const results = await searchMultipleConcepts(
      ['code', 'testing'],
      { limit: 5 }
    );

    if (results.length > 0) {
      results.forEach(r => {
        expect(r.averageSimilarity).toBeGreaterThanOrEqual(0);
        expect(r.averageSimilarity).toBeLessThanOrEqual(1);
        r.conceptSimilarities.forEach(sim => {
          expect(sim).toBeGreaterThanOrEqual(0);
          expect(sim).toBeLessThanOrEqual(1);
        });
      });
    }
  });

  it('should not produce negative conceptSimilarities for unrelated queries', async () => {
    const results = await searchMultipleConcepts(
      ['quantum physics', 'medieval architecture'],
      { limit: 5 }
    );

    if (results.length > 0) {
      results.forEach(r => {
        expect(r.averageSimilarity).toBeGreaterThanOrEqual(0);
        r.conceptSimilarities.forEach(sim => {
          expect(sim).toBeGreaterThanOrEqual(0);
        });
      });
    }
  });
});

describe('Bug 1: kNN time filter under-fetch', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-bug1-'));
    process.env.EPISODIC_MEMORY_DB_PATH = path.join(tmpDir, 'test.db');
    // large-conversation: ~180 exchanges on 2025-09-19 to 2025-09-20
    // long-conversation: ~114 exchanges on 2025-10-08
    // Combined: ~294 exchanges across 3 dates
    await indexTestFiles([
      getFixturePath('large-conversation.jsonl'),
      getFixturePath('long-conversation.jsonl'),
    ]);
  }, 120_000);

  afterAll(() => {
    delete process.env.EPISODIC_MEMORY_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return requested number of results with after filter', async () => {
    // after='2025-10-08' limits to ~114 exchanges from long-conversation
    // Without fix: k=10 grabs 10 global nearest, few from 10-08 => under-return
    const results = await searchConversations('code implementation', {
      limit: 10,
      mode: 'vector',
      after: '2025-10-08'
    });

    expect(results.length).toBe(10);
    results.forEach(r => {
      expect(r.exchange.timestamp >= '2025-10-08').toBe(true);
    });
  });

  it('should return requested number of results with before filter', async () => {
    // before='2025-09-21' includes large-conversation (~180 exchanges)
    // but excludes long-conversation (10-08)
    const results = await searchConversations('implementation', {
      limit: 10,
      mode: 'vector',
      before: '2025-09-21'
    });

    expect(results.length).toBe(10);
    results.forEach(r => {
      expect(r.exchange.timestamp <= '2025-09-21').toBe(true);
    });
  });

  it('should return requested number of results with date range', async () => {
    // Use before='2025-09-21' to include all of 2025-09-20
    // (timestamps are ISO strings, so '2025-09-20T...' > '2025-09-20')
    const results = await searchConversations('code', {
      limit: 10,
      mode: 'vector',
      after: '2025-09-19',
      before: '2025-09-21'
    });

    expect(results.length).toBe(10);
    results.forEach(r => {
      expect(r.exchange.timestamp >= '2025-09-19').toBe(true);
      expect(r.exchange.timestamp <= '2025-09-21').toBe(true);
    });
  });

  it('should still respect limit when no time filter is present', async () => {
    const results = await searchConversations('code', {
      limit: 5,
      mode: 'vector'
    });

    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.length).toBeGreaterThan(0);
  });
});
