import assert from "node:assert/strict";
import test from "node:test";
import { MESSAGES } from "../workers/market-intelligence/metrics.js";
import {
  COPY,
  createDataLoader,
  createFlightMap,
  dataQueryString,
  detailChoices,
  effectiveQuery,
  geographyLoads,
  initialSelection,
  loadingPlan,
  reduceSelection,
  sectorChoices
} from "./market-intelligence-state.js";

test("changing the state clears county and local selections", () => {
  const selected = reduceSelection(initialSelection(), { type: "state", code: "42" });
  const county = reduceSelection(selected, { type: "county", code: "049" });
  const place = reduceSelection(county, { type: "place", code: "78512" });
  const next = reduceSelection(place, { type: "state", code: "39" });
  assert.equal(next.stateCode, "39");
  assert.equal(next.countyCode, "");
  assert.equal(next.placeCode, "");
  assert.equal(next.subdivisionCode, "");
  assert.equal(effectiveQuery(next).geography_type, "state");
});

test("changing the county clears local selections and refreshes local requests", () => {
  let selection = reduceSelection(initialSelection(), { type: "state", code: "42" });
  selection = reduceSelection(selection, { type: "county", code: "049" });
  selection = reduceSelection(selection, { type: "subdivision", code: "78520" });
  const before = geographyLoads(selection).map((item) => dataQueryString(item));
  selection = reduceSelection(selection, { type: "county", code: "003" });
  const after = geographyLoads(selection);
  assert.equal(selection.placeCode, "");
  assert.equal(selection.subdivisionCode, "");
  assert.equal(after.some((item) => item.level === "places" && item.state === "42"), true);
  assert.equal(after.some((item) => item.level === "county-subdivisions" && item.county === "003"), true);
  assert.notDeepEqual(before, after.map((item) => dataQueryString(item)));
});

test("state and county can be used without a local area", () => {
  const state = reduceSelection(initialSelection(), { type: "state", code: "42" });
  assert.equal(effectiveQuery(state).geography_type, "state");
  assert.equal(geographyLoads(state).some((item) => item.level === "places"), false);
  const county = reduceSelection(state, { type: "county", code: "049" });
  assert.equal(effectiveQuery(county).geography_type, "county");
  assert.equal(effectiveQuery(county).county, undefined);
});

test("city and county subdivision are alternative selections", () => {
  let selection = reduceSelection(initialSelection(), { type: "state", code: "42" });
  selection = reduceSelection(selection, { type: "county", code: "049" });
  const place = reduceSelection(selection, { type: "place", code: "78512" });
  assert.equal(effectiveQuery(place).geography_type, "place");
  assert.equal(dataQueryString(effectiveQuery(place)).includes("county="), false);
  const subdivision = reduceSelection(place, { type: "subdivision", code: "78520" });
  assert.equal(subdivision.placeCode, "");
  assert.equal(effectiveQuery(subdivision).geography_type, "county-subdivision");
  assert.equal(effectiveQuery(subdivision).county, "049");
});

test("loading states name the request in progress", () => {
  assert.equal(loadingPlan("states").message, "Loading states...");
  assert.deepEqual(loadingPlan("states").disable, ["mi-state"]);
  assert.equal(loadingPlan("counties").message, "Loading counties...");
  assert.equal(loadingPlan("places").message, "Loading cities and places...");
  assert.equal(loadingPlan("subdivisions").message, "Loading townships...");
  assert.equal(loadingPlan("data").message, "Loading market data...");
  assert.equal(loadingPlan("industries").message, "Loading industries...");
  assert.equal(COPY.emptyLocations, MESSAGES.emptyLocations);
  assert.equal(COPY.emptyData, MESSAGES.emptyData);
  assert.equal(COPY.unavailable, MESSAGES.unavailable);
  assert.equal(COPY.businessUnavailable, MESSAGES.businessUnavailable);
  assert.equal(COPY.metricUnavailable, MESSAGES.metricUnavailable);
});

test("repeated requests share one in-flight call", async () => {
  let calls = 0;
  const flights = createFlightMap();
  const run = () => flights.run("population", async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return "ok";
  });
  const [first, second] = await Promise.all([run(), run()]);
  assert.equal(first, "ok");
  assert.equal(second, "ok");
  assert.equal(calls, 1);
});

test("a newer market-data request does not keep an older overlapping call", async () => {
  const seen = [];
  const loader = createDataLoader(async (query, signal) => {
    seen.push(query.metric);
    if (signal.aborted) {
      const aborted = new Error("aborted");
      aborted.name = "AbortError";
      throw aborted;
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 30);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
    return query.metric;
  });
  const first = loader.load({ metric: "population" });
  const second = loader.load({ metric: "households" });
  await assert.rejects(first.promise, (error) => error.name === "AbortError");
  assert.equal(await second.promise, "households");
  assert.equal(second.isCurrent(), true);
  assert.equal(first.isCurrent(), false);
  assert.deepEqual(seen, ["population", "households"]);
});

test("industry choices stay inside the Census hierarchy", () => {
  const industries = [
    { naics: "00", label: "Total for all sectors", selector_label: "All Industries", parent: null },
    { naics: "31-33", label: "Manufacturing", selector_label: "Manufacturing", parent: "00" },
    { naics: "311", label: "Food Manufacturing", selector_label: "Food Manufacturing", parent: "31-33" }
  ];
  assert.deepEqual(sectorChoices(industries).map((item) => item.naics), ["31-33"]);
  assert.deepEqual(detailChoices(industries, "31-33").map((item) => item.naics), ["311"]);
  assert.deepEqual(detailChoices(industries, "00"), []);
});
