import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../router.js";
import { handleResearchRequest } from "../research/api.js";
import { handleMarketIntelligenceRequest, resetMarketIntelligenceCache } from "./api.js";
import { METRICS, MESSAGES, payrollDollars } from "./metrics.js";
import { datasetNaicsVersion, preferredNaicsVintage } from "./naics.js";
import { calculationValue, parseBusinessMeasure, payrollFromMeasure } from "./suppression.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SECRET = "census-test-key-9f3a";
const env = { CENSUS_API_KEY: SECRET };

beforeEach(() => resetMarketIntelligenceCache());

test("United States loads", async () => {
  const { response, calls } = await request("/api/market-intelligence/geographies?level=us", (url) => {
    assert.equal(url.includes("for=us:*"), true);
    assert.equal(url.includes(SECRET), true);
    return table(["NAME", "us"], [["United States", "1"]]);
  });
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.deepEqual(body.geographies, [{
    name: "United States",
    geography_type: "us",
    geography_code: "1"
  }]);
  assert.equal(calls.length, 1);
});

test("states load", async () => {
  const { response } = await request("/api/market-intelligence/geographies?level=states", (url) => {
    assert.equal(url.includes("for=state:*"), true);
    assert.equal(url.includes("county"), false);
    return table(["NAME", "state"], [["Pennsylvania", "42"], ["Ohio", "39"]]);
  });
  const body = await json(response);
  assert.deepEqual(body.geographies.map((item) => item.name), ["Ohio", "Pennsylvania"]);
  assert.equal(body.geographies[1].geography_code, "42");
  assert.equal(body.geographies[1].geography_type, "state");
});

test("counties load after a state is selected", async () => {
  const { response, calls } = await request("/api/market-intelligence/geographies?level=counties&state=42", (url) => {
    assert.equal(url.includes("for=county:*"), true);
    assert.equal(url.includes("in=state:42"), true);
    return table(["NAME", "state", "county"], [["Erie County, Pennsylvania", "42", "049"]]);
  });
  const body = await json(response);
  assert.equal(body.geographies[0].name, "Erie County, Pennsylvania");
  assert.equal(body.geographies[0].geography_code, "049");
  assert.equal(body.geographies[0].state_code, "42");
  assert.equal(calls[0].includes("in=county:"), false);
});

test("places load after a state is selected", async () => {
  const { response, calls } = await request("/api/market-intelligence/geographies?level=places&state=42", (url) => {
    assert.equal(url.includes("for=place:*"), true);
    assert.equal(url.includes("in=state:42"), true);
    return table(["NAME", "state", "place"], [["Union City borough, Pennsylvania", "42", "78512"]]);
  });
  const body = await json(response);
  assert.equal(body.geographies[0].name, "Union City borough, Pennsylvania");
  assert.equal(body.geographies[0].geography_type, "place");
  assert.equal(body.geographies[0].geography_code, "78512");
  assert.equal(calls[0].includes("in=county:"), false);
});

test("county subdivisions load after a state and county are selected", async () => {
  const { response, calls } = await request(
    "/api/market-intelligence/geographies?level=county-subdivisions&state=42&county=049",
    (url) => {
      assert.equal(url.includes("for=county%20subdivision:*"), true);
      assert.equal(url.includes("in=state:42"), true);
      assert.equal(url.includes("in=county:049"), true);
      return table(
        ["NAME", "state", "county", "county subdivision"],
        [["Union township, Erie County, Pennsylvania", "42", "049", "78520"]]
      );
    }
  );
  const body = await json(response);
  assert.equal(body.geographies[0].name, "Union township, Erie County, Pennsylvania");
  assert.equal(body.geographies[0].geography_type, "county-subdivision");
  assert.equal(body.geographies[0].county_code, "049");
  assert.equal(calls.length, 1);
});

test("a state can be used without selecting a county", async () => {
  const { response, calls } = await request(dataPath({
    geography_type: "state",
    geography_code: "39",
    metric: "population"
  }), (url) => {
    assert.equal(url.includes("for=state:39"), true);
    assert.equal(url.includes("in=county:"), false);
    assert.equal(url.includes("DP05_0001E"), true);
    return acs("DP05_0001E", "Ohio", "11000000", { state: "39" });
  });
  const body = await json(response);
  assert.equal(body.geography.name, "Ohio");
  assert.equal(body.geography.type, "state");
  assert.equal(body.formatted_value, "11,000,000");
  assert.equal(calls.length, 1);
});

test("a county can be used without selecting a city or subdivision", async () => {
  const { response, calls } = await request(dataPath({
    geography_type: "county",
    geography_code: "049",
    state: "42",
    metric: "population"
  }), () => acs("DP05_0001E", "Erie County, Pennsylvania", "270000", { state: "42", county: "049" }));
  const body = await json(response);
  assert.equal(body.geography.type, "county");
  assert.equal(body.geography.county_code, "049");
  assert.equal(body.geography.state_code, "42");
  assert.equal(calls[0].includes("place"), false);
});

