const DEFAULT_LOCATIONS = {
  primary: createLocation({
    id: "oakville-on-ca",
    name: "Oakville",
    admin1: "Ontario",
    country: "Canada",
    latitude: 43.4675,
    longitude: -79.6877
  }),
  compare: createLocation({
    id: "downtown-toronto-on-ca",
    name: "Downtown Toronto",
    admin1: "Ontario",
    country: "Canada",
    latitude: 43.6532,
    longitude: -79.3832
  })
};

const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const LOCATION_SEARCH_DELAY = 300;
const LOCATION_RESULT_LIMIT = 8;
const HOURLY_WINDOW_SIZE = 24;
const HOUR_DRAG_DISTANCE = 28;

const RANGE_OPTIONS = [
  { key: "today", label: "Today", forecastDays: 7 },
  { key: "7d", label: "Next 7 Days", forecastDays: 7 },
  { key: "14d", label: "Next 14 Days", forecastDays: 14 }
];

const METRICS = {
  temperature: {
    label: "Temperature",
    unit: "°C",
    hourlyKey: "temperature_2m",
    aggregate: "avg"
  },
  precipitation: {
    label: "Precipitation",
    unit: "mm",
    hourlyKey: "precipitation",
    aggregate: "sum"
  },
  wind: {
    label: "Wind Speed",
    unit: "km/h",
    hourlyKey: "wind_speed_10m",
    aggregate: "avg"
  },
  cloud: {
    label: "Cloud Cover",
    unit: "%",
    hourlyKey: "cloud_cover",
    aggregate: "avg"
  }
};

METRICS.temperature.unit = `${String.fromCharCode(176)}C`;

const state = {
  primaryLocation: DEFAULT_LOCATIONS.primary,
  compareLocation: DEFAULT_LOCATIONS.compare,
  range: "today",
  metric: "temperature",
  weatherData: {},
  forecastDaysLoaded: 0,
  chart: null,
  hourlyOffset: 0
};

let weatherRequestId = 0;

const primaryCityInput = document.getElementById("primaryCity");
const compareCityInput = document.getElementById("compareCity");
const rangeButtons = document.getElementById("rangeButtons");
const metricButtons = document.getElementById("metricButtons");
const refreshBtn = document.getElementById("refreshBtn");
const swapLocationsBtn = document.getElementById("swapLocationsBtn");
const chartTitle = document.getElementById("chartTitle");
const chartSubtitle = document.getElementById("chartSubtitle");
const compareLabel = document.getElementById("compareLabel");
const forecastTable = document.getElementById("forecastTable");
const lastUpdated = document.getElementById("lastUpdated");
const errorBox = document.getElementById("errorBox");
const loadingBox = document.getElementById("loadingBox");
const chartWrap = document.getElementById("chartWrap");
const chartPanHint = document.getElementById("chartPanHint");
const primaryLocationName = document.getElementById("primaryLocationName");
const currentTime = document.getElementById("currentTime");
const currentWeatherIcon = document.getElementById("currentWeatherIcon");
const currentTemperature = document.getElementById("currentTemperature");
const currentCondition = document.getElementById("currentCondition");
const feelsLike = document.getElementById("feelsLike");
const weatherTakeaway = document.getElementById("weatherTakeaway");
const todayHighLow = document.getElementById("todayHighLow");
const rainChance = document.getElementById("rainChance");
const currentWind = document.getElementById("currentWind");
const hourlyRange = document.getElementById("hourlyRange");
const hourlyForecast = document.getElementById("hourlyForecast");
const dailyForecast = document.getElementById("dailyForecast");
const comparisonInsight = document.getElementById("comparisonInsight");

const chartDrag = {
  pointerId: null,
  startX: 0,
  startOffset: 0
};

const locationSearches = {
  primary: createLocationSearch(
    primaryCityInput,
    document.getElementById("primaryCityResults"),
    document.getElementById("primaryCityStatus"),
    state.primaryLocation
  ),
  compare: createLocationSearch(
    compareCityInput,
    document.getElementById("compareCityResults"),
    document.getElementById("compareCityStatus"),
    state.compareLocation
  )
};

const rainDecision = document.getElementById("rainDecision");
const rainReason = document.getElementById("rainReason");
const layerDecision = document.getElementById("layerDecision");
const layerReason = document.getElementById("layerReason");
const harderLocation = document.getElementById("harderLocation");
const harderReason = document.getElementById("harderReason");

