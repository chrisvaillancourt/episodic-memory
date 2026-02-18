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
