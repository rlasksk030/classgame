import test from "node:test";
import assert from "node:assert/strict";
import { readAllRows } from "../supabase/functions/_shared/pagination.ts";

test("a class with more than 1,000 attempts retains every row without duplicate page boundaries", async () => {
  const source = Array.from({ length: 2305 }, (_, id) => ({ id }));
  const ranges: number[][] = [];
  const result = await readAllRows(async (from, to) => {
    ranges.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.data, source);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("a failed later page returns an error and discards the partial summary", async () => {
  const failure = { message: "connection lost" };
  const result = await readAllRows(async from => from === 0
    ? { data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }
    : { data: null, error: failure });
  assert.equal(result.error, failure);
  assert.deepEqual(result.data, []);
});

test("empty and exactly full final pages terminate safely", async () => {
  assert.deepEqual(await readAllRows(async () => ({ data: [], error: null })), { data: [], error: null });
  let requests = 0;
  const result = await readAllRows(async from => {
    requests++;
    return { data: from === 0 ? Array.from({ length: 1000 }, (_, id) => id) : [], error: null };
  });
  assert.equal(result.data.length, 1000);
  assert.equal(requests, 2);
});