function init() {
  setupLocationSearch("primary");
  setupLocationSearch("compare");
  renderRangeButtons();
  renderMetricButtons();
  setupChartPanning();

  refreshBtn.addEventListener("click", loadWeather);
  swapLocationsBtn.addEventListener("click", swapLocations);

  loadWeather();
}

function swapLocations() {
  const primaryLocation = state.primaryLocation;
  const compareLocation = state.compareLocation;

  state.primaryLocation = compareLocation;
  state.compareLocation = primaryLocation;
  locationSearches.primary.selected = compareLocation;
  locationSearches.compare.selected = primaryLocation;
  primaryCityInput.value = compareLocation.label;
  compareCityInput.value = primaryLocation.label;
  setLocationStatus(locationSearches.primary, `Selected ${compareLocation.label}.`);
  setLocationStatus(locationSearches.compare, `Selected ${primaryLocation.label}.`);
  state.forecastDaysLoaded = 0;
  state.hourlyOffset = 0;

  loadWeather();
}

function setupChartPanning() {
  chartWrap.addEventListener("pointerdown", event => {
    if (state.range !== "today" || (event.pointerType === "mouse" && event.button !== 0)) return;

    const primaryPayload = state.weatherData[getLocationKey(state.primaryLocation)];
    if (!primaryPayload || !getHourlyOffsetBounds(primaryPayload)) return;

    chartDrag.pointerId = event.pointerId;
    chartDrag.startX = event.clientX;
    chartDrag.startOffset = state.hourlyOffset;
    chartWrap.setPointerCapture(event.pointerId);
    chartWrap.classList.add("is-dragging");
  });

  chartWrap.addEventListener("pointermove", event => {
    if (event.pointerId !== chartDrag.pointerId) return;

    const hourDelta = Math.trunc((chartDrag.startX - event.clientX) / HOUR_DRAG_DISTANCE);
    if (!hourDelta) return;

    event.preventDefault();
    setHourlyOffset(chartDrag.startOffset + hourDelta);
  });

  ["pointerup", "pointercancel"].forEach(eventName => {
    chartWrap.addEventListener(eventName, event => {
      if (event.pointerId !== chartDrag.pointerId) return;

      if (chartWrap.hasPointerCapture(event.pointerId)) {
        chartWrap.releasePointerCapture(event.pointerId);
      }

      chartDrag.pointerId = null;
      chartWrap.classList.remove("is-dragging");
    });
  });

  chartWrap.addEventListener("keydown", event => {
    if (state.range !== "today") return;

    const hourDelta =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
        ? 1
        : event.key === "PageUp"
        ? -6
        : event.key === "PageDown"
        ? 6
        : 0;

    if (!hourDelta) return;

    event.preventDefault();
    setHourlyOffset(state.hourlyOffset + hourDelta);
  });
}

function setHourlyOffset(nextOffset) {
  const primaryPayload = state.weatherData[getLocationKey(state.primaryLocation)];
  const bounds = getHourlyOffsetBounds(primaryPayload);
  if (!bounds) return;

  const clampedOffset = Math.min(bounds.max, Math.max(bounds.min, nextOffset));
  if (clampedOffset === state.hourlyOffset) return;

  state.hourlyOffset = clampedOffset;
  updateDashboard();
}

function createLocation({ id, name, admin1 = "", country = "", latitude, longitude }) {
  const details = [admin1, country].filter(Boolean);

  return {
    id: String(id),
    name,
    label: [name, ...details].join(", "),
    latitude: Number(latitude),
    longitude: Number(longitude)
  };
}

function createLocationSearch(input, resultsBox, status, selected) {
  return {
    input,
    resultsBox,
    status,
    selected,
    results: [],
    activeIndex: -1,
    requestId: 0,
    timer: null
  };
}

function getLocationKey(location) {
  return `${location.id}-${location.latitude}-${location.longitude}`;
}

function normalizeLocation(result) {
  return createLocation({
    id: `geocoding-${result.id ?? `${result.latitude}-${result.longitude}`}`,
    name: result.name,
    admin1: result.admin1,
    country: result.country,
    latitude: result.latitude,
    longitude: result.longitude
  });
}

function setupLocationSearch(type) {
  const search = locationSearches[type];
  search.input.value = search.selected.label;

  search.input.addEventListener("focus", () => search.input.select());
  search.input.addEventListener("input", () => handleLocationInput(type));
  search.input.addEventListener("keydown", event => handleLocationKeydown(type, event));
  search.input.addEventListener("blur", () => handleLocationBlur(type));
}

