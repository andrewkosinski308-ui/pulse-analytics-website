import { resolveImportTarget } from "./duplicates.js";
import { plainText, slugify } from "./validate.js";

const WORK_SELECT = [
  "id",
  "title",
  "slug",
  "resource_type",
  "publication_date",
  "status",
  "source_url",
  "external_id",
  "retrieved_at",
  "rights_class",
  "summary",
  "open_access",
  "doi",
  "venue",
  "methodology",
  "limitations",
  "limitations_unknown",
  "updated_at",
  "research_providers(key,attribution_text)",
  "research_resource_contributors(role,research_contributors(full_name))",
  "research_resource_topics(research_topics(name,slug))",
  "research_licenses(name,url,notes)"
].join(",");

// Public catalog reads share this entry point. Primary and fallback callers
// pass different Supabase clients and the same options.
export async function getPublishedResearchCatalog(options, catalog) {
  if (options.slug) return catalog.getPublished(options.slug);
  const [page, facets] = await Promise.all([catalog.list(options.query), catalog.facets()]);
  return { ...page, facets };
}

export function createCatalog(env, fetchImpl = fetch) {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  return {
    async list(query) {
      const select = query.topic
        ? WORK_SELECT.replace(
            "research_resource_topics(research_topics(name,slug))",
            "research_resource_topics!inner(research_topics!inner(name,slug))"
          )
        : WORK_SELECT;
      const params = new URLSearchParams();
      params.set("select", select);
      params.set("status", "eq.published");
      params.set("order", query.sort === "title" ? "title.asc" : "publication_date.desc.nullslast,title.asc");
      params.set("limit", String(query.pageSize));
      params.set("offset", String((query.page - 1) * query.pageSize));
      if (query.type) params.set("resource_type", `eq.${query.type}`);
      if (query.q) {
        const term = query.q.replace(/[%*,]/g, " ");
        params.set("or", `(title.ilike.*${term}*,summary.ilike.*${term}*)`);
      }
      if (query.topic) {
        params.set("research_resource_topics.research_topics.slug", `eq.${query.topic}`);
      }
      const response = await rest(fetchImpl, base, env, null, `/rest/v1/research_works?${params}`, {
        headers: { Prefer: "count=exact" }
      });
      const rows = await publishedRows(response);
      return {
        results: rows.map(publicWork),
        total: readTotal(response, rows.length),
        page: query.page,
        pageSize: query.pageSize
      };
    },
    async facets() {
      const response = await rest(
        fetchImpl,
        base,
        env,
        null,
        "/rest/v1/research_works?select=status,resource_type,research_resource_topics(research_topics(name,slug))&status=eq.published&limit=200"
      );
      const rows = await publishedRows(response);
      const types = new Map();
      const topics = new Map();
      for (const row of rows) {
        types.set(row.resource_type, (types.get(row.resource_type) || 0) + 1);
        for (const link of row.research_resource_topics || []) {
          const topic = link.research_topics;
          if (!topic) continue;
          const current = topics.get(topic.slug) || { slug: topic.slug, name: topic.name, count: 0 };
          current.count += 1;
          topics.set(topic.slug, current);
        }
      }
      return {
        types: [...types.entries()].map(([value, count]) => ({ value, count })),
        topics: [...topics.values()]
      };
    },
    async getPublished(slug) {
      const response = await rest(
        fetchImpl,
        base,
        env,
        null,
        `/rest/v1/research_works?select=${encodeURIComponent(WORK_SELECT)}&slug=eq.${encodeURIComponent(slug)}&status=eq.published&limit=1`
      );
      const rows = await publishedRows(response);
      return rows[0] ? publicWork(rows[0]) : null;
    },
    async provider(key, jwt) {
      const response = await rest(
        fetchImpl,
        base,
        env,
        jwt,
        `/rest/v1/research_providers?select=id,key,domain,is_enabled,base_url&key=eq.${encodeURIComponent(key)}&limit=1`
      );
      const rows = await response.json();
      return rows[0] || null;
    },
    async findByDoi(doi, jwt) {
      const response = await rest(
        fetchImpl,
        base,
        env,
        jwt,
        `/rest/v1/research_work_identifiers?select=work_id,research_works(id,slug)&scheme=eq.doi&value=eq.${encodeURIComponent(doi)}&limit=1`
      );
      const rows = await response.json();
      const work = rows[0]?.research_works;
      return work ? { id: work.id, slug: work.slug } : null;
    },
    async findByClaim(providerId, externalId, jwt) {
      const response = await rest(
        fetchImpl,
        base,
        env,
        jwt,
        `/rest/v1/research_provider_claims?select=work_id,research_works(id,slug)&provider_id=eq.${providerId}&external_id=eq.${encodeURIComponent(externalId)}&limit=1`
      );
      const rows = await response.json();
      const work = rows[0]?.research_works;
      return work ? { id: work.id, slug: work.slug } : null;
    },
    async stage(provider, record, jwt) {
      const existingByDoi = record.doi ? await this.findByDoi(record.doi, jwt) : null;
      const existingByClaim = await this.findByClaim(provider.id, record.openAlexId, jwt);
      const target = resolveImportTarget(existingByDoi, existingByClaim);
      if (target.action === "attach" || target.action === "update") {
        await upsertClaim(fetchImpl, base, env, jwt, provider.id, target.workId, record, target.action === "update");
        await logIngest(fetchImpl, base, env, jwt, provider.id, "stage", "duplicate", target.slug);
        return { duplicate: true, slug: target.slug, status: "unchanged" };
      }
      const slug = await uniqueSlug(fetchImpl, base, env, jwt, slugify(record.title, record.openAlexId.toLowerCase()));
      const inserted = await rest(fetchImpl, base, env, jwt, "/rest/v1/research_works", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          title: record.title,
          resource_type: record.resourceType,
          publication_date: record.publicationDate,
          slug,
          status: "draft",
          provider_id: provider.id,
          source_url: record.sourceUrl,
          external_id: record.openAlexId,
          retrieved_at: new Date().toISOString(),
          rights_class: record.rightsClass,
          summary: record.summary,
          open_access: record.openAccess,
          doi: record.doi,
          venue: record.venue,
          methodology: record.methodology,
          limitations: record.limitations,
          limitations_unknown: record.limitationsUnknown
        })
      });
      const work = (await inserted.json())[0];
      await upsertClaim(fetchImpl, base, env, jwt, provider.id, work.id, record, true);
      await insertIdentifiers(fetchImpl, base, env, jwt, work.id, record);
      await insertContributors(fetchImpl, base, env, jwt, work.id, record.authors);
      await insertTopics(fetchImpl, base, env, jwt, work.id, record.topics);
      await rest(fetchImpl, base, env, jwt, "/rest/v1/research_licenses", {
        method: "POST",
        body: JSON.stringify({ work_id: work.id, ...record.license })
      });
      await logIngest(fetchImpl, base, env, jwt, provider.id, "stage", "draft", slug);
      return { duplicate: false, slug, status: "draft" };
    },
    async publish(slug, jwt) {
      const response = await rest(
        fetchImpl,
        base,
        env,
        jwt,
        `/rest/v1/research_works?slug=eq.${encodeURIComponent(slug)}&status=eq.draft`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ status: "published", updated_at: new Date().toISOString() })
        }
      );
      const rows = await response.json();
      return rows[0] ? { slug: rows[0].slug, status: rows[0].status } : null;
    }
  };
}

