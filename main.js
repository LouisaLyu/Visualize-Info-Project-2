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

const RANGE_OPTIONS = [
  { key: "today", label: "Today", forecastDays: 2 },
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

const state = {
  primaryLocation: DEFAULT_LOCATIONS.primary,
  compareLocation: DEFAULT_LOCATIONS.compare,
  range: "today",
  metric: "temperature",
  weatherData: {},
  forecastDaysLoaded: 0,
  chart: null
};

let weatherRequestId = 0;

const primaryCityInput = document.getElementById("primaryCity");
const compareCityInput = document.getElementById("compareCity");
const rangeButtons = document.getElementById("rangeButtons");
const metricButtons = document.getElementById("metricButtons");
const refreshBtn = document.getElementById("refreshBtn");
const summaryCards = document.getElementById("summaryCards");
const chartTitle = document.getElementById("chartTitle");
const chartSubtitle = document.getElementById("chartSubtitle");
const compareLabel = document.getElementById("compareLabel");
const forecastTable = document.getElementById("forecastTable");
const lastUpdated = document.getElementById("lastUpdated");
const errorBox = document.getElementById("errorBox");
const loadingBox = document.getElementById("loadingBox");

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

  refreshBtn.addEventListener("click", loadWeather);

  loadWeather();
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
    hourly: "temperature_2m,precipitation,wind_speed_10m,cloud_cover",
    current: "temperature_2m,precipitation,wind_speed_10m,cloud_cover",
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

  renderDecisionCards(primaryPayload, comparePayload);
  renderSummaryCards(primaryPayload);
  renderChart(primaryPayload, comparePayload);
  renderForecastTable(primaryPayload);
  renderChartLabels();
}

function renderDecisionCards(primaryPayload, comparePayload) {
  const p = primaryPayload.current;
  const c = comparePayload.current;

  const rainMax = Math.max(p.precipitation, c.precipitation);
  const colderTemp = Math.min(p.temperature_2m, c.temperature_2m);
  const windMax = Math.max(p.wind_speed_10m, c.wind_speed_10m);

  if (rainMax >= 1) {
    rainDecision.textContent = "Recommended";
    rainReason.textContent = "At least one location is showing noticeable precipitation.";
  } else if (rainMax > 0) {
    rainDecision.textContent = "Maybe";
    rainReason.textContent = "Light precipitation is present, so a compact umbrella could help.";
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

function renderChartLabels() {
  const metricConfig = METRICS[state.metric];
  chartTitle.textContent = `${metricConfig.label} for ${state.primaryLocation.label}`;

  chartSubtitle.textContent =
    state.range === "today"
      ? "Hourly view for near-term commute and campus decisions"
      : `Daily view for the next ${state.range === "7d" ? 7 : 14} days`;

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
          borderColor: "#0f172a",
          backgroundColor:
            state.metric === "cloud"
              ? "rgba(124, 58, 237, 0.15)"
              : state.metric === "precipitation"
              ? "rgba(15, 23, 42, 0.9)"
              : "rgba(15, 23, 42, 0.9)",
          tension: 0.35,
          fill: state.metric === "cloud",
          borderWidth: 3
        },
        {
          label: state.compareLocation.label,
          data: compareValues,
          borderColor: "#64748b",
          backgroundColor: "rgba(100, 116, 139, 0.3)",
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

function buildChartSeries(payload, metricKey, rangeKey) {
  if (!payload || !payload.hourly) return [];

  const metric = METRICS[metricKey];
  const times = payload.hourly.time || [];
  const values = payload.hourly[metric.hourlyKey] || [];

  if (rangeKey === "today") {
    return times.slice(0, 24).map((time, index) => ({
      label: getHourLabel(time),
      value: values[index]
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
  return timestamp.slice(11, 16);
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

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
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
}

init();