function handleLocationInput(type) {
  const search = locationSearches[type];
  const query = search.input.value.trim();

  window.clearTimeout(search.timer);
  search.requestId += 1;
  resetLocationResults(search);

  if (query.length < 3) {
    search.input.setAttribute("aria-busy", "false");
    setLocationStatus(
      search,
      query ? "Type at least 3 characters to search for a location." : ""
    );
    return;
  }

  search.input.setAttribute("aria-busy", "true");
  setLocationStatus(search, "Searching locations...");
  search.timer = window.setTimeout(() => searchLocations(type, query), LOCATION_SEARCH_DELAY);
}

async function searchLocations(type, query) {
  const search = locationSearches[type];
  const requestId = ++search.requestId;
  const params = new URLSearchParams({
    name: query,
    count: String(LOCATION_RESULT_LIMIT),
    language: "en"
  });

  try {
    const response = await fetch(`${GEOCODING_ENDPOINT}?${params.toString()}`);

    if (!response.ok) {
      throw new Error("Location search request failed.");
    }

    const payload = await response.json();
    if (requestId !== search.requestId || search.input.value.trim() !== query) return;

    search.results = (payload.results || [])
      .map(normalizeLocation)
      .filter(location => location.name && Number.isFinite(location.latitude) && Number.isFinite(location.longitude));
    search.activeIndex = -1;
    search.input.setAttribute("aria-busy", "false");

    if (!search.results.length) {
      resetLocationResults(search);
      setLocationStatus(search, "No matching locations found. Try a more specific search.");
      return;
    }

    renderLocationResults(type);
    setLocationStatus(search, `${search.results.length} location${search.results.length === 1 ? "" : "s"} found. Use the arrow keys to choose one.`);
  } catch (error) {
    if (requestId !== search.requestId) return;

    search.input.setAttribute("aria-busy", "false");
    resetLocationResults(search);
    setLocationStatus(search, "We couldn't search for locations. Please try again.", true);
  }
}

function renderLocationResults(type) {
  const search = locationSearches[type];
  search.resultsBox.replaceChildren();

  search.results.forEach((location, index) => {
    const option = document.createElement("div");
    const name = document.createElement("span");
    const details = document.createElement("span");

    option.id = `${type}LocationOption${index}`;
    option.className = "location-result";
    option.tabIndex = -1;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    name.className = "location-result-name";
    details.className = "location-result-meta";
    name.textContent = location.name;
    details.textContent = location.label.split(", ").slice(1).join(", ");

    option.append(name, details);
    option.addEventListener("mousedown", event => {
      event.preventDefault();
      selectLocation(type, location);
    });
    search.resultsBox.append(option);
  });

  search.resultsBox.classList.remove("hidden");
  search.input.setAttribute("aria-expanded", "true");
}

function handleLocationKeydown(type, event) {
  const search = locationSearches[type];

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!search.results.length) return;

    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    search.activeIndex = (search.activeIndex + direction + search.results.length) % search.results.length;
    updateActiveLocationResult(search);
    return;
  }

  if (event.key === "Enter") {
    if (!search.results.length) return;

    event.preventDefault();
    selectLocation(type, search.results[search.activeIndex < 0 ? 0 : search.activeIndex]);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    window.clearTimeout(search.timer);
    search.requestId += 1;
    search.input.value = search.selected.label;
    search.input.setAttribute("aria-busy", "false");
    resetLocationResults(search);
    setLocationStatus(search, "");
  }
}

function updateActiveLocationResult(search) {
  const options = search.resultsBox.querySelectorAll(".location-result");

  options.forEach((option, index) => {
    const isActive = index === search.activeIndex;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-selected", String(isActive));
  });

  const activeOption = options[search.activeIndex];
  if (activeOption) {
    search.input.setAttribute("aria-activedescendant", activeOption.id);
    activeOption.scrollIntoView({ block: "nearest" });
  }
}

function handleLocationBlur(type) {
  const search = locationSearches[type];

  window.setTimeout(() => {
    window.clearTimeout(search.timer);
    search.requestId += 1;
    search.input.setAttribute("aria-busy", "false");

    if (search.input.value.trim() !== search.selected.label) {
      search.input.value = search.selected.label;
    }

    resetLocationResults(search);
    setLocationStatus(search, "");
  }, 150);
}

function closeLocationResults(search) {
  search.resultsBox.classList.add("hidden");
  search.input.setAttribute("aria-expanded", "false");
  search.input.removeAttribute("aria-activedescendant");
}