export function publicWork(row) {
  const contributors = (row.research_resource_contributors || [])
    .filter((link) => link.role === "author")
    .map((link) => plainText(link.research_contributors?.full_name, 160))
    .filter(Boolean);
  const topics = (row.research_resource_topics || [])
    .map((link) => link.research_topics)
    .filter(Boolean)
    .map((topic) => ({ name: plainText(topic.name, 80), slug: topic.slug }));
  return {
    title: plainText(row.title, 300),
    slug: row.slug,
    resourceType: row.resource_type,
    publicationDate: row.publication_date,
    venue: row.venue ? plainText(row.venue, 160) : null,
    doi: row.doi,
    summary: row.summary ? plainText(row.summary, 600) : null,
    sourceUrl: row.source_url,
    provider: row.research_providers?.key || null,
    attribution: plainText(row.research_providers?.attribution_text, 300),
    rightsClass: row.rights_class,
    openAccess: row.open_access,
    methodology: row.methodology ? plainText(row.methodology, 600) : null,
    limitations: row.limitations ? plainText(row.limitations, 600) : null,
    limitationsUnknown: row.limitations_unknown,
    retrievedAt: row.retrieved_at,
    updatedAt: row.updated_at,
    contributors,
    topics,
    license: row.research_licenses?.[0]
      ? {
          name: plainText(row.research_licenses[0].name, 80),
          url: row.research_licenses[0].url
        }
      : null
  };
}

async function publishedRows(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw catalogFailure("application");
  }
  if (!Array.isArray(body)) throw catalogFailure("application");
  return body.filter((row) => row && row.status === "published");
}

