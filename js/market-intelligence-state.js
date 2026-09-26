export const COPY = {
  loadingStates: "Loading states...",
  loadingCounties: "Loading counties...",
  loadingPlaces: "Loading cities and places...",
  loadingTownships: "Loading townships...",
  loadingData: "Loading market data...",
  loadingIndustries: "Loading industries...",
  emptyLocations: "No locations are available for this selection.",
  emptyData: "No data is available for this selection.",
  unavailable: "Market Intelligence is temporarily unavailable. Please try again.",
  businessUnavailable: "Business data is not available from this Census dataset at this geography.",
  metricUnavailable: "This metric is not available for the selected geography."
};

const LOADING = {
  states: { message: COPY.loadingStates, disable: ["mi-state"] },
  counties: { message: COPY.loadingCounties, disable: ["mi-county"] },
  places: { message: COPY.loadingPlaces, disable: ["mi-place"] },
  subdivisions: { message: COPY.loadingTownships, disable: ["mi-subdivision"] },
  data: { message: COPY.loadingData, disable: ["mi-metric"] },
  industries: { message: COPY.loadingIndustries, disable: ["mi-sector", "mi-detail"] }
};

export function initialSelection() {
  return {
    stateCode: "",
    countyCode: "",
    placeCode: "",
    subdivisionCode: "",
    metric: "population",
    naics: "00"
  };
}

export function reduceSelection(state, action) {
  if (action.type === "state") {
    return {
      ...state,
      stateCode: action.code || "",
      countyCode: "",
      placeCode: "",
      subdivisionCode: ""
    };
  }
  if (action.type === "county") {
    return {
      ...state,
      countyCode: action.code || "",
      placeCode: "",
      subdivisionCode: ""
    };
  }
  if (action.type === "place") {
    return {
      ...state,
      placeCode: action.code || "",
      subdivisionCode: ""
    };
  }
  if (action.type === "subdivision") {
    return {
      ...state,
      subdivisionCode: action.code || "",
      placeCode: ""
    };
  }
  if (action.type === "metric") {
    return { ...state, metric: action.metric || "population" };
  }
  if (action.type === "naics") {
    return { ...state, naics: action.naics || "00" };
  }
  return state;
}

export function effectiveQuery(selection) {
  const query = { metric: selection.metric };
  if (selection.metric === "industry") query.naics = selection.naics || "00";
  if (selection.placeCode && selection.stateCode) {
    return {
      ...query,
      geography_type: "place",
      geography_code: selection.placeCode,
      state: selection.stateCode
    };
  }
  if (selection.subdivisionCode && selection.stateCode && selection.countyCode) {
    return {
      ...query,
      geography_type: "county-subdivision",
      geography_code: selection.subdivisionCode,
      state: selection.stateCode,
      county: selection.countyCode
    };
  }
  if (selection.countyCode && selection.stateCode) {
    return {
      ...query,
      geography_type: "county",
      geography_code: selection.countyCode,
      state: selection.stateCode
    };
  }
  if (selection.stateCode) {
    return {
      ...query,
      geography_type: "state",
      geography_code: selection.stateCode
    };
  }
  return { ...query, geography_type: "us", geography_code: "1" };
}

export function geographyLoads(selection) {
  if (!selection.stateCode) return [];
  const loads = [{ kind: "counties", level: "counties", state: selection.stateCode }];
  if (selection.countyCode) {
    loads.push({ kind: "places", level: "places", state: selection.stateCode });
    loads.push({
      kind: "subdivisions",
      level: "county-subdivisions",
      state: selection.stateCode,
      county: selection.countyCode
    });
  }
  return loads;
}

export function loadingPlan(kind) {
  return LOADING[kind];
}

export function sectorChoices(industries) {
  return industries.filter((item) => item.parent === "00");
}

export function detailChoices(industries, sectorNaics) {
  if (!sectorNaics || sectorNaics === "00") return [];
  const byCode = new Map(industries.map((item) => [item.naics, item]));
  return industries.filter((item) => {
    let parent = item.parent;
    const seen = new Set();
    while (parent && !seen.has(parent)) {
      if (parent === sectorNaics) return true;
      seen.add(parent);
      parent = byCode.get(parent)?.parent || null;
    }
    return false;
  });
}

export function createFlightMap() {
  const flights = new Map();
  return {
    run(key, fn) {
      if (flights.has(key)) return flights.get(key);
      const promise = Promise.resolve().then(fn).finally(() => {
        if (flights.get(key) === promise) flights.delete(key);
      });
      flights.set(key, promise);
      return promise;
    },
    size() {
      return flights.size;
    }
  };
}

export function createDataLoader(fetchData) {
  const flights = new Map();
  let seq = 0;
  return {
    load(query) {
      const key = JSON.stringify(query);
      const ticket = ++seq;
      for (const [otherKey, flight] of [...flights]) {
        if (otherKey !== key && flight?.controller) flight.controller.abort();
      }
      let flight = flights.get(key);
      if (!flight) {
        const controller = new AbortController();
        const promise = Promise.resolve()
          .then(() => fetchData(query, controller.signal))
          .finally(() => {
            if (flights.get(key)?.controller === controller) flights.delete(key);
          });
        flight = { controller, promise };
        flights.set(key, flight);
      }
      return {
        ticket,
        promise: flight.promise,
        isCurrent: () => ticket === seq
      };
    }
  };
}

export function dataQueryString(query) {
  const params = new URLSearchParams();
  const keys = ["geography_type", "geography_code", "state", "county", "metric", "naics"];
  for (const key of keys) {
    if (query[key]) params.set(key, query[key]);
  }
  return params.toString();
}