function resetLocationResults(search) {
  search.results = [];
  search.activeIndex = -1;
  search.resultsBox.replaceChildren();
  closeLocationResults(search);
}

function setLocationStatus(search, message, isError = false) {
  search.status.textContent = message;
  search.status.classList.toggle("error", isError);
}

function selectLocation(type, location) {
  const search = locationSearches[type];
  const hasChanged = getLocationKey(search.selected) !== getLocationKey(location);

  search.selected = location;
  search.input.value = location.label;
  window.clearTimeout(search.timer);
  search.requestId += 1;
  search.input.setAttribute("aria-busy", "false");
  resetLocationResults(search);
  setLocationStatus(search, `Selected ${location.label}.`);

  if (!hasChanged) return;

  if (type === "primary") {
    state.primaryLocation = location;
  } else {
    state.compareLocation = location;
  }

  state.forecastDaysLoaded = 0;
  state.hourlyOffset = 0;
  loadWeather();
}

function renderRangeButtons() {
  rangeButtons.innerHTML = RANGE_OPTIONS.map(option => {
    const activeClass = option.key === state.range ? "active" : "";
    return `<button class="pill-btn ${activeClass}" data-range="${option.key}">${option.label}</button>`;
  }).join("");

  rangeButtons.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      state.range = button.dataset.range;
      state.hourlyOffset = 0;
      renderRangeButtons();
      const neededDays = getForecastDays();
      if (state.forecastDaysLoaded < neededDays) {
        loadWeather();
      } else {
        updateDashboard();
      }
    });
  });
}

function renderMetricButtons() {
  metricButtons.innerHTML = Object.entries(METRICS)
    .map(([key, config]) => {
      const activeClass = key === state.metric ? "active" : "";
      return `<button class="pill-btn ${activeClass}" data-metric="${key}">${config.label}</button>`;
    })
    .join("");

  metricButtons.querySelectorAll("button").forEach(button => {
    button.addEventListener("click", () => {
      state.metric = button.dataset.metric;
      renderMetricButtons();
      updateDashboard();
    });
  });
}

function getForecastDays() {
  return RANGE_OPTIONS.find(option => option.key === state.range)?.forecastDays || 7;
}