async function rest(fetchImpl, base, env, jwt, path, options = {}) {
  if (!base || !env.SUPABASE_ANON_KEY || /service_role/i.test(env.SUPABASE_ANON_KEY)) {
    throw catalogFailure("binding");
  }
  const headers = {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${jwt || env.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  let response;
  try {
    response = await fetchImpl(`${base}${path}`, { ...options, headers });
  } catch (error) {
    throw catalogFailure(isTransportFailure(error) ? "transport" : "application");
  }
  if (!response || response.ok !== true) {
    throw catalogFailure(isTransportStatus(response?.status) ? "transport" : "application");
  }
  return response;
}

function catalogFailure(failure) {
  const error = new Error("catalog_unavailable");
  error.code = "catalog_unavailable";
  error.failure = failure;
  return error;
}

function isTransportFailure(error) {
  return error?.name === "TypeError" || error?.name === "AbortError" || error?.name === "TimeoutError";
}

function isTransportStatus(status) {
  return status === 502 || status === 503 || status === 504;
}

async function uniqueSlug(fetchImpl, base, env, jwt, baseSlug) {
  let slug = baseSlug;
  for (let i = 2; i < 20; i += 1) {
    const response = await rest(
      fetchImpl,
      base,
      env,
      jwt,
      `/rest/v1/research_works?select=slug&slug=eq.${encodeURIComponent(slug)}&limit=1`
    );
    const rows = await response.json();
    if (!rows.length) return slug;
    slug = `${baseSlug}-${i}`;
  }
  return `${baseSlug}-${Date.now()}`;
}

async function upsertClaim(fetchImpl, base, env, jwt, providerId, workId, record, primary) {
  const existing = await rest(
    fetchImpl,
    base,
    env,
    jwt,
    `/rest/v1/research_provider_claims?select=id&provider_id=eq.${providerId}&external_id=eq.${encodeURIComponent(record.openAlexId)}&limit=1`
  );
  const rows = await existing.json();
  const body = {
    work_id: workId,
    provider_id: providerId,
    external_id: record.openAlexId,
    source_url: record.sourceUrl,
    retrieved_at: new Date().toISOString(),
    rights_class: record.rightsClass,
    is_primary: primary
  };
  if (rows[0]) {
    await rest(fetchImpl, base, env, jwt, `/rest/v1/research_provider_claims?id=eq.${rows[0].id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    return;
  }
  await rest(fetchImpl, base, env, jwt, "/rest/v1/research_provider_claims", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

async function insertIdentifiers(fetchImpl, base, env, jwt, workId, record) {
  const rows = [{ work_id: workId, scheme: "openalex", value: record.openAlexId }];
  if (record.doi) rows.push({ work_id: workId, scheme: "doi", value: record.doi });
  await rest(fetchImpl, base, env, jwt, "/rest/v1/research_work_identifiers", {
    method: "POST",
    body: JSON.stringify(rows)
  });
}

async function insertContributors(fetchImpl, base, env, jwt, workId, authors) {
  for (const name of authors) {
    const found = await rest(
      fetchImpl,
      base,
      env,
      jwt,
      `/rest/v1/research_contributors?select=id&full_name=eq.${encodeURIComponent(name)}&limit=1`
    );
    let contributor = (await found.json())[0];
    if (!contributor) {
      const created = await rest(fetchImpl, base, env, jwt, "/rest/v1/research_contributors", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ full_name: name })
      });
      contributor = (await created.json())[0];
    }
    await rest(fetchImpl, base, env, jwt, "/rest/v1/research_resource_contributors", {
      method: "POST",
      body: JSON.stringify({ work_id: workId, contributor_id: contributor.id, role: "author" })
    });
  }
}

async function insertTopics(fetchImpl, base, env, jwt, workId, topics) {
  for (const name of topics) {
    const slug = slugify(name, "topic");
    const found = await rest(
      fetchImpl,
      base,
      env,
      jwt,
      `/rest/v1/research_topics?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`
    );
    let topic = (await found.json())[0];
    if (!topic) {
      const created = await rest(fetchImpl, base, env, jwt, "/rest/v1/research_topics", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ slug, name })
      });
      topic = (await created.json())[0];
    }
    await rest(fetchImpl, base, env, jwt, "/rest/v1/research_resource_topics", {
      method: "POST",
      body: JSON.stringify({ work_id: workId, topic_id: topic.id })
    });
  }
}

async function logIngest(fetchImpl, base, env, jwt, providerId, action, status, message) {
  await rest(fetchImpl, base, env, jwt, "/rest/v1/research_ingest_runs", {
    method: "POST",
    body: JSON.stringify({ provider_id: providerId, action, status, message })
  });
}

function readTotal(response, fallback) {
  const range = response.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : fallback;
}