test("city and place selection works", async () => {
  const { response, calls } = await request(dataPath({
    geography_type: "place",
    geography_code: "78512",
    state: "42",
    metric: "population"
  }), (url) => {
    assert.equal(url.includes("for=place:78512"), true);
    assert.equal(url.includes("in=state:42"), true);
    assert.equal(url.includes("county"), false);
    return acs("DP05_0001E", "Union City borough, Pennsylvania", "3000", { state: "42", place: "78512" });
  });
  const body = await json(response);
  assert.equal(body.geography.name, "Union City borough, Pennsylvania");
  assert.equal(body.geography.place_code, "78512");
  assert.equal(calls.length, 1);
});

test("county-subdivision selection works", async () => {
  const { response, calls } = await request(dataPath({
    geography_type: "county-subdivision",
    geography_code: "78520",
    state: "42",
    county: "049",
    metric: "households"
  }), (url) => {
    assert.equal(url.includes("for=county%20subdivision:78520"), true);
    assert.equal(url.includes("in=county:049"), true);
    return acs("DP02_0001E", "Union township, Erie County, Pennsylvania", "800", {
      state: "42",
      county: "049",
      "county subdivision": "78520"
    });
  });
  const body = await json(response);
  assert.equal(body.metric, "households");
  assert.equal(body.variable, "DP02_0001E");
  assert.equal(body.geography.subdivision_code, "78520");
  assert.equal(calls.length, 1);
});

test("population uses DP05_0001E", async () => {
  await assertAcs("population", "DP05_0001E", "331000000", "331,000,000", "count");
});

test("households uses DP02_0001E", async () => {
  await assertAcs("households", "DP02_0001E", "129000000", "129,000,000", "count");
});

test("median household income uses DP03_0062E", async () => {
  await assertAcs("median-household-income", "DP03_0062E", "65000", "$65,000", "USD");
});

test("employment uses DP03_0004E", async () => {
  const body = await assertAcs("employment", "DP03_0004E", "158000000", "158,000,000", "count");
  assert.equal(JSON.stringify(body).toLowerCase().includes("jobs"), false);
  assert.equal(body.definition, METRICS.employment.definition);
});

test("poverty uses DP03_0128PE", async () => {
  await assertAcs("poverty", "DP03_0128PE", "12.4", "12.4%", "percent");
});

test("education uses DP02_0068PE", async () => {
  await assertAcs("education", "DP02_0068PE", "34.3", "34.3%", "percent");
});

test("businesses uses ESTAB", async () => {
  const { response, calls } = await request(dataPath({
    geography_type: "county",
    geography_code: "049",
    state: "42",
    metric: "businesses"
  }), (url) => {
    assert.equal(url.includes("ESTAB"), true);
    assert.equal(url.includes("NAICS2017=00"), true);
    assert.equal(url.includes("LFO=001"), true);
    assert.equal(url.includes("EMPSZES=001"), true);
    return cbp("Erie County, Pennsylvania", "00", "Total for all sectors", "12345", "10", "1", "5000", {
      state: "42",
      county: "049"
    });
  });
  const body = await json(response);
  assert.equal(body.label, "Business Establishments");
  assert.equal(body.variable, "ESTAB");
  assert.equal(body.value, 12345);
  assert.equal(body.formatted_value, "12,345");
  assert.equal(body.dataset, "2023 County Business Patterns");
  assert.equal(body.year, 2023);
  assert.equal(calls[0].includes("/data/2023/cbp?"), true);
});

test("industry validates NAICS selections", async () => {
  const rejected = await request("/api/market-intelligence/data?geography_type=us&geography_code=1&metric=industry&naics=NOT-A-CODE", () => {
    throw new Error("should not fetch");
  });
  assert.equal(rejected.response.status, 400);
  assert.equal((await json(rejected.response)).error.code, "INVALID_NAICS_CODE");
  assert.equal(rejected.calls.length, 0);

  const unknown = await request(
    "/api/market-intelligence/data?geography_type=us&geography_code=1&metric=industry&naics=999999",
    (url) => {
      assert.equal(url.includes("NAICS2017=999999"), false);
      return naicsPayload();
    }
  );
  assert.equal(unknown.response.status, 400);
  assert.equal((await json(unknown.response)).error.code, "INVALID_NAICS_CODE");
  assert.equal(unknown.calls.some((url) => url.includes("NAICS2017=999999")), false);
});

test("industry returns the requested NAICS data", async () => {
  const { response, calls } = await request(dataPath({
    geography_type: "county",
    geography_code: "049",
    state: "42",
    metric: "industry",
    naics: "311"
  }), (url) => {
    if (url.includes("NAICS2017.json")) return naicsPayload();
    assert.equal(url.includes("NAICS2017=311"), true);
    assert.equal(url.includes("NAICS2017=00"), false);
    return cbp("Erie County, Pennsylvania", "311", "Food Manufacturing", "40", "123", "10", "200", {
      state: "42",
      county: "049"
    });
  });
  const body = await json(response);
  assert.equal(body.industry.name, "Food Manufacturing");
  assert.equal(body.industry.naics, "311");
  assert.equal(body.industry.establishments, 40);
  assert.equal(body.industry.employees, 200);
  assert.equal(body.industry.annual_payroll, 123000);
  assert.equal(body.industry.formatted_annual_payroll, "$123,000");
  assert.equal(calls.some((url) => url.includes("NAICS2017=311")), true);
});