async function fetchWeather(location, forecastDays) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    hourly: "temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m,cloud_cover",
    current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,cloud_cover",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
    timezone: "auto",
    forecast_days: String(forecastDays)
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Weather request failed for ${location.name}.`);
  }

  return response.json();
}

async function loadWeather() {
  const requestId = ++weatherRequestId;
  const primaryLocation = state.primaryLocation;
  const compareLocation = state.compareLocation;

  showLoading(true);
  showError("");

  try {
    const forecastDays = getForecastDays();

    const [primaryPayload, comparePayload] = await Promise.all([
      fetchWeather(primaryLocation, forecastDays),
      fetchWeather(compareLocation, forecastDays)
    ]);

    if (requestId !== weatherRequestId) return;

    state.weatherData[getLocationKey(primaryLocation)] = primaryPayload;
    state.weatherData[getLocationKey(compareLocation)] = comparePayload;
    state.forecastDaysLoaded = forecastDays;

    lastUpdated.textContent = new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date());

    updateDashboard();
  } catch (error) {
    if (requestId !== weatherRequestId) return;
    showError(error.message || "Something went wrong while loading weather data.");
  } finally {
    if (requestId === weatherRequestId) {
      showLoading(false);
    }
  }
}

function updateDashboard() {
  const primaryPayload = state.weatherData[getLocationKey(state.primaryLocation)];
  const comparePayload = state.weatherData[getLocationKey(state.compareLocation)];

  if (!primaryPayload || !comparePayload) return;

  renderCurrentConditions(primaryPayload);
  renderDecisionCards(primaryPayload, comparePayload);
  renderHourlyForecast(primaryPayload);
  renderDailyForecast(primaryPayload);
  renderComparisonInsight(primaryPayload, comparePayload);
  renderChart(primaryPayload, comparePayload);
  renderForecastTable(primaryPayload);
  renderChartLabels(primaryPayload);
}

function renderDecisionCards(primaryPayload, comparePayload) {
  const p = primaryPayload.current;
  const c = comparePayload.current;

  const rainMax = Math.max(p.precipitation, c.precipitation);
  const rainChanceMax = Math.max(
    getDailyValue(primaryPayload.daily?.precipitation_probability_max, 0) || 0,
    getDailyValue(comparePayload.daily?.precipitation_probability_max, 0) || 0
  );
  const colderTemp = Math.min(p.temperature_2m, c.temperature_2m);
  const windMax = Math.max(p.wind_speed_10m, c.wind_speed_10m);

  if (rainMax >= 1 || rainChanceMax >= 60) {
    rainDecision.textContent = "Bring it";
    rainReason.textContent = `Rain is likely today, with up to a ${formatNumber(rainChanceMax)}% chance.`;
  } else if (rainMax > 0 || rainChanceMax >= 25) {
    rainDecision.textContent = "A good idea";
    rainReason.textContent = `There is a ${formatNumber(rainChanceMax)}% chance of rain across the selected locations.`;
  } else {
    rainDecision.textContent = "Not needed";
    rainReason.textContent = "Current precipitation is very low across the selected locations.";
  }

  if (colderTemp <= 5 || windMax >= 18) {
    layerDecision.textContent = "Yes";
    layerReason.textContent = "Cooler temperatures or stronger wind may make the commute less comfortable.";
  } else if (colderTemp <= 10 || windMax >= 10) {
    layerDecision.textContent = "Maybe";
    layerReason.textContent = "Conditions are mild, but an extra layer could still help outdoors.";
  } else {
    layerDecision.textContent = "Probably not";
    layerReason.textContent = "Both selected locations look fairly comfortable right now.";
  }

  const primaryScore = getDiscomfortScore(p);
  const compareScore = getDiscomfortScore(c);

  if (Math.abs(primaryScore - compareScore) < 2) {
    harderLocation.textContent = "Fairly similar";
    harderReason.textContent = `${state.primaryLocation.label} and ${state.compareLocation.label} feel relatively close right now.`;
  } else if (primaryScore > compareScore) {
    harderLocation.textContent = state.primaryLocation.label;
    harderReason.textContent = `${state.primaryLocation.label} currently looks less comfortable because of combined wind, rain, or temperature conditions.`;
  } else {
    harderLocation.textContent = state.compareLocation.label;
    harderReason.textContent = `${state.compareLocation.label} currently looks less comfortable because of combined wind, rain, or temperature conditions.`;
  }
}

function getDiscomfortScore(current) {
  let score = 0;
  score += current.precipitation * 3;
  score += Math.max(0, current.wind_speed_10m - 8) * 0.4;
  score += Math.max(0, 10 - current.temperature_2m) * 0.5;
  return score;
}

function renderSummaryCards(payload) {
  const cards = [
    {
      label: "Current temperature",
      value: payload.current.temperature_2m,
      unit: "°C"
    },
    {
      label: "Current precipitation",
      value: payload.current.precipitation,
      unit: "mm"
    },
    {
      label: "Current wind speed",
      value: payload.current.wind_speed_10m,
      unit: "km/h"
    },
    {
      label: "Current cloud cover",
      value: payload.current.cloud_cover,
      unit: "%"
    }
  ];

  summaryCards.innerHTML = cards
    .map(card => {
      return `
        <article class="card summary-card">
          <span class="summary-label">${card.label}</span>
          <div class="summary-value">
            ${formatNumber(card.value)}<span class="summary-unit">${card.unit}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCurrentConditions(payload) {
  const current = payload.current;
  const today = payload.daily || {};
  const weather = getWeatherDetails(current.weather_code);
  const rainProbability = getDailyValue(today.precipitation_probability_max, 0);
  const high = getDailyValue(today.temperature_2m_max, 0);
  const low = getDailyValue(today.temperature_2m_min, 0);

  primaryLocationName.textContent = state.primaryLocation.name;
  currentTime.textContent = formatForecastDateTime(current.time, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  });
  currentWeatherIcon.textContent = weather.icon;
  currentCondition.textContent = weather.label;
  currentTemperature.textContent = formatNumber(current.temperature_2m);
  feelsLike.textContent = `Feels like ${formatTemperature(current.apparent_temperature)}`;
  todayHighLow.textContent = `${formatTemperature(high)} / ${formatTemperature(low)}`;
  rainChance.textContent = `${formatNumber(rainProbability)}%`;
  currentWind.textContent = `${formatNumber(current.wind_speed_10m)} km/h`;
  weatherTakeaway.textContent = getWeatherTakeaway(current, rainProbability, weather.label);
}

