import { MESSAGES } from "./metrics.js";

export const ERRORS = {
  NAICS_CODE_REQUIRED: {
    status: 400,
    message: "Select an industry before requesting business data."
  },
  INVALID_NAICS_CODE: {
    status: 400,
    message: "The selected industry is not available in this dataset."
  },
  INVALID_GEOGRAPHY: {
    status: 400,
    message: "The selected geography is not valid."
  },
  INVALID_GEOGRAPHY_RELATIONSHIP: {
    status: 400,
    message: "The selected location does not match its state or county."
  },
  INVALID_METRIC: {
    status: 400,
    message: "This metric is not available."
  },
  NAICS_NOT_AVAILABLE_FOR_DATASET: {
    status: 409,
    message: "This industry is not available in the selected business dataset."
  },
  AMBIGUOUS_NAICS_CROSSWALK: {
    status: 409,
    message: "A comparable business value could not be determined for this industry."
  },
  UNSUPPORTED_GEOGRAPHY: {
    status: 422,
    message: MESSAGES.businessUnavailable
  },
  DATASET_VINTAGE_UNAVAILABLE: {
    status: 404,
    message: "This data year is not currently available."
  },
  NO_DATA: {
    status: 200,
    message: MESSAGES.emptyData
  },
  CENSUS_UPSTREAM_UNAVAILABLE: {
    status: 503,
    message: MESSAGES.unavailable
  },
  CENSUS_RATE_LIMITED: {
    status: 503,
    message: MESSAGES.unavailable
  },
  MARKET_DATA_UNAVAILABLE: {
    status: 503,
    message: MESSAGES.unavailable
  },
  MARKET_DATA_METADATA_UNAVAILABLE: {
    status: 503,
    message: MESSAGES.unavailable
  }
};

export function errorResult(code, extra = {}) {
  const spec = ERRORS[code] || ERRORS.CENSUS_UPSTREAM_UNAVAILABLE;
  return {
    status: spec.status,
    body: {
      error: {
        code: ERRORS[code] ? code : "CENSUS_UPSTREAM_UNAVAILABLE",
        message: spec.message
      },
      ...extra
    }
  };
}

export class CensusError extends Error {
  constructor(code) {
    super(code);
    this.name = "CensusError";
    this.code = ERRORS[code] ? code : "CENSUS_UPSTREAM_UNAVAILABLE";
  }
}