test("payroll uses PAYANN", async () => {
  const body = await payrollFor("county", { geography_code: "049", state: "42" });
  assert.equal(body.variable, "PAYANN");
  assert.equal(body.label, "Annual Payroll");
  assert.equal(body.statement, "Annual payroll");
  assert.equal(body.display_dataset, "2023 County Business Patterns");
});

test("PAYANN conversion from thousands of dollars is correct", async () => {
  assert.equal(payrollDollars(123456), 123456000);
  const body = await payrollFor("us", { geography_code: "1" }, "123456");
  assert.equal(body.source_value, 123456);
  assert.equal(body.source_unit, "thousands of dollars");
  assert.equal(body.value, 123456000);
  assert.equal(body.formatted_value, "$123,456,000");
  assert.match(body.unit_note, /thousands of dollars/);
  assert.match(body.unit_note, /shown here in dollars/);
});

test("CBP county data works", async () => {
  const body = await payrollFor("county", { geography_code: "049", state: "42" });
  assert.equal(body.geography.type, "county");
  assert.equal(body.geography.county_code, "049");
});

test("CBP state data works", async () => {
  const body = await payrollFor("state", { geography_code: "42" });
  assert.equal(body.geography.type, "state");
  assert.equal(body.geography.state_code, "42");
});

test("CBP U.S. data works", async () => {
  const body = await payrollFor("us", { geography_code: "1" });
  assert.equal(body.geography.type, "us");
  assert.equal(body.geography.name, "United States");
});

test("CBP place requests return the proper unavailable response", async () => {
  const { response, calls } = await request(dataPath({
    geography_type: "place",
    geography_code: "78512",
    state: "42",
    metric: "businesses"
  }), () => {
    throw new Error("county fallback");
  });
  const body = await json(response);
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "UNSUPPORTED_GEOGRAPHY");
  assert.equal(body.error.message, MESSAGES.businessUnavailable);
  assert.equal(calls.length, 0);
});

test("CBP county-subdivision requests return the proper unavailable response", async () => {
  const { response, calls } = await request(dataPath({
    geography_type: "county-subdivision",
    geography_code: "78520",
    state: "42",
    county: "049",
    metric: "payroll"
  }), () => {
    throw new Error("county fallback");
  });
  const body = await json(response);
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "UNSUPPORTED_GEOGRAPHY");
  assert.equal(body.error.message, MESSAGES.businessUnavailable);
  assert.equal(calls.length, 0);
});

test("CBP never substitutes county values for a place or subdivision", async () => {
  const { response, calls } = await request(
    "/api/market-intelligence/data?geography_type=place&geography_code=78512&state=42&county=049&metric=businesses",
    () => cbp("Erie County, Pennsylvania", "00", "Total for all sectors", "99999", "1", "1", "1", {
      state: "42",
      county: "049"
    })
  );
  const body = await json(response);
  const text = JSON.stringify(body);
  assert.equal(text.includes("99999"), false);
  assert.equal(text.includes("Erie County"), false);
  assert.equal(calls.length, 0);
});

test("Census API key is never returned", async () => {
  const { response, calls } = await request("/api/market-intelligence/data?geography_type=us&geography_code=1&metric=population", () => {
    return acs("DP05_0001E", "United States", "100", { us: "1" });
  });
  const text = JSON.stringify({
    body: await response.json(),
    headers: [...response.headers.entries()]
  });
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes("key="), false);
  assert.equal(calls[0].includes(`key=${SECRET}`), true);
  assert.equal(calls[0].startsWith("https://api.census.gov/data/2024/acs/acs5/profile?"), true);
});