function renderHourlyForecast(payload) {
  const times = payload.hourly?.time || [];
  const temperatures = payload.hourly?.temperature_2m || [];
  const probabilities = payload.hourly?.precipitation_probability || [];
  const weatherCodes = payload.hourly?.weather_code || [];
  const startIndex = getHourlyWindowStart(payload, 0);
  const currentHourIndex = getClosestCurrentHourIndex(payload);
  const visibleTimes = times.slice(startIndex, startIndex + HOURLY_WINDOW_SIZE);

  hourlyRange.textContent = getHourlyWindowLabel(
    visibleTimes.map(time => ({ time }))
  );
  hourlyForecast.innerHTML = visibleTimes
    .map((time, offset) => {
      const index = startIndex + offset;
      const isNow = index === currentHourIndex;
      const rainProbability = probabilities[index] ?? 0;

      return `
        <article class="hourly-item${isNow ? " is-now" : ""}">
          <span class="hourly-time">${isNow ? "Now" : getHourLabel(time)}</span>
          <span class="hourly-weather-icon" aria-hidden="true">${getWeatherDetails(weatherCodes[index]).icon}</span>
          <strong class="hourly-temperature">${formatTemperature(temperatures[index])}</strong>
          <span class="hourly-rain">${rainProbability > 0 ? `${formatNumber(rainProbability)}% rain` : "Dry"}</span>
        </article>
      `;
    })
    .join("");
}

function renderDailyForecast(payload) {
  const daily = payload.daily || {};
  const dates = daily.time || [];

  dailyForecast.innerHTML = dates
    .slice(0, 7)
    .map((date, index) => {
      const weather = getWeatherDetails(daily.weather_code?.[index]);
      const high = daily.temperature_2m_max?.[index];
      const low = daily.temperature_2m_min?.[index];
      const rainProbability = daily.precipitation_probability_max?.[index] ?? 0;

      return `
        <article class="daily-item${index === 0 ? " is-today" : ""}">
          <span class="daily-day">${index === 0 ? "Today" : getShortDayLabel(date)}</span>
          <span class="daily-weather-icon" aria-hidden="true">${weather.icon}</span>
          <strong class="daily-temperature">${formatTemperature(high)} <span>${formatTemperature(low)}</span></strong>
          <span class="daily-rain">${rainProbability > 0 ? `${formatNumber(rainProbability)}%` : "Dry"}</span>
        </article>
      `;
    })
    .join("");
}

function renderComparisonInsight(primaryPayload, comparePayload) {
  const primaryTemperature = primaryPayload.current.temperature_2m;
  const compareTemperature = comparePayload.current.temperature_2m;
  const difference = Math.abs(primaryTemperature - compareTemperature);

  if (difference < 0.5) {
    comparisonInsight.textContent = `${state.primaryLocation.name} and ${state.compareLocation.name} are nearly the same temperature right now.`;
    return;
  }

  const warmerLocation =
    primaryTemperature > compareTemperature ? state.primaryLocation.name : state.compareLocation.name;
  comparisonInsight.textContent = `${warmerLocation} is ${formatTemperature(difference)} warmer right now.`;
}

function getDailyValue(values, index) {
  return values?.[index] ?? null;
}

function getWeatherTakeaway(current, rainProbability, weatherLabel) {
  if (rainProbability >= 60 || current.precipitation >= 1) {
    return `Rain is likely today. ${weatherLabel} conditions make an umbrella a sensible choice.`;
  }

  if (current.wind_speed_10m >= 25) {
    return `It is breezy right now, so it may feel cooler than the temperature suggests.`;
  }

  if (current.temperature_2m <= 5) {
    return `Cool conditions are expected today. A warmer outer layer will help.`;
  }

  return `${weatherLabel} conditions look comfortable for getting around today.`;
}

