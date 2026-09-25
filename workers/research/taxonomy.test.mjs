import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CATEGORIES, taxonomyTopics } from "./taxonomy.js";

const migration = readFileSync(new URL("../../supabase/migrations/20260925034500_research_taxonomy_access.sql", import.meta.url), "utf8");
const originalCatalog = readFileSync(new URL("../../supabase/migrations/20260924220000_research_catalog.sql", import.meta.url), "utf8");

test("controlled taxonomy has four categories and 21 unique topics", () => {
  const topics = taxonomyTopics();
  assert.equal(CATEGORIES.length, 4);
  assert.equal(topics.length, 21);
  assert.equal(new Set(CATEGORIES.map((category) => category.slug)).size, 4);
  assert.equal(new Set(topics.map((topic) => topic.slug)).size, 21);
  assert.deepEqual(CATEGORIES.map((category) => category.sortOrder), [1, 2, 3, 4]);
  for (const category of CATEGORIES) {
    assert.deepEqual(category.topics.map((_, index) => index + 1), category.topics.map((_, index) => index + 1));
    for (const [slug] of category.topics) {
      assert.equal(topics.filter((topic) => topic.slug === slug && topic.categorySlug === category.slug).length, 1);
    }
  }
});

test("taxonomy seed is idempotent and preserves slugs", () => {
  assert.equal(migration.includes("ON CONFLICT (slug) DO UPDATE"), true);
  assert.equal(migration.includes("DELETE FROM public.research_works"), false);
  assert.equal(migration.includes("DELETE FROM public.research_topics"), false);
  for (const category of CATEGORIES) {
    assert.equal(migration.includes(`'${category.slug}'`), true);
  }
  for (const topic of taxonomyTopics()) {
    assert.equal(migration.includes(`'${topic.slug}'`), true);
    assert.equal(migration.includes(topic.displayName), true);
  }
  assert.equal(migration.includes("WHERE public.research_topics.status IS DISTINCT FROM 'deprecated'"), true);
});

test("access boundary and rights stay separate", () => {
  assert.equal(migration.includes("access_tier IN ('public', 'premium', 'internal')"), true);
  assert.equal(migration.includes("status = 'published' AND access_tier = 'public'"), true);
  assert.equal(migration.includes("CREATE POLICY research_categories_admin_write"), true);
  assert.equal(migration.includes("only active controlled topics can be assigned"), true);
  assert.equal(originalCatalog.includes("copyrighted_full_text_prohibited"), true);
  assert.equal(originalCatalog.includes("research_works_publishable_rights"), true);
  assert.equal(migration.includes("DROP CONSTRAINT research_works_publishable_rights"), false);
});