test("browser cannot specify an arbitrary Census URL", async () => {
  const { response, calls } = await request(
    "/api/market-intelligence/geographies?level=states&url=https://api.census.gov/data/2019/pep/population",
    () => {
      throw new Error("proxy");
    }
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("browser cannot specify arbitrary Census variables", async () => {
  const { response, calls } = await request(
    "/api/market-intelligence/data?geography_type=us&geography_code=1&metric=population&get=DP99_0001E",
    () => {
      throw new Error("proxy");
    }
  );
  assert.equal(response.status, 400);
  assert.equal((await json(response)).error.code, "INVALID_METRIC");
  assert.equal(calls.length, 0);
});

test("browser cannot specify arbitrary NAICS codes", async () => {
  const { response, calls } = await request(
    "/api/market-intelligence/data?geography_type=state&geography_code=42&metric=industry&naics=https://evil.test",
    () => {
      throw new Error("proxy");
    }
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("invalid geography is rejected", async () => {
  const tract = await request("/api/market-intelligence/data?geography_type=tract&geography_code=000100&metric=population");
  assert.equal(tract.response.status, 400);
  assert.equal((await json(tract.response)).error.code, "INVALID_GEOGRAPHY");
  const fips = await request("/api/market-intelligence/geographies?level=counties&state=4");
  assert.equal(fips.response.status, 400);
  const missing = await request("/api/market-intelligence/data?geography_type=county&geography_code=049&metric=population");
  assert.equal(missing.response.status, 400);
  assert.equal(tract.calls.length + fips.calls.length + missing.calls.length, 0);
});

test("invalid metric is rejected", async () => {
  const { response, calls } = await request("/api/market-intelligence/data?geography_type=us&geography_code=1&metric=jobs");
  assert.equal(response.status, 400);
  assert.equal((await json(response)).error.code, "INVALID_METRIC");
  assert.equal(calls.length, 0);
});

test("Census API failure returns a controlled error", async () => {
  const { response } = await request("/api/market-intelligence/data?geography_type=us&geography_code=1&metric=population", () => {
    return new Response(JSON.stringify({ error: `boom ${SECRET}` }), { status: 500 });
  });
  const body = await json(response);
  const text = JSON.stringify(body);
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "CENSUS_UPSTREAM_UNAVAILABLE");
  assert.equal(body.error.message, MESSAGES.unavailable);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes("boom"), false);
  assert.equal(text.includes("stack"), false);
});

test("empty result returns the correct empty state", async () => {
  const { response } = await request("/api/market-intelligence/data?geography_type=us&geography_code=1&metric=population", () => {
    return table(["NAME", "DP05_0001E", "us"]);
  });
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.equal(body.error.code, "NO_DATA");
  assert.equal(body.error.message, MESSAGES.emptyData);
  assert.equal(body.formatted_value, undefined);
});

test("a Census zero is displayed as zero", async () => {
  const { response } = await request("/api/market-intelligence/data?geography_type=us&geography_code=1&metric=households", () => {
    return acs("DP02_0001E", "United States", "0", { us: "1" });
  });
  const body = await json(response);
  assert.equal(body.value, 0);
  assert.equal(body.formatted_value, "0");
});

test("a suppressed Census value is not displayed as a number", async () => {
  const { response } = await request("/api/market-intelligence/data?geography_type=us&geography_code=1&metric=median-household-income", () => {
    return acs("DP03_0062E", "United States", "-666666666", { us: "1" });
  });
  const body = await json(response);
  assert.equal(body.error.code, "NO_DATA");
  assert.equal(body.error.message, MESSAGES.metricUnavailable);
  assert.equal(JSON.stringify(body).includes("-666666666"), false);
});

test("a mismatched parent geography is not returned", async () => {
  const { response } = await request(dataPath({
    geography_type: "county",
    geography_code: "049",
    state: "42",
    metric: "population"
  }), () => acs("DP05_0001E", "Other County, Ohio", "999", { state: "39", county: "049" }));
  const body = await json(response);
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_GEOGRAPHY_RELATIONSHIP");
  assert.equal(JSON.stringify(body).includes("Other County"), false);
});

test("repeated requests do not create duplicate overlapping calls", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fetchImpl = async (url) => {
    calls += 1;
    await gate;
    assert.equal(String(url).includes(SECRET), true);
    return acs("DP05_0001E", "United States", "10", { us: "1" });
  };
  const path = "/api/market-intelligence/data?geography_type=us&geography_code=1&metric=population";
  const first = handleMarketIntelligenceRequest(new Request(`https://pulse.test${path}`), env, fetchImpl);
  const second = handleMarketIntelligenceRequest(new Request(`https://pulse.test${path}`), env, fetchImpl);
  release();
  const responses = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal((await responses[0].json()).formatted_value, "10");
  assert.equal((await responses[1].json()).formatted_value, "10");
});

test("industries come from the Census NAICS list and keep All Industries", async () => {
  const { response } = await request("/api/market-intelligence/industries", () => naicsPayload());
  const body = await json(response);
  assert.equal(body.industries.some((item) => item.naics === "1111100"), false);
  assert.equal(body.industries.find((item) => item.naics === "00").selector_label, "All Industries");
  assert.equal(body.industries.find((item) => item.naics === "311").parent, "31-33");
  assert.equal(body.dataset, "2023 County Business Patterns");
});

test("market intelligence does not call Census without the server key", async () => {
  let called = false;
  const response = await handleMarketIntelligenceRequest(
    new Request("https://pulse.test/api/market-intelligence/geographies?level=us"),
    {},
    async () => {
      called = true;
      return table(["NAME", "us"], [["United States", "1"]]);
    }
  );
  assert.equal(called, false);
  const missingKey = await response.json();
  assert.equal(missingKey.error.code, "MARKET_DATA_UNAVAILABLE");
  assert.equal(missingKey.error.message, MESSAGES.unavailable);
});

test("the router serves market intelligence and still serves research", async () => {
  let assets = 0;
  const response = await worker.fetch(
    new Request("https://pulse.test/api/market-intelligence/geographies?level=us"),
    { ASSETS: { async fetch() { assets += 1; return new Response("asset"); } } }
  );
  assert.equal(assets, 0);
  assert.equal(response.headers.get("content-type").includes("application/json"), true);
  assert.equal((await response.json()).error.code, "MARKET_DATA_UNAVAILABLE");
  const source = readFileSync(join(root, "workers", "router.js"), "utf8");
  assert.equal(source.includes('"/api/research/"'), true);
  assert.equal(source.includes("handleResearchRequest"), true);
});

test("existing research library search and BERT behavior still work", async () => {
  const calls = [];
  const search = await handleResearchRequest(
    new Request("https://pulse.test/api/research/search?q=SEO"),
    { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-test-key", OPENALEX_API_KEY: "server-side-test-key" },
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      if (url.includes("api.openalex.org")) {
        return jsonResponse({
          results: [{
            id: "https://openalex.org/W100",
            display_name: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
            publication_year: 2019,
            authorships: [],
            primary_location: { source: { display_name: "NAACL" }, landing_page_url: "https://doi.org/10.18653/v1/n19-1423" },
            type: "article",
            doi: "https://doi.org/10.18653/v1/n19-1423",
            open_access: { is_oa: true },
            cited_by_count: 1
          }]
        });
      }
      return jsonResponse([]);
    }
  );
  const searchBody = await search.json();
  assert.equal(search.status, 200);
  assert.equal(searchBody.results[0].title.includes("BERT"), true);
  assert.equal(calls.some((url) => url.includes("api.openalex.org")), true);

  const detail = await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources/bert-pre-training"),
    { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-test-key" },
    async (input) => {
      const url = String(input.url || input);
      if (url.includes("deep-learning")) return jsonResponse([]);
      return jsonResponse([bertRow(), draftRow()].filter((row) => url.includes(row.slug) || !url.includes("slug=eq.")));
    }
  );
  const detailBody = await detail.json();
  assert.equal(detail.status, 200);
  assert.equal(detailBody.result.slug, "bert-pre-training");
  assert.equal(JSON.stringify(detailBody).includes("deep-learning"), false);
});

test("existing category topic and resource type filters remain", async () => {
  const html = readFileSync(join(root, "resources", "research-library.html"), "utf8");
  assert.match(html, /id="research-category"/);
  assert.match(html, /id="research-topic"/);
  assert.match(html, /id="research-type"/);
  const library = readFileSync(join(root, "js", "research-library.js"), "utf8");
  assert.match(library, /\/api\/research\/resources/);
  assert.match(library, /\/api\/research\/search/);
  const calls = [];
  await handleResearchRequest(
    new Request("https://pulse.test/api/research/resources?page=1&pageSize=12&category=search-seo&topic=seo&type=official-guide"),
    { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-test-key" },
    async (input) => {
      calls.push(String(input.url || input));
      return jsonResponse([]);
    }
  );
  assert.equal(calls.some((url) => url.includes("search-seo") && url.includes("official-guide") && url.includes("seo")), true);
});

test("the published research catalog in migrations is unchanged", () => {
  const text = [
    "supabase/migrations/20260925063000_search_seo_collection.sql",
    "supabase/migrations/20260925071000_analytics_ai_ux_resources.sql"
  ].map((file) => readFileSync(join(root, file), "utf8")).join("\n");
  const slugs = [
    "seo-starter-guide",
    "google-search-essentials",
    "how-google-search-works",
    "search-console-performance-report",
    "search-console-performance-tasks",
    "url-inspection-tool",
    "page-indexing-report",
    "sitemaps-report",
    "deciphering-higher-education-search-visibility",
    "query-sampler",
    "analytics-for-beginners",
    "overview-of-google-analytics-reports",
    "about-key-events",
    "conversions-vs-key-events",
    "get-started-with-attribution",
    "introduction-to-audiences",
    "identifying-and-scaling-ai-use-cases",
    "guide-to-ai-in-marketing",
    "utilizing-ai-in-marketing-automation",
    "what-is-ai-marketing",
    "marketing-automation-guide",
    "ten-usability-heuristics",
    "usability-testing-101",
    "learn-responsive-design",
    "learn-accessibility",
    "accessibility-fundamentals-overview",
    "wcag-2-overview",
    "learn-performance",
    "understanding-page-experience",
    "how-to-conduct-a-heuristic-evaluation"
  ];
  assert.equal(slugs.length, 30);
  for (const slug of slugs) assert.equal(text.includes(`'${slug}'`), true);
  assert.equal(text.includes("'deep-learning'"), false);
  assert.equal(text.includes("api.census.gov"), false);
});

test("market intelligence page does not call Census from the browser", () => {
  const page = readFileSync(join(root, "js", "market-intelligence.js"), "utf8");
  const html = readFileSync(join(root, "resources", "market-intelligence.html"), "utf8");
  const workerSource = readFileSync(join(root, "workers", "market-intelligence", "api.js"), "utf8");
  assert.equal(page.includes("api.census.gov"), false);
  assert.equal(html.includes("api.census.gov"), false);
  assert.equal(page.includes("CENSUS_API_KEY"), false);
  assert.equal(html.includes(SECRET), false);
  assert.match(workerSource, /CENSUS_API_KEY/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1.0"/);
  const css = readFileSync(join(root, "css", "market-intelligence.css"), "utf8");
  assert.match(css, /max-width:\s*390px/);
  assert.match(css, /minmax\(0,\s*1fr\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  const sitemap = readFileSync(join(root, "sitemap.xml"), "utf8");
  assert.match(sitemap, /resources\/market-intelligence\.html<\/loc>/);
  assert.equal(sitemap.includes("market-intelligence.html?"), false);
});

test("root NAICS hierarchy loads for 2023 CBP as 2017 sectors", async () => {
  const { response, calls } = await request("/api/market-intelligence/naics?dataset=cbp", () => hierarchyPayload());
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.equal(body.dataset, "2023-cbp");
  assert.equal(body.data_year, 2023);
  assert.equal(body.naics_version, "2017");
  assert.equal(body.level, "sector");
  assert.equal(body.items.some((item) => item.code === "54" && item.level === "sector" && item.has_children), true);
  assert.equal(body.items.some((item) => item.code === "00"), false);
  assert.equal(body.items.some((item) => item.code === "000000" || item.code === "949999"), false);
  assert.equal(calls.some((url) => url.includes("NAICS2017.json")), true);
  assert.equal(calls.some((url) => url.includes("for=")), false);
});

test("child NAICS hierarchy loads beneath a sector", async () => {
  const { response } = await request("/api/market-intelligence/naics?dataset=cbp&parent=54", () => hierarchyPayload());
  const body = await json(response);
  assert.deepEqual(body.items.map((item) => item.code), ["541"]);
  assert.equal(body.items[0].title, "Professional, Scientific, and Technical Services");
  assert.equal(body.items[0].level, "subsector");
  assert.equal(body.items[0].has_children, true);
});

test("multiple NAICS hierarchy levels work", async () => {
  const group = await json((await request("/api/market-intelligence/naics?dataset=cbp&parent=541", () => hierarchyPayload())).response);
  const industry = await json((await request("/api/market-intelligence/naics?dataset=cbp&parent=5415", () => hierarchyPayload())).response);
  const national = await json((await request("/api/market-intelligence/naics?dataset=cbp&parent=54151", () => hierarchyPayload())).response);
  assert.equal(group.items[0].code, "5415");
  assert.equal(group.items[0].level, "industry-group");
  assert.equal(industry.items[0].level, "naics-industry");
  assert.equal(national.items[0].code, "541511");
  assert.equal(national.items[0].level, "national-industry");
  assert.equal(national.items[0].has_children, false);
});

test("selected NAICS code returns a breadcrumb from Census labels", async () => {
  const { response } = await request("/api/market-intelligence/naics?dataset=cbp&code=541511", () => hierarchyPayload());
  const body = await json(response);
  assert.equal(body.code, "541511");
  assert.equal(body.title, "Custom Computer Programming Services");
  assert.equal(body.level, "national-industry");
  assert.equal(body.naics_version, "2017");
  assert.deepEqual(body.breadcrumb.map((item) => item.code), ["54", "541", "5415", "54151", "541511"]);
});

test("2023 CBP reports 2017 NAICS and a newer supported vintage would be preferred", () => {
  assert.equal(datasetNaicsVersion(), "2017");
  assert.equal(preferredNaicsVintage(["2017", "2022"]), "2022");
  assert.equal(preferredNaicsVintage(["2012", "2017"]), "2017");
});

test("an exact 2022 to 2017 crosswalk is used and the 2022 code is not sent to Census", async () => {
  const { response, calls } = await request(dataPath({
    geography_type: "county",
    geography_code: "049",
    state: "42",
    metric: "businesses",
    naics_code: "513210",
    naics_version: "2022"
  }), (url) => {
    if (url.includes("NAICS2017.json")) return hierarchyPayload();
    assert.equal(url.includes("NAICS2017=511210"), true);
    assert.equal(url.includes("513210"), false);
    return cbp("Erie County, Pennsylvania", "511210", "Software Publishers", "15", "20", "5", "40", {
      state: "42",
      county: "049"
    });
  });
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.equal(body.naics_code, "511210");
  assert.equal(body.naics_title, "Software Publishers");
  assert.equal(body.naics_version, "2017");
  assert.equal(body.requested_naics_code, "513210");
  assert.equal(body.dataset_id, "2023-cbp");
  assert.equal(calls.some((url) => url.includes("NAICS2017=513210")), false);
});

test("an ambiguous NAICS crosswalk is rejected", async () => {
  const { response, calls } = await request(dataPath({
    geography_type: "us",
    geography_code: "1",
    metric: "businesses",
    naics_code: "212114",
    naics_version: "2022"
  }), (url) => {
    assert.equal(url.includes("NAICS2017=212114"), false);
    return hierarchyPayload();
  });
  const body = await json(response);
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "AMBIGUOUS_NAICS_CROSSWALK");
  assert.equal(body.error.message, "A comparable business value could not be determined for this industry.");
  assert.equal(body.source_vintage, "2022");
  assert.equal(body.dataset_vintage, "2017");
  assert.equal(calls.some((url) => url.includes("/data/2023/cbp?")), false);
});

test("a missing industry code is rejected and a code outside the dataset is not queried", async () => {
  const missing = await request("/api/market-intelligence/data?geography_type=us&geography_code=1&metric=industry", () => {
    throw new Error("should not fetch");
  });
  assert.equal(missing.response.status, 400);
  assert.equal((await json(missing.response)).error.code, "NAICS_CODE_REQUIRED");
  assert.equal(missing.calls.length, 0);

  const unavailable = await request(dataPath({
    geography_type: "us",
    geography_code: "1",
    metric: "businesses",
    naics_code: "921110"
  }), (url) => {
    assert.equal(url.includes("NAICS2017=921110"), false);
    return hierarchyPayload();
  });
  const body = await json(unavailable.response);
  assert.equal(unavailable.response.status, 409);
  assert.equal(body.error.code, "NAICS_NOT_AVAILABLE_FOR_DATASET");
});

test("NAICS titles come from Census labels", () => {
  const source = readFileSync(join(root, "workers", "market-intelligence", "naics.js"), "utf8");
  assert.equal(source.includes("Custom Computer Programming Services"), false);
  assert.equal(source.includes("Software Publishers"), false);
});

test("an unavailable dataset vintage returns a typed error", async () => {
  const { response, calls } = await request("/api/market-intelligence/naics?dataset=2022-cbp", () => {
    throw new Error("should not fetch");
  });
  const body = await json(response);
  assert.equal(response.status, 404);
  assert.equal(body.error.code, "DATASET_VINTAGE_UNAVAILABLE");
  assert.equal(body.error.message, "This data year is not currently available.");
  assert.equal(calls.length, 0);
});

test("market intelligence errors use a code and message and hide upstream failures", async () => {
  const invalid = await json((await request("/api/market-intelligence/data?geography_type=us&geography_code=1&metric=jobs")).response);
  assert.equal(typeof invalid.error.code, "string");
  assert.equal(typeof invalid.error.message, "string");
  assert.equal(JSON.stringify(invalid).includes(SECRET), false);

  const outage = await request("/api/market-intelligence/data?geography_type=us&geography_code=1&metric=population", () => {
    throw new Error(`stack ${SECRET} census exploded`);
  });
  const body = await json(outage.response);
  assert.equal(outage.response.status, 503);
  assert.equal(body.error.code, "CENSUS_UPSTREAM_UNAVAILABLE");
  assert.equal(body.error.message, MESSAGES.unavailable);
  assert.equal(JSON.stringify(body).includes(SECRET), false);
  assert.equal(JSON.stringify(body).includes("exploded"), false);

  const limited = await request("/api/market-intelligence/data?geography_type=us&geography_code=1&metric=households", () => {
    return new Response("slow down", { status: 429 });
  });
  const limitBody = await json(limited.response);
  assert.equal(limited.response.status, 503);
  assert.equal(limitBody.error.code, "CENSUS_RATE_LIMITED");
  assert.equal(JSON.stringify(limitBody).includes("slow down"), false);
});

test("Census suppression codes stay distinct from zero and payroll conversion", () => {
  assert.equal(parseBusinessMeasure("0").value, 0);
  assert.deepEqual(parseBusinessMeasure("D"), { available: false, suppression_code: "D", display_value: "Not disclosed" });
  assert.deepEqual(parseBusinessMeasure("0", "S"), { available: false, suppression_code: "S", display_value: "Not disclosed" });
  assert.equal(parseBusinessMeasure("N").display_value, "Not available");
  assert.equal(parseBusinessMeasure("X").display_value, "Not applicable");
  assert.deepEqual(parseBusinessMeasure("12345", "", "G"), { available: true, value: 12345, noise_code: "G" });
  assert.equal(parseBusinessMeasure("80", "", "H").value, 80);
  assert.equal(parseBusinessMeasure("80", "", "J").noise_code, "J");
  assert.equal(calculationValue(parseBusinessMeasure("D")), null);
  assert.equal(calculationValue(parseBusinessMeasure("0")), 0);
  assert.equal(payrollFromMeasure(parseBusinessMeasure("D")), null);
  assert.equal(payrollDollars("D"), null);
  assert.equal(payrollFromMeasure(parseBusinessMeasure("123456")), 123456000);
  const values = [parseBusinessMeasure("D"), parseBusinessMeasure("12")].map(calculationValue);
  assert.equal(values.some((value) => value == null), true);
});

test("partial Census suppression returns the available business fields", async () => {
  const { response } = await request(dataPath({
    geography_type: "county",
    geography_code: "049",
    state: "42",
    metric: "industry",
    naics: "541"
  }), (url) => {
    if (url.includes("NAICS2017.json")) return hierarchyPayload();
    return table(
      ["NAME", "NAICS2017", "NAICS2017_LABEL", "ESTAB", "ESTAB_F", "EMP", "EMP_F", "EMP_N_F", "PAYANN", "PAYANN_F", "state", "county"],
      [["Erie County, Pennsylvania", "541", "Professional, Scientific, and Technical Services", "12", "", "85", "", "G", "0", "D", "42", "049"]]
    );
  });
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.equal(body.industry.establishments, 12);
  assert.equal(body.industry.employees, 85);
  assert.equal(body.industry.employees_noise_code, "G");
  assert.equal(body.industry.annual_payroll.display_value, "Not disclosed");
  assert.equal(body.industry.annual_payroll.suppression_code, "D");
  assert.equal(JSON.stringify(body.industry.annual_payroll).includes("0"), false);
  assert.equal(body.naics_version, "2017");
  assert.equal(body.data_year, 2023);
});

test("a suppressed payroll value is not converted from thousands", async () => {
  const { response } = await request(dataPath({
    geography_type: "us",
    geography_code: "1",
    metric: "payroll"
  }), () => table(
    ["NAME", "NAICS2017", "NAICS2017_LABEL", "ESTAB", "PAYANN", "PAYANN_F", "PAYQTR1", "EMP", "us"],
    [["United States", "00", "Total for all sectors", "10", "0", "D", "1", "10", "1"]]
  ));
  const body = await json(response);
  assert.equal(body.available, false);
  assert.equal(body.display_value, "Not disclosed");
  assert.equal(body.suppression_code, "D");
  assert.equal(body.value, undefined);
  assert.equal(body.source_value, undefined);
});

test("a Census business zero remains zero", async () => {
  const { response } = await request(dataPath({
    geography_type: "us",
    geography_code: "1",
    metric: "businesses"
  }), () => cbp("United States", "00", "Total for all sectors", "0", "0", "0", "0", { us: "1" }));
  const body = await json(response);
  assert.equal(body.value, 0);
  assert.equal(body.formatted_value, "0");
  assert.equal(body.available, true);
});

async function assertAcs(metric, variable, raw, formatted, unit) {
  const { response, calls } = await request(dataPath({
    geography_type: "us",
    geography_code: "1",
    metric
  }), (url) => {
    assert.equal(url.includes(variable), true);
    assert.equal(url.includes("https://api.census.gov/data/2024/acs/acs5/profile?"), true);
    return acs(variable, "United States", raw, { us: "1" });
  });
  const body = await json(response);
  assert.equal(body.variable, variable);
  assert.equal(body.formatted_value, formatted);
  assert.equal(body.unit, unit);
  assert.equal(body.year, 2024);
  assert.equal(body.reference_year, 2024);
  assert.equal(body.dataset, "2024 ACS 5-Year Data Profiles");
  assert.equal(body.display_dataset, "2024 ACS 5-Year Estimates");
  assert.equal(body.source, "U.S. Census Bureau");
  assert.equal(body.definition, METRICS[metric].definition);
  assert.equal(body.source_url.includes("key="), false);
  assert.equal(calls.length, 1);
  return body;
}

async function payrollFor(type, extra, payann = "123456") {
  const query = { geography_type: type, metric: "payroll", ...extra };
  const { response, calls } = await request(dataPath(query), (url) => {
    assert.equal(url.includes("PAYANN"), true);
    assert.equal(url.includes("NAICS2017=00"), true);
    const geo = type === "us"
      ? { us: "1" }
      : type === "state"
        ? { state: extra.geography_code }
        : { state: extra.state, county: extra.geography_code };
    const name = type === "us" ? "United States" : type === "state" ? "Pennsylvania" : "Erie County, Pennsylvania";
    return cbp(name, "00", "Total for all sectors", "12", payann, "1", "34", geo);
  });
  const body = await json(response);
  assert.equal(response.status, 200);
  assert.equal(calls[0].includes("/data/2023/cbp?"), true);
  return body;
}

async function request(path, handler = () => table(["NAME", "us"])) {
  const calls = [];
  const response = await handleMarketIntelligenceRequest(
    new Request(`https://pulse.test${path}`),
    env,
    async (input) => {
      const url = String(input.url || input);
      calls.push(url);
      return handler(url);
    }
  );
  return { response, calls };
}

function dataPath(query) {
  const params = new URLSearchParams(query);
  return `/api/market-intelligence/data?${params.toString()}`;
}

function acs(variable, name, value, geo) {
  const keys = Object.keys(geo);
  return table(["NAME", variable, ...keys], [[name, value, ...keys.map((key) => geo[key])]]);
}

function cbp(name, naics, label, estab, payann, payqtr, emp, geo) {
  const keys = Object.keys(geo);
  return table(
    ["NAME", "NAICS2017", "NAICS2017_LABEL", "ESTAB", "PAYANN", "PAYQTR1", "EMP", ...keys],
    [[name, naics, label, estab, payann, payqtr, emp, ...keys.map((key) => geo[key])]]
  );
}

function hierarchyPayload() {
  return jsonResponse({
    values: {
      item: {
        "00": "Total for all sectors",
        "54": "Professional, Scientific, and Technical Services",
        "541": "Professional, Scientific, and Technical Services",
        "5415": "Computer Systems Design and Related Services",
        "54151": "Computer Systems Design and Related Services",
        "541511": "Custom Computer Programming Services",
        "511210": "Software Publishers",
        "000000": "Industry total",
        "949999": "Other auxiliary establishments"
      }
    }
  });
}

function naicsPayload() {
  return jsonResponse({
    values: {
      item: {
        "00": "Total for all sectors",
        "11": "Agriculture, forestry, fishing and hunting",
        "31-33": "Manufacturing",
        "311": "Food Manufacturing",
        "1111100": "Padded duplicate"
      }
    }
  });
}

function table(header, rows = []) {
  return jsonResponse([header, ...rows]);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function json(response) {
  return response.json();
}

function bertRow() {
  return {
    title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
    slug: "bert-pre-training",
    status: "published",
    access_tier: "public",
    resource_type: "conference-paper",
    publication_date: "2019-01-01",
    source_url: "https://doi.org/10.18653/v1/n19-1423",
    rights_class: "metadata",
    summary: null,
    limitations_unknown: true,
    research_providers: { key: "openalex", attribution_text: "OpenAlex" },
    research_resource_contributors: [],
    research_resource_topics: [],
    research_licenses: []
  };
}

function draftRow() {
  return { ...bertRow(), title: "Deep Learning", slug: "deep-learning", status: "draft" };
}