function getWeatherDetails(code) {
  if (code === 0) return { icon: String.fromCodePoint(0x2600, 0xfe0f), label: "Clear sky" };
  if (code === 1) return { icon: String.fromCodePoint(0x1f324, 0xfe0f), label: "Mostly clear" };
  if (code === 2) return { icon: String.fromCodePoint(0x26c5), label: "Partly cloudy" };
  if (code === 3) return { icon: String.fromCodePoint(0x2601, 0xfe0f), label: "Overcast" };
  if ([45, 48].includes(code)) return { icon: String.fromCodePoint(0x1f32b, 0xfe0f), label: "Foggy" };
  if ([51, 53, 55, 56, 57].includes(code)) return { icon: String.fromCodePoint(0x1f326, 0xfe0f), label: "Drizzle" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { icon: String.fromCodePoint(0x1f327, 0xfe0f), label: "Rain showers" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: String.fromCodePoint(0x1f328, 0xfe0f), label: "Snow showers" };
  if ([95, 96, 99].includes(code)) return { icon: String.fromCodePoint(0x26c8, 0xfe0f), label: "Thunderstorms" };

  return { icon: String.fromCodePoint(0x1f324, 0xfe0f), label: "Changing conditions" };
  if (code === 0) return { icon: "☀️", label: "Clear sky" };
  if (code === 1) return { icon: "🌤️", label: "Mostly clear" };
  if (code === 2) return { icon: "⛅", label: "Partly cloudy" };
  if (code === 3) return { icon: "☁️", label: "Overcast" };
  if ([45, 48].includes(code)) return { icon: "🌫️", label: "Foggy" };
  if ([51, 53, 55, 56, 57].includes(code)) return { icon: "🌦️", label: "Drizzle" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { icon: "🌧️", label: "Rain showers" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: "🌨️", label: "Snow showers" };
  if ([95, 96, 99].includes(code)) return { icon: "⛈️", label: "Thunderstorms" };

  return { icon: "🌤️", label: "Changing conditions" };
}

function renderChartLabels(primaryPayload) {
  const metricConfig = METRICS[state.metric];
  chartTitle.textContent = `${metricConfig.label} comparison`;

  if (state.range === "today") {
    const series = buildChartSeries(primaryPayload, state.metric, state.range);
    const windowLabel = getHourlyWindowLabel(series);

    chartSubtitle.textContent = windowLabel
      ? `Hourly view from ${windowLabel}`
      : "Hourly view for near-term commute and campus decisions";
    chartPanHint.textContent = "Drag left for later hours or right for earlier hours. You can also use the left and right arrow keys.";
    chartWrap.setAttribute("aria-label", "Hourly forecast chart. Drag left to view later hours or right to view earlier hours.");
    chartWrap.classList.add("is-pannable");
  } else {
    chartSubtitle.textContent = `Daily view for the next ${state.range === "7d" ? 7 : 14} days`;
    chartPanHint.textContent = "Switch to Today to pan through the hourly forecast.";
    chartWrap.setAttribute("aria-label", "Daily forecast chart");
    chartWrap.classList.remove("is-pannable");
  }

  compareLabel.textContent = `${state.primaryLocation.label} compared with ${state.compareLocation.label}`;
}

function renderChart(primaryPayload, comparePayload) {
  const primarySeries = buildChartSeries(primaryPayload, state.metric, state.range);
  const compareSeries = buildChartSeries(comparePayload, state.metric, state.range);
  const metricConfig = METRICS[state.metric];

  const labels = primarySeries.map(item => item.label);
  const primaryValues = primarySeries.map(item => item.value);
  const compareValues = compareSeries.map(item => item.value);

  const ctx = document.getElementById("weatherChart").getContext("2d");

  if (state.chart) {
    state.chart.destroy();
  }

  const chartType = state.metric === "precipitation" ? "bar" : "line";

  state.chart = new Chart(ctx, {
    type: chartType,
    data: {
      labels,
      datasets: [
        {
          label: state.primaryLocation.label,
          data: primaryValues,
          borderColor: "#2563eb",
          backgroundColor:
            state.metric === "cloud"
              ? "rgba(37, 99, 235, 0.15)"
              : state.metric === "precipitation"
              ? "rgba(37, 99, 235, 0.78)"
              : "rgba(37, 99, 235, 0.78)",
          tension: 0.35,
          fill: state.metric === "cloud",
          borderWidth: 3
        },
        {
          label: state.compareLocation.label,
          data: compareValues,
          borderColor: "#7c3aed",
          backgroundColor: "rgba(124, 58, 237, 0.28)",
          tension: 0.35,
          fill: false,
          borderWidth: 2.5,
          borderDash: [6, 4]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          labels: {
            usePointStyle: true,
            boxWidth: 10,
            color: "#334155",
            font: {
              family: "Inter",
              weight: "600"
            }
          }
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${formatNumber(context.raw)} ${metricConfig.unit}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: "#64748b",
            font: {
              family: "Inter"
            }
          }
        },
        y: {
          beginAtZero: state.metric === "precipitation",
          grid: {
            color: "#e2e8f0"
          },
          ticks: {
            color: "#64748b",
            font: {
              family: "Inter"
            }
          }
        }
      }
    }
  });
}

function renderForecastTable(payload) {
  const series = buildChartSeries(payload, state.metric, state.range);
  const metricConfig = METRICS[state.metric];
  const visibleRows =
    state.range === "today"
      ? series.slice(0, 8)
      : state.range === "7d"
      ? series.slice(0, 7)
      : series.slice(0, 10);

  forecastTable.innerHTML = visibleRows
    .map(row => {
      return `
        <div class="table-row">
          <span>${row.label}</span>
          <span>${formatNumber(row.value)} ${metricConfig.unit}</span>
        </div>
      `;
    })
    .join("");
}

function getHourlyOffsetBounds(payload) {
  const times = payload?.hourly?.time || [];
  if (!times.length) return null;

  const currentHourIndex = getClosestCurrentHourIndex(payload);
  const lastWindowStart = Math.max(0, times.length - HOURLY_WINDOW_SIZE);

  return {
    min: -currentHourIndex,
    max: lastWindowStart - currentHourIndex
  };
}

function getHourlyWindowStart(payload, offset = state.hourlyOffset) {
  const bounds = getHourlyOffsetBounds(payload);
  if (!bounds) return 0;

  const currentHourIndex = getClosestCurrentHourIndex(payload);
  const clampedOffset = Math.min(bounds.max, Math.max(bounds.min, offset));

  return currentHourIndex + clampedOffset;
}

function getClosestCurrentHourIndex(payload) {
  const times = payload?.hourly?.time || [];
  const currentTime = payload?.current?.time;
  const currentTimestamp = Date.parse(currentTime);

  if (!times.length || Number.isNaN(currentTimestamp)) return 0;

  return times.reduce((closestIndex, time, index) => {
    const closestDifference = Math.abs(Date.parse(times[closestIndex]) - currentTimestamp);
    const nextDifference = Math.abs(Date.parse(time) - currentTimestamp);

    return nextDifference < closestDifference ? index : closestIndex;
  }, 0);
}

function getHourlyWindowLabel(series) {
  if (!series.length) return "";

  const start = formatForecastDateTime(series[0].time, {
    weekday: "short",
    hour: "numeric"
  });
  const end = formatForecastDateTime(series[series.length - 1].time, {
    weekday: "short",
    hour: "numeric"
  });

  return `${start} to ${end}`;
  return `${start}–${end}`;
}

function buildChartSeries(payload, metricKey, rangeKey) {
  if (!payload || !payload.hourly) return [];

  const metric = METRICS[metricKey];
  const times = payload.hourly.time || [];
  const values = payload.hourly[metric.hourlyKey] || [];

  if (rangeKey === "today") {
    const startIndex = getHourlyWindowStart(payload);

    return times.slice(startIndex, startIndex + HOURLY_WINDOW_SIZE).map((time, offset) => ({
      label: getHourLabel(time),
      time,
      value: values[startIndex + offset]
    }));
  }

  const maxDays = rangeKey === "7d" ? 7 : 14;
  const byDay = new Map();

  times.forEach((time, index) => {
    const day = time.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(values[index]);
  });

  return Array.from(byDay.entries())
    .slice(0, maxDays)
    .map(([day, dayValues]) => ({
      label: getDayLabel(day),
      value:
        metric.aggregate === "sum"
          ? dayValues.reduce((sum, value) => sum + value, 0)
          : average(dayValues)
    }));
}

function getHourLabel(timestamp) {
  const hour = Number(timestamp.slice(11, 13));

  return formatForecastDateTime(
    timestamp,
    hour === 0 ? { weekday: "short", hour: "numeric" } : { hour: "numeric" }
  );
}

function formatForecastDateTime(timestamp, options) {
  const [datePart, timePart] = timestamp.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const date = new Date(year, month - 1, day, hour, minute);

  return new Intl.DateTimeFormat("en-CA", options).format(date);
}

function getDayLabel(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

function getShortDayLabel(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return new Intl.DateTimeFormat("en-CA", { weekday: "short" }).format(date);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return String.fromCharCode(8212);
  if (value == null || Number.isNaN(value)) return "—";
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function formatTemperature(value) {
  return `${formatNumber(value)}${String.fromCharCode(176)}`;
}

function showError(message) {
  if (!message) {
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    return;
  }

  errorBox.classList.remove("hidden");
  errorBox.textContent = message;
}

function showLoading(isLoading) {
  loadingBox.classList.toggle("hidden", !isLoading);
  document.body.classList.toggle("is-loading", isLoading);
}

init();
